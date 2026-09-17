import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../src/cli.js";

async function workspace(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "switch-axi-"));
  await mkdir(join(cwd, ".switch", "agents"), { recursive: true });
  await writeFile(
    join(cwd, ".switch", "agents", "qa.json"),
    JSON.stringify({
      env: {
        SWITCH_API_ENDPOINT: "https://switch.example",
        SWITCH_API_TOKEN: "token-qa",
        SWITCH_AGENT_ID: "qa-id",
      },
    }),
  );
  return cwd;
}

describe("send options", () => {
  it("sends dash-prefixed bodies after the option separator", async () => {
    const cwd = await workspace();
    const bodies: Record<string, unknown>[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ result: {} }));
    };
    try {
      await main({
        argv: ["--cwd", cwd, "--agent", "qa", "send", "room-1", "--", "--help"],
        stdout: { write: () => {} },
      });
      await main({
        argv: [
          "--cwd",
          cwd,
          "--agent",
          "qa",
          "send",
          "room-1",
          "--to",
          "pm",
          "--",
          "--help",
        ],
        stdout: { write: () => {} },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(bodies).toEqual([
      { room_id: "room-1", body: "--help" },
      { room_id: "room-1", body: "--help", target_names: ["pm"] },
    ]);
  });
});
