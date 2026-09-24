import { execFile as execFileCallback } from "node:child_process";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import {
  AGENT_TYPES,
  loadAgentCreateDefaults,
  type AgentType,
} from "./agent-defaults.js";
import { parseArgs, requireCount, unliteral } from "./args.js";
import { SwitchClient } from "./client.js";
import { notifyConsoleOpenFolder } from "./console-notify.js";
import { resolveCredentials, type ResolveOptions } from "./credentials.js";
import { addPendingLocation } from "./pending-locations.js";
import { render, truncate } from "./render.js";

const execFile = promisify(execFileCallback);

export type CommandContext = ResolveOptions & { json: boolean };
type Client = Pick<SwitchClient, "call" | "operations" | "attach" | "fetch">;
type ClientFactory = (context: CommandContext) => Client;

const allowedOps = new Set([
  "list_rooms",
  "list_all_rooms",
  "get_room_detail",
  "read_context",
  "list_agents",
  "get_agent_detail",
  "create_room",
  "list_bridges",
]);
const makeClient: ClientFactory = (context) =>
  new SwitchClient(resolveCredentials(context));
const help = (
  command: string,
  usage: string,
  description: string,
  flags: Record<string, string> = {},
) => ({ command, usage, description, flags });

export const HELP = {
  auth: help(
    "auth status",
    "switch-axi auth status",
    "Show the selected Switch identity without its token.",
  ),
  rooms: help(
    "rooms",
    "switch-axi rooms list|show|create",
    "List, show, or create Switch rooms. Creation is non-idempotent.",
    {
      "--name": "room name (create)",
      "--desc": "room description (create)",
      "--agent": "agent name; repeat (create)",
      "--user": "user name; repeat (create)",
      "--bridge": "bridge id; requires --channel-type (create)",
      "--internal-only": "skip bridging (create)",
      "--channel-type": "channel type (create)",
      "--instructions": "room instructions (create)",
      "--args-json": "extra create_room fields as JSON object",
    },
  ),
  read: help(
    "read",
    "switch-axi read <room_id>",
    "Read room messages grouped in threads.",
    {
      "--limit": "maximum entries",
      "--since": "ISO-8601 lower time",
      "--before": "ISO-8601 upper time",
      "--full": "do not truncate bodies",
    },
  ),
  participants: help(
    "participants",
    "switch-axi participants <room_id>",
    "List the room participants.",
  ),
  send: help(
    "send",
    "switch-axi send <room_id> <body>",
    "Send a non-idempotent message. Do not retry after a timeout.",
    {
      "--thread": "message event id",
      "--to": "target name; repeat",
      "--role": "target role; repeat",
    },
  ),
  attach: help(
    "attach",
    "switch-axi attach <room_id> <path>",
    "Attach files. This action is non-idempotent.",
    { "--thread": "message event id" },
  ),
  fetch: help(
    "fetch",
    "switch-axi fetch <room_id> <mxc> <dest>",
    "Download one attachment to dest.",
  ),
  agents: help(
    "agents",
    "switch-axi agents list|show|create",
    "List, show, or create Switch agents. Most callers get a permission error on create unless the target agent's owner granted it in the gateway settings. Defaults use $XDG_CONFIG_HOME/switch-axi/agent-create-defaults.json, or ~/.config when unset (one file for every coding agent). Create writes <workdir>/.switch/agents/<name>.json - do not use bare MCP create_agent alone. After create, the working directory is saved to $XDG_CONFIG_HOME/switch-axi/pending-locations.json for the next Console start, and a running Console is told to open it immediately when its control file is reachable; a closed or unreachable Console is not a create failure. Local agents also need a one-time auto-approve toggle in Console settings for unattended operation.",
    {
      "--type":
        "agent type: claude-code|codex|opencode (create; optional if set in defaults)",
      "--name": "agent name (create)",
      "--desc": "agent description (create)",
      "--option": "extra k=v option; repeat (create)",
      "--icon-url": "icon URL (create)",
      "--display-name": "display name (create)",
      "--auto-session": "set options.auto_session true (create)",
      "--no-auto-session": "set options.auto_session false (create)",
      "--repo-dir": "working directory for clone and credentials (create)",
      "--no-clone": "skip git clone (create)",
      "--owner-only":
        "send owner_only true when the server supports it (create)",
      "--anyone": "send owner_only false when the server supports it (create)",
    },
  ),
  ops: help(
    "ops",
    "switch-axi ops list|schema|call",
    "Discover or call the safe generic operation allowlist.",
    { "--args-json": "JSON object for ops call" },
  ),
  jira: help(
    "jira",
    "switch-axi jira instances list|triggers ...|deliveries list|tokens|agent-options ...",
    "Manage Switch Jira trigger rules over the agent bearer-token channel. A Jira instance is server configuration only (JIRA_WEBHOOK_SECRETS + restart): there is no instances add/create command, and none will be added. Webhook secret reveal and rotation stay admin-UI-only (admin login required); this CLI never prints or mints a real secret.",
    {
      "--instance": "Jira instance name (list filter; required on add)",
      "--name": "rule display name (add; update)",
      "--project": "Jira project key filter, blank = any (add; update)",
      "--issue-type": "issue type filter, blank = any (add; update)",
      "--fire-on": "created|updated|transition (add; update)",
      "--target-status": "status moved to / current status (add; update)",
      "--jql": "mini-JQL filter, blank = none (add; update)",
      "--target": "room|group (add; update)",
      "--room": "target room id (add; update; agent-options)",
      "--group": "target group id (add; update; agent-options)",
      "--agent": "agent name to mention; must be a room member (add; update)",
      "--template": "message template with {{tokens}} (add; update)",
      "--thread-by": "new|issue_key (add; update)",
      "--disabled": "create/update the rule disabled (add; update)",
      "--enabled": "re-enable the rule (update)",
      "--rule": "delivery filter: rule id (deliveries list)",
      "--limit": "maximum deliveries (deliveries list)",
      "--overrides": "dry-run sample-event overrides as JSON object",
      "--payload": "dry-run raw webhook payload from a JSON file",
    },
  ),
};

