import { describe, expect, it } from "vitest";
import {
  attachCommand,
  readCommand,
  roomsCommand,
  type CommandContext,
} from "../src/commands.js";

const context: CommandContext = { cwd: process.cwd(), json: false, env: {} };

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
    await expect(roomsCommand(["list", "--scope", "instance"], context)).rejects.toThrow(
      "unknown flag: --scope",
    );
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
    await attachCommand(["room-1", "plan.md", "--thread", "event-1"], context, () => ({
      call: async () => ({}),
      operations: async () => ({}),
      attach,
      fetch: async () => {},
    }));
    await expect(attachCommand(["room-1", "one.md", "two.md"], context)).rejects.toThrow(
      "usage: switch-axi attach <room_id> <path>",
    );
  });
});
