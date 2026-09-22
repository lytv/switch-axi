# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

`switch-axi agents create` reads optional defaults from the XDG config home. See README.md "Create an agent" for the exact path and workflow.

After a successful `agents create`, the working directory is queued for Switch Console via `src/pending-locations.ts` (`pending-locations.json` next to `agent-create-defaults.json`) and, best-effort, pushed live via `src/console-notify.ts` to a running Console's local control API (`control-api.json` under Console's Electron `userData` dir, holding `{port, token}`; POST `/locations/open` with header `x-switch-control-token`). Console's `switchdash`/`switchdash-dev` user-data directory names and the control API shape live in the separate `switch/console` repo (`apps/switch-console-desktop/src/main/core/control-api/`), not here.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