function output(
  data: Record<string, unknown>,
  context: CommandContext,
): string {
  return render(data, context.json);
}
function client(context: CommandContext, factory: ClientFactory): Client {
  return factory(context);
}

function shapeEntry(entry: unknown, full: boolean): unknown {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
  const copy = { ...(entry as Record<string, unknown>) };
  copy.body = truncate(copy.body, full);
  return copy;
}

function shapeRead(value: unknown, full: boolean): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const copy = { ...(value as Record<string, unknown>) };
  if (Array.isArray(copy.threads)) {
    copy.threads = copy.threads.map((thread) => {
      if (!thread || typeof thread !== "object" || Array.isArray(thread))
        return thread;
      const row = { ...(thread as Record<string, unknown>) };
      row.root = shapeEntry(row.root, full);
      row.replies = Array.isArray(row.replies)
        ? row.replies.map((reply) => shapeEntry(reply, full))
        : row.replies;
      return row;
    });
  }
  return copy;
}

export async function authCommand(
  args: string[],
  context: CommandContext,
): Promise<string> {
  if (args.includes("--help")) return output(HELP.auth, context);
  requireCount(args, 1, "switch-axi auth status");
  if (args[0] !== "status") throw new Error("auth supports status only");
  const identity = resolveCredentials(context);
  return output(
    {
      auth: {
        status: "configured",
        agent: identity.slug,
        agent_id: identity.agentId,
        endpoint: identity.endpoint,
        source: identity.source,
      },
    },
    context,
  );
}

export async function roomsCommand(
  args: string[],
  context: CommandContext,
  factory = makeClient,
): Promise<string> {
  if (args.includes("--help")) return output(HELP.rooms, context);
  if (args[0] === "create")
    return roomsCreateCommand(args.slice(1), context, factory);
  const { positionals } = parseArgs(args, {});
  const action = positionals.shift();
  if (action === "list") {
    if (positionals.length) throw new Error("usage: switch-axi rooms list");
    const rooms = await client(context, factory).call("list_rooms", {});
    return output(
      {
        rooms: Array.isArray(rooms) ? rooms : [],
        count: Array.isArray(rooms) ? rooms.length : 0,
      },
      context,
    );
  }
  if (action === "show") {
    requireCount(positionals, 1, "switch-axi rooms show <room_id>");
    return output(
      {
        room: await client(context, factory).call("get_room_detail", {
          room_id: positionals[0],
        }),
      },
      context,
    );
  }
  throw new Error("rooms supports list, show, or create");
}

const ROOMS_CREATE_USAGE =
  "switch-axi rooms create --name <n> --desc <d> --agent <name> [--agent ...] [--user <name> ...] [--bridge <id> | --internal-only] [--channel-type <t>] [--instructions <text>] [--args-json '<object>']";

