import { runAxiCli } from "axi-sdk-js";
import { literal } from "./args.js";
import {
  agentsCommand,
  attachCommand,
  authCommand,
  fetchCommand,
  HELP,
  opsCommand,
  participantsCommand,
  readCommand,
  roomsCommand,
  sendCommand,
} from "./commands.js";
import { render } from "./render.js";
import { VERSION } from "./version.js";

export const TOP_HELP = `usage: switch-axi [--cwd <dir>] [--agent <slug>] <command> [flags]
commands[9]:
  auth, rooms, read, participants, send, attach, fetch, agents, ops
output:
  Default output is TOON. Use --json for JSON.
  Sends, attachments, and room creation are non-idempotent. Do not retry an ambiguous timeout.
examples:
  switch-axi auth status
  switch-axi rooms list
  switch-axi rooms create --name <n> --desc <d> --agent <name>
  switch-axi read <room_id> --limit 20
  switch-axi send <room_id> "status?" --to pm
  switch-axi attach <room_id> ./plan.md
`;

type MainOptions = {
  argv?: string[];
  stdout?: { write: (chunk: string) => unknown };
};

function globals(argv: string[]) {
  let cwd = process.cwd();
  let agent: string | undefined;
  let json = false;
  const rest: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      rest.push(...argv.slice(index));
      break;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--cwd" || arg === "--agent") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--"))
        throw new Error(`${arg} requires a value`);
      index += 1;
      if (arg === "--cwd") cwd = value;
      else agent = value;
      continue;
    }
    rest.push(arg);
  }
  return { argv: rest, context: { cwd, agent, json } };
}

function sendArgs(argv: string[]): string[] {
  if (argv[0] !== "send") return argv;
  const separator = argv.indexOf("--");
  if (separator < 0) return argv;
  return [
    ...argv.slice(0, separator),
    ...argv.slice(separator + 1).map(literal),
  ];
}

export async function main(options: MainOptions = {}): Promise<void> {
  const parsed = globals(options.argv ?? process.argv.slice(2));
  const context = parsed.context;
  await runAxiCli({
    argv: sendArgs(parsed.argv),
    ...(options.stdout ? { stdout: options.stdout } : {}),
    description: "Manage Switch messaging resources for agents.",
    version: VERSION,
    topLevelHelp: TOP_HELP,
    commands: {
      auth: (args) => authCommand(args, context),
      rooms: (args) => roomsCommand(args, context),
      read: (args) => readCommand(args, context),
      participants: (args) => participantsCommand(args, context),
      send: (args) => sendCommand(args, context),
      attach: (args) => attachCommand(args, context),
      fetch: (args) => fetchCommand(args, context),
      agents: (args) => agentsCommand(args, context),
      ops: (args) => opsCommand(args, context),
      update: () => {
        throw new Error("self-update is not supported");
      },
    },
    home: () => TOP_HELP,
    getCommandHelp: (command) => {
      const item = HELP[command as keyof typeof HELP];
      return item ? render(item, context.json) : undefined;
    },
  });
}
