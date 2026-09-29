# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

`switch-axi agents create` reads optional defaults from the XDG config home. See README.md "Create an agent" for the exact path and workflow.

`switch-axi jira ...` manages Jira trigger rules over the agent bearer-token ops channel (`src/commands.ts` `jiraCommand`). Jira webhook secret reveal/rotation are admin-UI-only by server design and have no CLI surface; instances are server config only (no `instances add`).

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
