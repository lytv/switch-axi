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
switch-axi agents create --type opencode --name helper --desc "Helps triage"
```

## Create an agent

`switch-axi agents create` registers a new Switch agent and writes its credential file as `<working-dir>/.switch/agents/<name>.json` in the Console nested-env shape.

Optional defaults live in `~/.config/switch-axi/agent-create-defaults.json`. All keys are optional. CLI flags override config values.

```json
{
  "agent_type": "opencode",
  "auto_session": true,
  "base_working_dir": "/Users/lytv/tools/myjira/",
  "git_repo_url": "https://github.com/lytvrks/firstmate",
  "owner_only": false
}
```

When `base_working_dir` and `git_repo_url` are set, the command clones the repo into `<base_working_dir>/<name>` before it calls the API. Use `--repo-dir` to override that path. Use `--no-clone` to skip the clone. The command fails if the base directory does not exist, if the target directory already exists, or if `git` is missing.

After create, open Switch Console and drag the working directory onto the sidebar. That is the one remaining manual step. Local agents also need a one-time auto-approve toggle in Console settings if you want unattended operation.

Every room command takes an explicit `room_id`. `send`, `attach`, and `rooms create` are non-idempotent. Do not retry an ambiguous timeout; check `rooms list` before retrying a create.
Use `--` before a send body that starts with a dash.

The CLI calls Switch operations HTTP endpoints and media routes directly. It sends `room_id` to `post_message`, `send_targeted_message`, and `list_participants`. Current Switch servers need the planned explicit-room operation update for those three calls. Reads, room lists, room creation, auth, generic safe operations, and media routes work without that update.

Run `switch-axi --help` or `switch-axi <command> --help` for structured command data. `ops call` accepts one `--args-json` object and only permits the static safe allowlist (`create_room` and `list_bridges` included). It hides task-protocol operations.