async function roomsCreateCommand(
  args: string[],
  context: CommandContext,
  factory: ClientFactory,
): Promise<string> {
  const { positionals, flags } = parseArgs(args, {
    "--name": "value",
    "--desc": "value",
    "--agent": "repeat",
    "--user": "repeat",
    "--bridge": "value",
    "--internal-only": "boolean",
    "--channel-type": "value",
    "--instructions": "value",
    "--args-json": "value",
  });
  // ponytail: --admin-mode/security_config stay out as first-class flags
  // (no server authz on admin_mode); they pass only via --args-json.
  if (positionals.length) throw new Error(`usage: ${ROOMS_CREATE_USAGE}`);
  const name = flags["--name"] as string | undefined;
  const description = flags["--desc"] as string | undefined;
  const agents = (flags["--agent"] as string[] | undefined) ?? [];
  if (!name || !description || !agents.length)
    throw new Error(`usage: ${ROOMS_CREATE_USAGE}`);
  const bridge = flags["--bridge"] as string | undefined;
  const internalOnly = flags["--internal-only"] === true;
  if (bridge && internalOnly)
    throw new Error("--bridge and --internal-only are mutually exclusive");
  const channelType = flags["--channel-type"] as string | undefined;
  if (bridge && !channelType)
    throw new Error("--channel-type is required when --bridge is passed");
  const users = (flags["--user"] as string[] | undefined) ?? [];
  const instructions = flags["--instructions"] as string | undefined;
  let extra: Record<string, unknown> = {};
  const source = flags["--args-json"];
  if (source !== undefined) {
    if (typeof source !== "string") throw new Error("--args-json is required");
    try {
      const value: unknown = JSON.parse(source);
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error();
      extra = value as Record<string, unknown>;
    } catch {
      throw new Error("--args-json must be one JSON object");
    }
  }
  const result = (await client(context, factory).call("create_room", {
    ...extra,
    name,
    description,
    agent_names: agents,
    ...(users.length ? { user_names: users } : {}),
    ...(bridge ? { bridge_id: bridge } : {}),
    ...(internalOnly ? { internal_only: true } : {}),
    ...(channelType ? { channel_type: channelType } : {}),
    ...(instructions !== undefined ? { instructions } : {}),
  })) as Record<string, unknown>;
  const room =
    result && typeof result === "object" && !Array.isArray(result)
      ? result
      : {};
  return output(
    {
      room: {
        id: room.id,
        name: room.name,
        transport_room_id: room.transport_room_id,
      },
      failed_attachments: Array.isArray(room.failed_attachments)
        ? room.failed_attachments
        : [],
      idempotency:
        "non-idempotent: each call creates a new room; check `rooms list` before retrying",
    },
    context,
  );
}

export async function readCommand(
  args: string[],
  context: CommandContext,
  factory = makeClient,
): Promise<string> {
  if (args.includes("--help")) return output(HELP.read, context);
  const { positionals, flags } = parseArgs(args, {
    "--limit": "value",
    "--since": "value",
    "--before": "value",
    "--full": "boolean",
  });
  requireCount(positionals, 1, "switch-axi read <room_id>");
  const limit = flags["--limit"] ? Number(flags["--limit"]) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1))
    throw new Error("--limit must be a positive integer");
  const result = await client(context, factory).call("read_context", {
    room_id: positionals[0],
    ...(limit ? { limit } : {}),
    ...(flags["--since"] ? { since: flags["--since"] } : {}),
    ...(flags["--before"] ? { before: flags["--before"] } : {}),
  });
  return output(
    {
      room_id: positionals[0],
      context: shapeRead(result, flags["--full"] === true),
    },
    context,
  );
}

export async function participantsCommand(
  args: string[],
  context: CommandContext,
  factory = makeClient,
): Promise<string> {
  if (args.includes("--help")) return output(HELP.participants, context);
  requireCount(args, 1, "switch-axi participants <room_id>");
  return output(
    {
      room_id: args[0],
      participants: await client(context, factory).call("list_participants", {
        room_id: args[0],
      }),
    },
    context,
  );
}

export async function sendCommand(
  args: string[],
  context: CommandContext,
  factory = makeClient,
): Promise<string> {
  if (args.includes("--help")) return output(HELP.send, context);
  const { positionals, flags } = parseArgs(args, {
    "--thread": "value",
    "--to": "repeat",
    "--role": "repeat",
  });
  requireCount(positionals, 2, "switch-axi send <room_id> <body>");
  const [roomId, rawBody] = positionals;
  const body = unliteral(rawBody);
  const names = (flags["--to"] as string[] | undefined) ?? [];
  const roles = (flags["--role"] as string[] | undefined) ?? [];
  const operation =
    names.length || roles.length ? "send_targeted_message" : "post_message";
  const result = await client(context, factory).call(operation, {
    room_id: roomId,
    body,
    ...(flags["--thread"] ? { thread_id: flags["--thread"] } : {}),
    ...(names.length ? { target_names: names } : {}),
    ...(roles.length ? { target_roles: roles } : {}),
  });
  return output(
    {
      send: result,
      idempotency: "non-idempotent: do not retry an ambiguous timeout",
    },
    context,
  );
}

export async function attachCommand(
  args: string[],
  context: CommandContext,
  factory = makeClient,
): Promise<string> {
  if (args.includes("--help")) return output(HELP.attach, context);
  const { positionals, flags } = parseArgs(args, { "--thread": "value" });
  requireCount(positionals, 2, "switch-axi attach <room_id> <path>");
  const [roomId, path] = positionals;
  return output(
    {
      attach: await client(context, factory).attach(
        roomId,
        resolve(context.cwd, path),
        flags["--thread"] as string | undefined,
      ),
      idempotency: "non-idempotent: do not retry an ambiguous timeout",
    },
    context,
  );
}

export async function fetchCommand(
  args: string[],
  context: CommandContext,
  factory = makeClient,
): Promise<string> {
  if (args.includes("--help")) return output(HELP.fetch, context);
  requireCount(args, 3, "switch-axi fetch <room_id> <mxc> <dest>");
  const [roomId, mxc, dest] = args;
  const file = resolve(context.cwd, dest);
  await client(context, factory).fetch(roomId, mxc, file);
  return output({ fetch: { room_id: roomId, mxc, file } }, context);
}

