import { describe, expect, it } from "vitest";
import {
  attachCommand,
  opsCommand,
  readCommand,
  roomsCommand,
  type CommandContext,
} from "../src/commands.js";

const context: CommandContext = { cwd: process.cwd(), json: false, env: {} };
const jsonContext: CommandContext = { cwd: process.cwd(), json: true, env: {} };

type Call = (name: string, args: Record<string, unknown>) => Promise<unknown>;
const stubClient = (call: Call) => () => ({
  call,
  operations: async () => ({}),
  attach: async () => ({}),
  fetch: async () => {},
});
const serverRoom = () => ({
  id: "room-1",
  name: "n",
  transport_room_id: "!abc:switch",
  matrix_room_id: "!abc:switch",
  failed_attachments: ["ref-1"],
});

describe("read command", () => {
  it("renders a truncated thread in TOON", async () => {
    const output = await readCommand(["room-1"], context, () => ({
      call: async () => ({
        threads: [
          {
            root: { id: "event-1", body: "x".repeat(801), attachments: [] },
            replies: [],
          },
        ],
        truncated: false,
      }),
      operations: async () => ({}),
      attach: async () => ({}),
      fetch: async () => {},
    }));
    expect(output).toContain("room_id: room-1");
    expect(output).toContain("use --full");
  });
});

describe("rooms command", () => {
  it("lists only the current agent rooms", async () => {
    const call = async (name: string, args: Record<string, unknown>) => {
      expect(name).toBe("list_rooms");
      expect(args).toEqual({});
      return [];
    };
    await roomsCommand(["list"], context, () => ({
      call,
      operations: async () => ({}),
      attach: async () => ({}),
      fetch: async () => {},
    }));
    await expect(
      roomsCommand(["list", "--scope", "instance"], context),
    ).rejects.toThrow("unknown flag: --scope");
  });
});

