---
name: switch-axi
description: Use the Switch AXI CLI for room messages, media, and safe operation discovery.
---

# switch-axi

Use `switch-axi --help` for the current command surface.

The CLI uses `SWITCH_*` variables first. It then reads `.switch/agents/<slug>.json` from the current directory.

Use explicit room IDs. Send and attach actions are non-idempotent. Do not retry after an ambiguous timeout.

`switch-axi agents create` can apply optional defaults from `~/.config/switch-axi/agent-create-defaults.json`. CLI flags override that file. The command writes `<working-dir>/.switch/agents/<name>.json` and never prints the API token.

After create, open Switch Console and drag the working directory onto the sidebar. Local agents also need a one-time auto-approve toggle in Console settings for unattended operation.
