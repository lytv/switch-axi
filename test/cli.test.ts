import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../src/cli.js";

describe("root help", () => {
  it("describes the credential write and Console adoption", async () => {
    let output = "";
    await main({
      argv: ["--help"],
      stdout: { write: (chunk: string) => (output += chunk) },
    });
    expect(output).toContain(
      "Create writes <workdir>/.switch/agents/<name>.json",
    );
    expect(output).toContain("Console auto-adopts credentials");
    expect(output).toContain("$XDG_CONFIG_HOME/switch-axi");
  });
});

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

describe("rooms create entry", () => {
  it("passes command-position --agent to create_room, not the credential store", async () => {
    const cwd = await workspace();
    const calls: { url: string; auth: string; body: unknown }[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      calls.push({
        url: String(input),
        auth: String(
          (init?.headers as Record<string, string>)?.Authorization ?? "",
        ),
        body: JSON.parse(String(init?.body)),
      });
      return new Response(
        JSON.stringify({
          result: {
            id: "room-1",
            name: "n",
            transport_room_id: "!abc:switch",
            failed_attachments: [],
          },
        }),
      );
    };
    let output = "";
    try {
      await main({
        argv: [
          "--cwd",
          cwd,
          "--agent",
          "qa",
          "rooms",
          "create",
          "--name",
          "n",
          "--desc",
          "d",
          "--agent",
          "member-1",
          "--json",
        ],
        stdout: {
          write: (chunk: string) => {
            output += chunk;
          },
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(calls).toHaveLength(1);
    // leading --agent selects the credential store entry (qa-id in the URL),
    // command-position --agent becomes the room member list in the body.
    expect(calls[0].url).toBe(
      "https://switch.example/agents/qa-id/ops/create_room",
    );
    expect(calls[0].auth).toBe("Bearer token-qa");
    expect(calls[0].body).toEqual({
      name: "n",
      description: "d",
      agent_names: ["member-1"],
    });
    const data = JSON.parse(output) as { room: unknown };
    expect(data.room).toEqual({
      id: "room-1",
      name: "n",
      transport_room_id: "!abc:switch",
    });
  });
});

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