export async function agentsCommand(
  args: string[],
  context: CommandContext,
  factory = makeClient,
): Promise<string> {
  if (args.includes("--help")) return output(HELP.agents, context);
  if (args[0] === "list" && args.length === 1)
    return output(
      { agents: await client(context, factory).call("list_agents", {}) },
      context,
    );
  if (args[0] === "show" && args.length === 2)
    return output(
      {
        agent: await client(context, factory).call("get_agent_detail", {
          agent_id: args[1],
        }),
      },
      context,
    );
  if (args[0] === "create") return createAgent(args.slice(1), context, factory);
  throw new Error(
    "usage: switch-axi agents list|show <agent_id>|create --type <claude-code|codex|opencode> --name <name> --desc <description>",
  );
}

const createUsage =
  "switch-axi agents create --type <claude-code|codex|opencode> --name <name> --desc <description> [--option k=v ...] [--icon-url <url>] [--display-name <name>] [--auto-session|--no-auto-session] [--repo-dir <path>] [--no-clone] [--owner-only|--anyone]";

async function createAgent(
  args: string[],
  context: CommandContext,
  factory: ClientFactory,
): Promise<string> {
  const env = context.env ?? process.env;
  const defaults = loadAgentCreateDefaults(env);
  const { positionals, flags } = parseArgs(args, {
    "--type": "value",
    "--name": "value",
    "--desc": "value",
    "--option": "repeat",
    "--icon-url": "value",
    "--display-name": "value",
    "--auto-session": "boolean",
    "--no-auto-session": "boolean",
    "--repo-dir": "value",
    "--no-clone": "boolean",
    "--owner-only": "boolean",
    "--anyone": "boolean",
  });
  if (positionals.length) throw new Error(`usage: ${createUsage}`);
  if (flags["--auto-session"] && flags["--no-auto-session"])
    throw new Error("use only one of --auto-session and --no-auto-session");
  if (flags["--owner-only"] && flags["--anyone"])
    throw new Error("use only one of --owner-only and --anyone");
  const type = (flags["--type"] as string | undefined) ?? defaults.agent_type;
  const name = flags["--name"] as string | undefined;
  const desc = flags["--desc"] as string | undefined;
  if (!type || !name || !desc) throw new Error(`usage: ${createUsage}`);
  if (!AGENT_TYPES.includes(type as AgentType))
    throw new Error(
      `--type must be one of ${AGENT_TYPES.join(", ")}, got: ${type}`,
    );
  if (
    name.includes("/") ||
    name.includes("\\") ||
    name === "." ||
    name === ".."
  )
    throw new Error(`--name must be a plain file-safe name, got: ${name}`);
  const options: Record<string, string | boolean> = {};
  for (const item of (flags["--option"] as string[] | undefined) ?? []) {
    const separator = item.indexOf("=");
    if (separator < 1) throw new Error(`--option must be k=v, got: ${item}`);
    options[item.slice(0, separator)] = item.slice(separator + 1);
  }
  let autoSession: boolean | undefined;
  if (flags["--auto-session"]) autoSession = true;
  else if (flags["--no-auto-session"]) autoSession = false;
  else autoSession = defaults.auto_session;
  const ownerOnlyFlag = flags["--owner-only"]
    ? true
    : flags["--anyone"]
      ? false
      : undefined;
  const ownerOnly = ownerOnlyFlag ?? defaults.owner_only ?? false;
  const repoDirFlag = flags["--repo-dir"] as string | undefined;
  if (repoDirFlag !== undefined && !repoDirFlag.trim())
    throw new Error("--repo-dir requires a path");
  const targetDir = repoDirFlag
    ? isAbsolute(repoDirFlag)
      ? repoDirFlag
      : resolve(context.cwd, repoDirFlag)
    : defaults.base_working_dir
      ? join(defaults.base_working_dir, name)
      : undefined;
  if (autoSession !== undefined) options.auto_session = autoSession;
  if (targetDir) options.repo_dir = targetDir;

  const identity = resolveCredentials(context);
  const api = client(context, factory);
  const shouldClone =
    flags["--no-clone"] !== true && Boolean(defaults.git_repo_url);
  if (shouldClone && !targetDir)
    throw new Error(
      "git_repo_url is set but no working directory was computed; set base_working_dir or pass --repo-dir",
    );
  if (!repoDirFlag && defaults.base_working_dir)
    await requireExistingDir(defaults.base_working_dir, "base_working_dir");

  let clonedDir: string | undefined;
  if (shouldClone && targetDir && defaults.git_repo_url) {
    if (await pathExists(targetDir))
      throw new Error(`target directory already exists: ${targetDir}`);
    await assertGitAvailable(env);
    await cloneRepo(defaults.git_repo_url, targetDir, env);
    clonedDir = targetDir;
  }

  const sendOwnerOnly = await ownerOnlySupported(api);
  let result: unknown;
  try {
    result = await api.call("create_agent", {
      agent_type: type,
      name,
      description: desc,
      ...(Object.keys(options).length ? { options } : {}),
      ...(flags["--icon-url"] ? { icon_url: flags["--icon-url"] } : {}),
      ...(flags["--display-name"]
        ? { display_name: flags["--display-name"] }
        : {}),
      ...(sendOwnerOnly ? { owner_only: ownerOnly } : {}),
    });
  } catch (error) {
    throw friendlierCreateError(name, error, clonedDir);
  }
  if (
    !result ||
    typeof result !== "object" ||
    typeof (result as Record<string, unknown>).id !== "string" ||
    typeof (result as Record<string, unknown>).api_key !== "string"
  )
    throw new Error("Switch API returned an unexpected create_agent response");
  const { id, api_key: apiKey } = result as { id: string; api_key: string };
  const workingDir = resolve(targetDir ?? context.cwd);
  const credentialFile = await writeAgentCredential(
    workingDir,
    name,
    id,
    identity.endpoint,
    apiKey,
  );
  const notes = [
    `Credential file written to ${credentialFile}.`,
    `Working dir ${workingDir}. Console auto-adopts credentials under an onboarded location; onboard this folder once if it is new.`,
    "Local agents need a one-time auto-approve toggle in Console settings for unattended operation.",
  ];
  try {
    const { replacedInvalidFile } = await addPendingLocation(workingDir, env);
    if (replacedInvalidFile)
      notes.push(
        "The invalid pending-locations file was replaced with this folder.",
      );
    notes.push(
      `Folder saved for the next Console start: ${workingDir} is queued so a closed Console opens it on launch.`,
    );
  } catch (error) {
    notes.push(
      `Failed to save ${workingDir} for the next Console start: ${(error as Error).message}`,
    );
  }
  await notifyConsoleOpenFolder(workingDir, env);
  if (!sendOwnerOnly)
    notes.push(
      "This Switch server does not advertise owner_only on create_agent; the flag was omitted.",
    );
  return output(
    {
      id,
      name,
      credential_file: credentialFile,
      working_dir: workingDir,
      note: notes.join(" "),
    },
    context,
  );
}

