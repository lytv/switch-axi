---
name: switch-axi
description: Use the Switch AXI CLI for rooms, messages, media, and agent create. Load whenever the user asks to create a new Switch agent, or to run switch-axi. Prefer this over bare MCP create_agent. Covers Claude Code, OpenCode, and Codex creators.
---

# switch-axi

Use `switch-axi --help` for the live command surface.

## Credentials

Resolution order:

1. `SWITCH_API_ENDPOINT`, `SWITCH_API_TOKEN`, `SWITCH_AGENT_ID` in the environment
2. `<cwd>/.switch/agents/<slug>.json`
3. Legacy `.claude/switch-subagents/<name>.settings.json` when `--agent` selects that name

Use `--cwd <dir>` to pick the credential store. Use `--agent <slug>` before the command when the store has more than one agent.

## Create a new agent (required path)

**Do not call bare MCP/ops `create_agent` alone.** That returns `{ id, api_key }` once and does not write a local credential file. Without the file, Switch Console cannot adopt the agent and Auto Session cannot start.

**Always create with the CLI:**

```bash
switch-axi --cwd <creator-workdir> --agent <creator-slug> agents create \
  --name <new-agent-name> \
  --desc "<short description>"
```

### One shared defaults file (all harnesses)

CLI defaults load from `$XDG_CONFIG_HOME/switch-axi/agent-create-defaults.json` when `XDG_CONFIG_HOME` is set. Otherwise, they load from:

```text
~/.config/switch-axi/agent-create-defaults.json
```

Claude, OpenCode, and Codex must use the same config home. Flags override the file.

Typical posture B (new folder per agent name):

```json
{
  "agent_type": "opencode",
  "auto_session": true,
  "base_working_dir": "/Users/lytv/tools/myjira/ceo",
  "git_repo_url": "https://github.com/lytvrks/firstmate",
  "owner_only": false
}
```

With that file set, create clones:

```text
<base_working_dir>/<name>
```

Example: `--name bats2` → `/Users/lytv/tools/myjira/ceo/bats2`, then writes:

```text
/Users/lytv/tools/myjira/ceo/bats2/.switch/agents/bats2.json
```

and sets server `repo_dir` / `auto_session` from defaults.

### Flags you still pass when needed

| Flag                                   | When                                                  |
| -------------------------------------- | ----------------------------------------------------- |
| `--name`, `--desc`                     | Always required                                       |
| `--type opencode\|codex\|claude-code`  | Only to override defaults `agent_type`                |
| `--no-clone`                           | Target dir must not be cloned (reuse existing folder) |
| `--repo-dir <path>`                    | Override computed `<base_working_dir>/<name>`         |
| `--auto-session` / `--no-auto-session` | Override defaults                                     |
| `--owner-only` / `--anyone`            | Override defaults                                     |
| `--option k=v`                         | Extra known-agent options                             |

If `<base_working_dir>/<name>` already exists and `git_repo_url` is set, create fails unless you pass `--no-clone` or a free `--repo-dir`.

### After create - checklist

1. Confirm CLI printed `credential_file` and that path exists on disk.
2. Confirm `id` is present in the output.
3. Add the agent to a room when asked:
   - Prefer MCP `invite_agent_to_room` with the new agent **name**, or
   - Gateway: `POST /gateway/rooms/<room_id>/agents` with `agent_ids`.
4. Console adopt:
   - The CLI queues the working directory for the next Console start.
   - The CLI asks a running Console to open the folder immediately.
   - See README "After create" for the queue file path and handoff details.
5. Confirm the agent appears under **Your Agents** with Auto Session intended.
6. Tell the user to `@name` in the room to prove spawn.

The CLI never prints the API token after write. Do not invent a token file by hand unless the user still has the one-time `api_key` from a mistaken bare create.

### Minimal examples

Defaults already set (posture B):

```bash
switch-axi --cwd /Users/lytv/tools/myjira/ceo/firstmate --agent ceo \
  agents create --name helper --desc "Helps triage"
```

Override type only:

```bash
switch-axi --cwd /Users/lytv/tools/myjira/ceo/firstmate --agent ceo \
  agents create --type codex --name helper --desc "Helps triage"
```

Reuse an existing directory (no clone):

```bash
switch-axi --cwd /Users/lytv/tools/myjira/ceo/firstmate --agent ceo \
  agents create --name helper --desc "Helps triage" \
  --repo-dir /Users/lytv/tools/myjira/ceo/firstmate --no-clone
```

## Other CLI rules

- Use explicit room IDs for room commands.
- `send`, `attach`, and `rooms create` are non-idempotent. Do not retry an ambiguous timeout; check `rooms list` before retrying a create.
- `ops call` only allows the static safe allowlist. Prefer named commands when they exist.
- Run `switch-axi <command> --help` for structured flags.
