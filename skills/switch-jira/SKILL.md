---
name: switch-jira
description: Manage Switch Jira trigger rules with the switch-axi CLI (same binary, `jira` command group). Load when the user asks to set up a Jira trigger, dry-run a rule, diagnose a missed firing, or list Jira deliveries. Covers trigger CRUD over the agent bearer-token channel.
---

# switch-jira

Use `switch-axi jira --help` for the live command surface. All subcommands use the existing agent bearer-token transport (`/agents/{id}/ops/...`); no admin login needed.

Trigger phrases: "set up a Jira trigger", "wake me when Jira ...", "why didn't the Jira rule fire", "dry-run the Jira rule".

## Prerequisites (check before creating a rule)

1. The Jira instance already exists in server config (`JIRA_WEBHOOK_SECRETS` + restart). Verify with `switch-axi jira instances list`. An empty list means server config is missing - stop and tell the operator.
2. The target agent must already exist **and** already be a member of the target room before it can receive deliveries. The server rejects the save otherwise.
3. The `jira` system agent must also be a member of the target room.
4. The target agent's addressing policy must allow the `jira` agent (owner-only policies block it).

## Commands

```bash
switch-axi jira instances list
switch-axi jira triggers list [--instance <name>]
switch-axi jira triggers show <id>
switch-axi jira triggers dry-run <id> [--overrides '<object>'] [--payload <file>]
switch-axi jira deliveries list [--instance <name>] [--rule <id>] [--limit <n>]
switch-axi jira tokens
switch-axi jira agent-options --room <id>  # or: --group <id>

switch-axi jira triggers add --name <n> --instance <i> \
  --fire-on created|updated|transition \
  --template "<text with {{tokens}}>" \
  --target room|group --room|--group <id> --agent <name> \
  [--project <key>] [--issue-type <t>] [--target-status <s>] \
  [--jql <filter>] [--thread-by new|issue_key] [--disabled]
switch-axi jira triggers update <id> [same field flags, plus --enabled]
switch-axi jira triggers delete <id>   # prompts; --yes skips the prompt
```

`triggers add` defaults: `target_kind=room` is NOT assumed - `--target` is required; `thread_by=new`, enabled unless `--disabled`. `dry-run` never posts (`would_post` is always false); the default sample event is PROJ-123.

## Instances are server configuration only

There is no `instances add`/`create` command, and none should be added. Instance creation stays an operator step (server config + restart).

## Secret hygiene

Webhook secret reveal and rotation stay **admin-UI-only** (admin login required, `/jira-triggers` page). This CLI never prints or mints a real secret - `instances list` shows the masked secret only. Never paste a revealed secret into a room message, a log, or a persisted file; after any rotation, update Jira's `X-Switch-Secret` header immediately.

## When a rule does not fire (diagnosis order)

1. `switch-axi jira deliveries list --rule <id>` - shows the error per attempt.
2. `PermissionError: Agent is not a member of this room` - the `jira` system agent is not in the target room. Add it, then fire a fresh event (failed deliveries are not retried).
3. `NOT_PERMITTED` on an addressed send - the target agent's addressing policy blocks the `jira` agent. The owner must allow the Jira agent (keep owner access).
4. Dry-run misses with a filter reason (`Project filter`, ...) - the rule's `project`/`issue-type`/`target-status`/`jql` does not match the event. Adjust with `triggers update`.