function friendlierCreateError(
  name: string,
  error: unknown,
  clonedDir?: string,
): Error {
  if (!(error instanceof Error))
    return new Error(`failed to create agent ${name}`);
  if (error.message.includes("HTTP 403"))
    return new Error(
      `create_agent was denied (HTTP 403): the target agent's owner has not granted this permission in the gateway settings. Ask the owner to grant it, then retry. Detail: ${error.message}`,
    );
  if (error.message.includes("HTTP 409")) {
    const extra = clonedDir
      ? ` Local folder ${clonedDir} was already created - delete it or reuse it with --repo-dir.`
      : "";
    return new Error(
      `agent "${name}" already exists (HTTP 409): create is create-only, pick a different --name.${extra} Detail: ${error.message}`,
    );
  }
  if (
    error.message.includes("HTTP 400") &&
    error.message.toLowerCase().includes("owner_only")
  )
    return new Error(
      `create_agent rejected owner_only (HTTP 400): this Switch server does not support the owner_only argument yet. Detail: ${error.message}`,
    );
  return error;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function requireExistingDir(path: string, label: string): Promise<void> {
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new Error(`${label} does not exist: ${path}`, { cause: error });
    throw error;
  }
  if (!info.isDirectory())
    throw new Error(`${label} is not a directory: ${path}`);
}

function execErrorText(error: unknown): string {
  if (error && typeof error === "object" && "stderr" in error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    if (typeof stderr === "string" && stderr.trim()) return stderr.trim();
  }
  return error instanceof Error ? error.message : String(error);
}

async function assertGitAvailable(env: NodeJS.ProcessEnv): Promise<void> {
  try {
    await execFile("git", ["--version"], { encoding: "utf8", env });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new Error("git is not on PATH; install git or pass --no-clone", {
        cause: error,
      });
    throw new Error(
      `git is not on PATH; install git or pass --no-clone: ${execErrorText(error)}`,
      { cause: error },
    );
  }
}

async function cloneRepo(
  url: string,
  dest: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  try {
    await execFile("git", ["clone", url, dest], {
      encoding: "utf8",
      env: { ...env, GIT_TERMINAL_PROMPT: "0" },
    });
  } catch (error) {
    const cleanup = await rm(dest, { recursive: true, force: true }).then(
      () => true,
      () => false,
    );
    const cleanupNote = cleanup
      ? `removed ${dest}`
      : `failed to remove ${dest}; it may still exist`;
    throw new Error(
      `git clone failed; ${cleanupNote}. ${execErrorText(error)}`,
      {
        cause: error,
      },
    );
  }
}

async function ownerOnlySupported(api: Client): Promise<boolean> {
  try {
    const ops = await api.operations();
    const schema = ops.create_agent?.input_schema;
    if (!schema || typeof schema !== "object") return false;
    const properties = (schema as { properties?: unknown }).properties;
    return Boolean(
      properties &&
      typeof properties === "object" &&
      !Array.isArray(properties) &&
      "owner_only" in properties,
    );
  } catch {
    return false;
  }
}

