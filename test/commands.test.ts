import { describe, expect, it } from "vitest";
import { readCommand, type CommandContext } from "../src/commands.js";

describe("read command", () => {
  it("renders a truncated thread in TOON", async () => {
    const context: CommandContext = {
      cwd: process.cwd(),
      json: false,
      env: {},
    };
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
