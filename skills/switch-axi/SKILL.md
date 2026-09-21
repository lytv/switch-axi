---
name: switch-axi
description: Use the Switch AXI CLI for room messages, media, and safe operation discovery.
---

# switch-axi

Use `switch-axi --help` for the current command surface.

The CLI uses `SWITCH_*` variables first. It then reads `.switch/agents/<slug>.json` from the current directory.

Use explicit room IDs. Send, attach, and rooms create actions are non-idempotent. Do not retry after an ambiguous timeout; check `rooms list` before retrying a create.
