import { resolve } from "node:path";
import { parseArgs, requireCount } from "./args.js";
import { SwitchClient } from "./client.js";
import { resolveCredentials, type ResolveOptions } from "./credentials.js";
import { render, truncate } from "./render.js";

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
    "switch-axi rooms list|show",
    "List or show Switch rooms.",
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
    "switch-axi agents list|show",
    "List or show Switch agents.",
  ),
  ops: help(
    "ops",
    "switch-axi ops list|schema|call",
    "Discover or call the safe generic operation allowlist.",
    { "--args-json": "JSON object for ops call" },
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
  const { positionals } = parseArgs(args, {});
  const action = positionals.shift();
  if (action === "list") {
    if (positionals.length)
      throw new Error("usage: switch-axi rooms list");
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
  throw new Error("rooms supports list or show");
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
  const [roomId, body] = positionals;
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
  throw new Error("usage: switch-axi agents list|show <agent_id>");
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
