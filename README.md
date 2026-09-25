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
switch-axi jira instances list
switch-axi jira triggers list
switch-axi jira triggers dry-run <id>
```

## Jira triggers

The `jira` command group manages Switch Jira trigger rules (when a Jira event mentions an agent) over the same agent bearer-token transport. Load the packaged `switch-jira` skill for the full workflow.

```sh
switch-axi jira triggers add --name "KAN to In Progress" --instance acme \
  --project KAN --fire-on transition --target-status "In Progress" \
  --target room --room dev-room --agent coder \
  --template "{{issue.key}} {{issue.summary}} is now {{issue.status}} ({{issue.url}})"
switch-axi jira deliveries list --rule <id>
```

A Jira instance is server configuration only (`JIRA_WEBHOOK_SECRETS` + restart): there is no `instances add`/`create` command. Webhook secret reveal and rotation stay admin-UI-only (admin login required); the CLI only ever shows the masked secret. An agent must already exist and be a room member before it can receive trigger deliveries.

## Create an agent

`switch-axi agents create` is the required create path. Do not use bare MCP/ops `create_agent` alone: that returns the API key once and does not write a local credential file, so Switch Console cannot adopt the agent.

The CLI registers the agent and writes `<working-dir>/.switch/agents/<name>.json` in the Console nested-env shape. The token is not printed after write.

### Defaults (one file, every coding agent)

Optional defaults live in `$XDG_CONFIG_HOME/switch-axi/agent-create-defaults.json` when `XDG_CONFIG_HOME` is set. Otherwise, they live in `~/.config/switch-axi/agent-create-defaults.json`. All keys are optional. CLI flags override config values. Claude, OpenCode, and Codex creators must use the same config home when they run the CLI.

```json
{
  "agent_type": "opencode",
  "auto_session": true,
  "base_working_dir": "/Users/lytv/tools/myjira/ceo",
  "git_repo_url": "https://github.com/lytvrks/firstmate",
  "owner_only": false
}
```

When `base_working_dir` and `git_repo_url` are set, the command clones the repo into `<base_working_dir>/<name>` (the agent name is the folder name) before it calls the API. Credentials land at `<base_working_dir>/<name>/.switch/agents/<name>.json`. Use `--repo-dir` to override that path. Use `--no-clone` to skip the clone. The command fails if the base directory does not exist, if the target directory already exists, or if `git` is missing.

With defaults set, the short form is enough:

```sh
switch-axi --cwd <creator-workdir> --agent <creator> \
  agents create --name helper --desc "Helps triage"
```

### After create

1. Confirm the printed `credential_file` exists.
2. Invite the agent into any room that needs it (`invite_agent_to_room` by name, or the gateway room agents API).
3. Switch Console auto-adopts credentials under an already-onboarded location. The CLI tries to save the absolute working directory to `$XDG_CONFIG_HOME/switch-axi/pending-locations.json`, or `~/.config/switch-axi/pending-locations.json` when unset. Console reads this file when it starts. If a Console runs and exposes its local control API, the CLI also asks it to open the folder immediately. The command still succeeds if it cannot save the queue or contact Console.
4. Local agents still need a one-time auto-approve toggle in Console when you want unattended tool use.

Load the packaged `switch-axi` skill (installed under shared skills as `switch-axi`) whenever an agent is asked to create another agent. Installing `switch-axi` also installs the `switch-room-setup` and `switch-jira` skills.

Every room command takes an explicit `room_id`. `send`, `attach`, and `rooms create` are non-idempotent. Do not retry an ambiguous timeout; check `rooms list` before retrying a create.
Use `--` before a send body that starts with a dash.

The CLI calls Switch operations HTTP endpoints and media routes directly. It sends `room_id` to `post_message`, `send_targeted_message`, and `list_participants`. Current Switch servers need the planned explicit-room operation update for those three calls. Reads, room lists, room creation, auth, generic safe operations, and media routes work without that update.

Run `switch-axi --help` or `switch-axi <command> --help` for structured command data. `ops call` accepts one `--args-json` object and only permits the static safe allowlist (`create_room` and `list_bridges` included). It hides task-protocol operations.