describe("rooms create", () => {
  it("maps minimal flags and shapes the output", async () => {
    let seen: Record<string, unknown> = {};
    const output = await roomsCommand(
      [
        "create",
        "--name",
        "n",
        "--desc",
        "d",
        "--agent",
        "a1",
        "--agent",
        "a2",
      ],
      jsonContext,
      stubClient(async (name, args) => {
        expect(name).toBe("create_room");
        seen = args;
        return serverRoom();
      }),
    );
    expect(seen).toEqual({
      name: "n",
      description: "d",
      agent_names: ["a1", "a2"],
    });
    const data = JSON.parse(output) as {
      room: unknown;
      failed_attachments: unknown;
      idempotency: unknown;
    };
    expect(data.room).toEqual({
      id: "room-1",
      name: "n",
      transport_room_id: "!abc:switch",
    });
    expect(data.failed_attachments).toEqual(["ref-1"]);
    expect(data.idempotency).toContain("non-idempotent");
    expect(output).not.toContain("matrix_room_id");
  });

  it("maps bridge, users, instructions, internal-only, and args-json extras", async () => {
    let seen: Record<string, unknown> = {};
    await roomsCommand(
      [
        "create",
        "--name",
        "n",
        "--desc",
        "d",
        "--agent",
        "a",
        "--user",
        "u1",
        "--user",
        "u2",
        "--bridge",
        "b1",
        "--channel-type",
        "channel_private",
        "--instructions",
        "be nice",
        "--args-json",
        '{"security_config":{"mode":"x"},"description":"from-json"}',
      ],
      jsonContext,
      stubClient(async (_name, args) => {
        seen = args;
        return serverRoom();
      }),
    );
    expect(seen).toMatchObject({
      name: "n",
      user_names: ["u1", "u2"],
      bridge_id: "b1",
      channel_type: "channel_private",
      instructions: "be nice",
      security_config: { mode: "x" },
    });
    // explicit flags win over --args-json on conflict
    expect(seen.description).toBe("d");
  });

  it("supports --internal-only without a bridge", async () => {
    let seen: Record<string, unknown> = {};
    await roomsCommand(
      [
        "create",
        "--name",
        "n",
        "--desc",
        "d",
        "--agent",
        "a",
        "--internal-only",
      ],
      jsonContext,
      stubClient(async (_name, args) => {
        seen = args;
        return serverRoom();
      }),
    );
    expect(seen).toMatchObject({ internal_only: true });
    expect(seen).not.toHaveProperty("bridge_id");
  });

  it("fails loud on mutual exclusion and missing fields", async () => {
    const noop = stubClient(async () => serverRoom());
    await expect(
      roomsCommand(
        [
          "create",
          "--name",
          "n",
          "--desc",
          "d",
          "--agent",
          "a",
          "--bridge",
          "b",
          "--internal-only",
          "--channel-type",
          "direct",
        ],
        context,
        noop,
      ),
    ).rejects.toThrow("mutually exclusive");
    await expect(
      roomsCommand(
        [
          "create",
          "--name",
          "n",
          "--desc",
          "d",
          "--agent",
          "a",
          "--bridge",
          "b",
        ],
        context,
        noop,
      ),
    ).rejects.toThrow("--channel-type is required");
    await expect(
      roomsCommand(["create", "--desc", "d", "--agent", "a"], context, noop),
    ).rejects.toThrow("usage: switch-axi rooms create");
    await expect(
      roomsCommand(["create", "--name", "n", "--desc", "d"], context, noop),
    ).rejects.toThrow("usage: switch-axi rooms create");
    await expect(
      roomsCommand(
        [
          "create",
          "--name",
          "n",
          "--desc",
          "d",
          "--agent",
          "a",
          "--args-json",
          "[1]",
        ],
        context,
        noop,
      ),
    ).rejects.toThrow("--args-json must be one JSON object");
  });

  it("keeps --admin-mode and security_config out of first-class flags", async () => {
    const noop = stubClient(async () => serverRoom());
    await expect(
      roomsCommand(
        [
          "create",
          "--name",
          "n",
          "--desc",
          "d",
          "--agent",
          "a",
          "--admin-mode",
        ],
        context,
        noop,
      ),
    ).rejects.toThrow("unknown flag: --admin-mode");
    await expect(
      roomsCommand(
        [
          "create",
          "--name",
          "n",
          "--desc",
          "d",
          "--agent",
          "a",
          "--security-config",
          "{}",
        ],
        context,
        noop,
      ),
    ).rejects.toThrow("unknown flag: --security-config");
    let seen: Record<string, unknown> = {};
    await roomsCommand(
      [
        "create",
        "--name",
        "n",
        "--desc",
        "d",
        "--agent",
        "a",
        "--args-json",
        '{"admin_mode":true,"security_config":{"mode":"x"}}',
      ],
      jsonContext,
      stubClient(async (_name, args) => {
        seen = args;
        return serverRoom();
      }),
    );
    expect(seen).toMatchObject({
      admin_mode: true,
      security_config: { mode: "x" },
    });
  });
});

describe("ops allowlist", () => {
  const catalog = {
    create_room: { description: "c", input_schema: {} },
    list_bridges: { description: "b", input_schema: {} },
    delete_room: { description: "d", input_schema: {} },
  };
  const factory = () => ({
    call: async () => ({}),
    operations: async () => catalog,
    attach: async () => ({}),
    fetch: async () => {},
  });
  it("exposes create_room and list_bridges but not other ops", async () => {
    const schema = JSON.parse(
      await opsCommand(["schema", "create_room"], jsonContext, factory),
    ) as Record<string, unknown>;
    expect(schema.name).toBe("create_room");
    await opsCommand(
      ["call", "create_room", "--args-json", "{}"],
      jsonContext,
      factory,
    );
    await opsCommand(
      ["call", "list_bridges", "--args-json", "{}"],
      jsonContext,
      factory,
    );
    await expect(
      opsCommand(["schema", "delete_room"], jsonContext, factory),
    ).rejects.toThrow("not available through switch-axi");
  });
});

describe("attach command", () => {
  it("uploads one file and keeps the thread association", async () => {
    const attach = async (roomId: string, path: string, threadId?: string) => {
      expect(roomId).toBe("room-1");
      expect(path).toBe(`${process.cwd()}/plan.md`);
      expect(threadId).toBe("event-1");
      return {};
    };
    await attachCommand(
      ["room-1", "plan.md", "--thread", "event-1"],
      context,
      () => ({
        call: async () => ({}),
        operations: async () => ({}),
        attach,
        fetch: async () => {},
      }),
    );
    await expect(
      attachCommand(["room-1", "one.md", "two.md"], context),
    ).rejects.toThrow("usage: switch-axi attach <room_id> <path>");
  });
});