async function writeAgentCredential(
  dir: string,
  name: string,
  id: string,
  endpoint: string,
  apiKey: string,
): Promise<string> {
  const agentsDir = join(dir, ".switch", "agents");
  const credentialFile = join(agentsDir, `${name}.json`);
  try {
    await mkdir(agentsDir, { recursive: true });
    await writeFile(join(agentsDir, ".gitignore"), "*\n");
  } catch (error) {
    throw new Error(
      `failed to write credential file ${credentialFile}: ${(error as Error).message}`,
      { cause: error },
    );
  }
  await writeKeyFile(
    credentialFile,
    `${JSON.stringify({
      env: {
        SWITCH_AGENT_ID: id,
        SWITCH_API_ENDPOINT: endpoint,
        SWITCH_API_TOKEN: apiKey,
      },
    })}\n`,
  );
  return credentialFile;
}

async function writeKeyFile(path: string, payload: string): Promise<void> {
  const temp = `${path}.${process.pid}.tmp`;
  await unlink(temp).catch(() => {});
  try {
    await writeFile(temp, payload, { mode: 0o600 });
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw new Error(
      `failed to write credential file ${path}: ${(error as Error).message}`,
      { cause: error },
    );
  }
  try {
    await chmod(temp, 0o600);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw new Error(
      `failed to write credential file ${path}: ${(error as Error).message}`,
      { cause: error },
    );
  }
  try {
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw new Error(
      `failed to write credential file ${path}: ${(error as Error).message}`,
      { cause: error },
    );
  }
}

const JIRA_INSTANCES_USAGE = "switch-axi jira instances list";
const JIRA_TRIGGERS_USAGE =
  "switch-axi jira triggers list [--instance <name>]|show <id>|add --name <n> --instance <i> --fire-on <created|updated|transition> --template <text> --target <room|group> --room|--group <id> --agent <name> [--project <key>] [--issue-type <t>] [--target-status <s>] [--jql <filter>] [--thread-by <new|issue_key>] [--disabled]|update <id> [fields ...]|delete <id>|dry-run <id> [--overrides '<object>'] [--payload <file>]";
const JIRA_DELIVERIES_USAGE =
  "switch-axi jira deliveries list [--instance <name>] [--rule <id>] [--limit <n>]";
const JIRA_AGENT_OPTIONS_USAGE =
  "switch-axi jira agent-options --room <id> | --group <id>";

const FIRE_ON = ["created", "updated", "transition"];
const TARGET_KINDS = ["room", "group"];
const THREAD_BY = ["new", "issue_key"];

type Confirm = (prompt: string) => Promise<string>;

