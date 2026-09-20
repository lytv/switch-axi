# switch-axi

`switch-axi` is an AXI-shaped CLI for Switch messaging. It uses TOON by default and JSON with `--json`.

## Install

```sh
npx switch-axi --help
# or
npm install --global switch-axi
```

## Credentials

The CLI resolves credentials in this order:

1. A complete `SWITCH_API_ENDPOINT`, `SWITCH_API_TOKEN`, and `SWITCH_AGENT_ID` environment.
2. `<cwd>/.switch/agents/<slug>.json`.
3. `.claude/switch-subagents/<name>.settings.json` when `--agent <name>` selects a legacy Claude subagent.

The primary file accepts the Switch Console shape:

```json
{
  "env": {
    "SWITCH_API_ENDPOINT": "http://127.0.0.1:8000",
    "SWITCH_API_TOKEN": "secret",
    "SWITCH_AGENT_ID": "agent-id"
  }
}
```

Use `--cwd <dir>` to select a project credential store. Use `--agent <slug>` before the command when the store has more than one agent. After the command, `--agent` belongs to that command: `rooms create` repeats it once per room member. The CLI never writes tokens to `.claude/settings*`, `.codex`, or `.opencode`.

## Examples

```sh
switch-axi auth status
switch-axi rooms list
switch-axi rooms create --name <n> --desc <d> --agent <name>
switch-axi read <room_id> --limit 20
switch-axi send <room_id> "status?" --to pm
switch-axi attach <room_id> ./plan.md --thread <event_id>
switch-axi fetch <room_id> mxc://server/media-id ./plan.md
```

Every room command takes an explicit `room_id`. `send`, `attach`, and `rooms create` are non-idempotent. Do not retry an ambiguous timeout; check `rooms list` before retrying a create.
Use `--` before a send body that starts with a dash.

The CLI calls Switch operations HTTP endpoints and media routes directly. It sends `room_id` to `post_message`, `send_targeted_message`, and `list_participants`. Current Switch servers need the planned explicit-room operation update for those three calls. Reads, room lists, room creation, auth, generic safe operations, and media routes work without that update.

Run `switch-axi --help` or `switch-axi <command> --help` for structured command data. `ops call` accepts one `--args-json` object and only permits the static safe allowlist (`create_room` and `list_bridges` included). It hides task-protocol operations.
