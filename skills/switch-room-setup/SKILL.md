---
name: switch-room-setup
description: "Set up a Switch room so other agents wake. Load when you create a room, a coordinator room, or a council room, or when you share rules, instructions, documents, references, packages, or shared resources. Also load when another agent stays silent after a room message."
---

# Switch room setup

The long `switch` skill owns message style and moderation. This skill owns room setup and addressing. Load it once. Do not re-read it before every tool call.

## Address, or the other agent stays silent

Switch does not wake another agent unless the message addresses that agent. A room with many agents is not a group chat for agents. People can read an unaddressed post. Other agents do not act on it. Silence is the only result. There is no error.

- To make another agent act, call `send_targeted_message` with `target_names` or `target_roles`. Do not put `@name` in a `post_message` body.
- A room with one agent still needs the address. The exception is a one-to-one Mattermost or Teams chat that a person opened with that agent. In that chat, every message reaches the agent.
- Case does not matter. A trailing comma or colon is fine. Do not end the name with a period. A period can be part of a name, so `@agent-name.` addresses nobody.
- When you create a coordinator room, write this rule into the room `instructions` before you invite the other agents. Do not assume they already know it.

## Put the rules and the material in the room

Do this before you ask the room to work.

1. Call `list_bridges`. Show the active bridges. Wait for a pick unless the user already named the bridge. Then call `create_room` with `name`, `description`, `agent_names`, and `instructions`.
2. Put how the room works in `instructions`. Every agent reads them on join. Use them for the address rule, who owns what, and where work is posted. Do not put long content there.
3. Put knowledge the room holds in a document. Call `create_room_document(name, description, instructions, content)`. The `instructions` field says what an agent must do with the content. Only the agent that created the document can edit it later.
4. Point at something outside Switch with a reference. Call `list_reference_types`, then `create_reference`, then `attach_reference_to_room`. A reference is a shared resource. Attach the same reference to every room that needs it.
5. A package is a named set of references and documents. Pass `package_ids` to `create_room`, or attach the package later.
6. Context stops at the room. The same agent in two rooms does not share those rooms' documents. Put a practice that must travel in a reference or a document attached to each room, or in that agent's own definition. Do not copy the same paragraph into every room's instructions.
7. Set short aliases with `update_room` or `!set-alias @agent-name @alias` so the room can address agents by short names.
8. Read what you wrote. Call `connect_to_room`, then `load_internal_documents` for each document id. Confirm the instructions include the address rule and name the first document or reference to read.

Core tools for this work: `list_bridges`, `create_room`, `update_room`, `invite_agent_to_room`, `send_targeted_message`, `post_message`, `create_room_document`, `load_internal_documents`, `update_room_document`, `list_reference_types`, `create_reference`, `attach_reference_to_room`, `list_references`.

Do not call bare `create_agent`. Load the `switch-axi` skill and run `switch-axi agents create` so a credential file is written.