function stdinConfirm(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function parseJsonObject(
  source: string,
  label: string,
): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be one JSON object`);
  return value as Record<string, unknown>;
}

function checkEnum(
  value: string | undefined,
  allowed: string[],
  flag: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (!allowed.includes(value))
    throw new Error(
      `${flag} must be one of ${allowed.join("|")}, got: ${value}`,
    );
  return value;
}

export async function jiraCommand(
  args: string[],
  context: CommandContext,
  factory = makeClient,
  confirm: Confirm = stdinConfirm,
): Promise<string> {
  if (args.includes("--help")) return output(HELP.jira, context);
  const [group, ...rest] = args;
  if (group === "instances") return jiraInstances(rest, context, factory);
  if (group === "triggers")
    return jiraTriggers(rest, context, factory, confirm);
  if (group === "deliveries") return jiraDeliveries(rest, context, factory);
  if (group === "tokens") {
    requireCount(rest, 0, "switch-axi jira tokens");
    return output(
      {
        tokens: await client(context, factory).call(
          "list_jira_message_tokens",
          {},
        ),
      },
      context,
    );
  }
  if (group === "agent-options")
    return jiraAgentOptions(rest, context, factory);
  throw new Error(
    "usage: switch-axi jira instances|triggers|deliveries|tokens|agent-options ...",
  );
}

async function jiraInstances(
  args: string[],
  context: CommandContext,
  factory: ClientFactory,
): Promise<string> {
  const { positionals } = parseArgs(args, {});
  if (positionals.length === 1 && positionals[0] === "list") {
    return output(
      {
        jira: await client(context, factory).call("list_jira_instances", {}),
      },
      context,
    );
  }
  throw new Error(
    `usage: ${JIRA_INSTANCES_USAGE} (a Jira instance is server configuration only - there is no instances add; secret reveal and rotation stay admin-UI-only)`,
  );
}

async function jiraTriggers(
  args: string[],
  context: CommandContext,
  factory: ClientFactory,
  confirm: Confirm,
): Promise<string> {
  const [action, ...rest] = args;
  const api = client(context, factory);
  if (action === "list") {
    const { positionals, flags } = parseArgs(rest, { "--instance": "value" });
    requireCount(
      positionals,
      0,
      "switch-axi jira triggers list [--instance <name>]",
    );
    const instance = flags["--instance"] as string | undefined;
    return output(
      {
        triggers: await api.call("list_jira_triggers", {
          ...(instance !== undefined ? { instance } : {}),
        }),
      },
      context,
    );
  }
  if (action === "show") {
    requireCount(rest, 1, "switch-axi jira triggers show <id>");
    return output(
      {
        trigger: await api.call("get_jira_trigger", { trigger_id: rest[0] }),
      },
      context,
    );
  }
  if (action === "dry-run") return jiraDryRun(rest, context, factory);
  if (action === "add") return jiraTriggerAdd(rest, context, factory);
  if (action === "update") return jiraTriggerUpdate(rest, context, factory);
  if (action === "delete")
    return jiraTriggerDelete(rest, context, factory, confirm);
  throw new Error(`usage: ${JIRA_TRIGGERS_USAGE}`);
}

async function jiraDryRun(
  args: string[],
  context: CommandContext,
  factory: ClientFactory,
): Promise<string> {
  const { positionals, flags } = parseArgs(args, {
    "--overrides": "value",
    "--payload": "value",
  });
  requireCount(
    positionals,
    1,
    "switch-axi jira triggers dry-run <id> [--overrides '<object>'] [--payload <file>]",
  );
  const overrides =
    flags["--overrides"] !== undefined
      ? parseJsonObject(flags["--overrides"] as string, "--overrides")
      : undefined;
  let payload: Record<string, unknown> | undefined;
  const payloadFile = flags["--payload"] as string | undefined;
  if (payloadFile !== undefined) {
    let text: string;
    try {
      text = await readFile(resolve(context.cwd, payloadFile), "utf8");
    } catch (error) {
      throw new Error(
        `cannot read --payload file ${payloadFile}: ${(error as Error).message}`,
        { cause: error },
      );
    }
    payload = parseJsonObject(text, `--payload file ${payloadFile}`);
  }
  return output(
    {
      dry_run: await client(context, factory).call("dry_run_jira_trigger", {
        trigger_id: positionals[0],
        ...(overrides !== undefined ? { sample_overrides: overrides } : {}),
        ...(payload !== undefined ? { payload } : {}),
      }),
    },
    context,
  );
}

const TRIGGER_FIELD_FLAGS = {
  "--name": "value",
  "--instance": "value",
  "--project": "value",
  "--issue-type": "value",
  "--fire-on": "value",
  "--target-status": "value",
  "--jql": "value",
  "--target": "value",
  "--room": "value",
  "--group": "value",
  "--agent": "value",
  "--template": "value",
  "--thread-by": "value",
  "--disabled": "boolean",
} as const;

function triggerFieldArgs(flags: Record<string, string | boolean | string[]>): {
  params: Record<string, unknown>;
  targetKind: string | undefined;
  room: string | undefined;
  group: string | undefined;
} {
  if (flags["--disabled"] && flags["--enabled"])
    throw new Error("use only one of --disabled and --enabled");
  const targetKind = checkEnum(
    flags["--target"] as string | undefined,
    TARGET_KINDS,
    "--target",
  );
  const params: Record<string, unknown> = {};
  const take = (flag: string, param: string) => {
    const value = flags[flag] as string | undefined;
    if (value !== undefined) params[param] = value;
  };
  take("--name", "name");
  take("--instance", "instance");
  take("--project", "project_key");
  take("--issue-type", "issue_type");
  take("--target-status", "target_status");
  take("--jql", "jql");
  take("--agent", "agent_name");
  take("--template", "message_template");
  const fireOn = checkEnum(
    flags["--fire-on"] as string | undefined,
    FIRE_ON,
    "--fire-on",
  );
  if (fireOn !== undefined) params.fire_on = fireOn;
  const threadBy = checkEnum(
    flags["--thread-by"] as string | undefined,
    THREAD_BY,
    "--thread-by",
  );
  if (threadBy !== undefined) params.thread_by = threadBy;
  if (targetKind !== undefined) params.target_kind = targetKind;
  if (flags["--disabled"]) params.enabled = false;
  if (flags["--enabled"]) params.enabled = true;
  return {
    params,
    targetKind,
    room: flags["--room"] as string | undefined,
    group: flags["--group"] as string | undefined,
  };
}

function resolveTargetIds(
  targetKind: string,
  room: string | undefined,
  group: string | undefined,
): Record<string, unknown> {
  if (targetKind === "room") {
    if (!room || group)
      throw new Error("--target room requires --room <id> and no --group");
    return { target_room_id: room };
  }
  if (!group || room)
    throw new Error("--target group requires --group <id> and no --room");
  return { target_group_id: group };
}

async function jiraTriggerAdd(
  args: string[],
  context: CommandContext,
  factory: ClientFactory,
): Promise<string> {
  const { positionals, flags } = parseArgs(args, { ...TRIGGER_FIELD_FLAGS });
  if (positionals.length) throw new Error(`usage: ${JIRA_TRIGGERS_USAGE}`);
  const { params, targetKind, room, group } = triggerFieldArgs(flags);
  const name = params.name as string | undefined;
  const instance = params.instance as string | undefined;
  const fireOn = params.fire_on as string | undefined;
  const template = params.message_template as string | undefined;
  const agent = params.agent_name as string | undefined;
  if (!name || !instance || !fireOn || !template || !targetKind || !agent)
    throw new Error(
      "triggers add requires --name --instance --fire-on --template --target room|group (--room|--group) --agent",
    );
  return output(
    {
      trigger: await client(context, factory).call("create_jira_trigger", {
        ...params,
        ...resolveTargetIds(targetKind, room, group),
      }),
    },
    context,
  );
}

async function jiraTriggerUpdate(
  args: string[],
  context: CommandContext,
  factory: ClientFactory,
): Promise<string> {
  const { positionals, flags } = parseArgs(args, {
    ...TRIGGER_FIELD_FLAGS,
    "--enabled": "boolean",
  });
  requireCount(
    positionals,
    1,
    "switch-axi jira triggers update <id> [fields ...]",
  );
  const { params, targetKind, room, group } = triggerFieldArgs(flags);
  const fields: Record<string, unknown> = { ...params };
  if (targetKind !== undefined) {
    Object.assign(fields, resolveTargetIds(targetKind, room, group));
  } else if (room !== undefined || group !== undefined) {
    throw new Error("--room/--group require --target room|group");
  }
  if (!Object.keys(fields).length)
    throw new Error("triggers update needs at least one field flag");
  return output(
    {
      trigger: await client(context, factory).call("update_jira_trigger", {
        trigger_id: positionals[0],
        ...fields,
      }),
    },
    context,
  );
}

async function jiraTriggerDelete(
  args: string[],
  context: CommandContext,
  factory: ClientFactory,
  confirm: Confirm,
): Promise<string> {
  const { positionals } = parseArgs(args, {});
  requireCount(positionals, 1, "switch-axi jira triggers delete <id>");
  const answer = await confirm(
    `Delete Jira trigger ${positionals[0]}? Type yes to confirm: `,
  );
  if (!["yes", "y"].includes(answer.trim().toLowerCase()))
    throw new Error("delete cancelled");
  return output(
    {
      delete: await client(context, factory).call("delete_jira_trigger", {
        trigger_id: positionals[0],
      }),
    },
    context,
  );
}

async function jiraDeliveries(
  args: string[],
  context: CommandContext,
  factory: ClientFactory,
): Promise<string> {
  const { positionals, flags } = parseArgs(args, {
    "--instance": "value",
    "--rule": "value",
    "--limit": "value",
  });
  if (positionals.length !== 1 || positionals[0] !== "list")
    throw new Error(`usage: ${JIRA_DELIVERIES_USAGE}`);
  const limit = flags["--limit"] ? Number(flags["--limit"]) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1))
    throw new Error("--limit must be a positive integer");
  return output(
    {
      deliveries: await client(context, factory).call("list_jira_deliveries", {
        ...(flags["--instance"] ? { instance: flags["--instance"] } : {}),
        ...(flags["--rule"] ? { rule_id: flags["--rule"] } : {}),
        ...(limit !== undefined ? { limit } : {}),
      }),
    },
    context,
  );
}

async function jiraAgentOptions(
  args: string[],
  context: CommandContext,
  factory: ClientFactory,
): Promise<string> {
  const { positionals, flags } = parseArgs(args, {
    "--room": "value",
    "--group": "value",
  });
  requireCount(positionals, 0, JIRA_AGENT_OPTIONS_USAGE);
  const room = flags["--room"] as string | undefined;
  const group = flags["--group"] as string | undefined;
  if (Boolean(room) === Boolean(group))
    throw new Error(`usage: ${JIRA_AGENT_OPTIONS_USAGE}`);
  return output(
    {
      agents: await client(context, factory).call("list_jira_agent_options", {
        ...(room ? { room_id: room } : {}),
        ...(group ? { group_id: group } : {}),
      }),
    },
    context,
  );
}

export async function opsCommand(
  args: string[],
  context: CommandContext,
  factory = makeClient,
): Promise<string> {
  if (args.includes("--help")) return output(HELP.ops, context);
  const action = args[0];
  const operations = await client(context, factory).operations();
  const safe = Object.fromEntries(
    Object.entries(operations).filter(([name]) => allowedOps.has(name)),
  );
  if (action === "list" && args.length === 1)
    return output(
      { operations: safe, count: Object.keys(safe).length },
      context,
    );
  if (action === "schema" && args.length === 2) {
    if (!safe[args[1]])
      throw new Error(
        `operation is not available through switch-axi: ${args[1]}`,
      );
    return output({ name: args[1], ...safe[args[1]] }, context);
  }
  if (action === "call") {
    const { positionals, flags } = parseArgs(args.slice(1), {
      "--args-json": "value",
    });
    requireCount(
      positionals,
      1,
      "switch-axi ops call <name> --args-json '<object>'",
    );
    const name = positionals[0];
    if (!safe[name])
      throw new Error(`operation is not available through switch-axi: ${name}`);
    const source = flags["--args-json"];
    if (typeof source !== "string") throw new Error("--args-json is required");
    let value: unknown;
    try {
      value = JSON.parse(source);
    } catch {
      throw new Error("--args-json must be valid JSON");
    }
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("--args-json must be one JSON object");
    return output(
      {
        result: await client(context, factory).call(
          name,
          value as Record<string, unknown>,
        ),
      },
      context,
    );
  }
  throw new Error(
    "usage: switch-axi ops list|schema <name>|call <name> --args-json '<object>'",
  );
}
