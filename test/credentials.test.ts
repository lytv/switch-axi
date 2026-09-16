import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveCredentials } from "../src/credentials.js";

async function workspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), "switch-axi-"));
}

async function agent(cwd: string, slug: string, id = slug): Promise<void> {
  await mkdir(join(cwd, ".switch", "agents"), { recursive: true });
  await writeFile(
    join(cwd, ".switch", "agents", `${slug}.json`),
    JSON.stringify({
      env: {
        SWITCH_API_ENDPOINT: "http://127.0.0.1:8000/",
        SWITCH_API_TOKEN: `token-${slug}`,
        SWITCH_AGENT_ID: id,
      },
    }),
  );
}

describe("resolveCredentials", () => {
  it("prefers a complete environment", async () => {
    const cwd = await workspace();
    await agent(cwd, "store");
    expect(
      resolveCredentials({
        cwd,
        env: {
          SWITCH_API_ENDPOINT: "https://switch.example/",
          SWITCH_API_TOKEN: "environment-token",
          SWITCH_AGENT_ID: "env-id",
        },
      }),
    ).toMatchObject({
      source: "environment",
      endpoint: "https://switch.example",
      agentId: "env-id",
    });
  });

  it("reads the only store agent", async () => {
    const cwd = await workspace();
    await agent(cwd, "pm", "pm-id");
    expect(resolveCredentials({ cwd, env: {} })).toMatchObject({
      source: "store",
      slug: "pm",
      agentId: "pm-id",
    });
  });

  it("refuses an ambiguous store", async () => {
    const cwd = await workspace();
    await agent(cwd, "pm");
    await agent(cwd, "qa");
    expect(() => resolveCredentials({ cwd, env: {} })).toThrow(
      "multiple Switch agents",
    );
  });

  it("uses the named Claude legacy file after the store misses", async () => {
    const cwd = await workspace();
    await mkdir(join(cwd, ".claude", "switch-subagents"), { recursive: true });
    await writeFile(
      join(cwd, ".claude", "switch-subagents", "qa.settings.json"),
      JSON.stringify({
        env: {
          SWITCH_API_ENDPOINT: "http://127.0.0.1:8000",
          SWITCH_API_TOKEN: "legacy-token",
          SWITCH_AGENT_ID: "qa-id",
        },
      }),
    );
    expect(resolveCredentials({ cwd, agent: "qa", env: {} })).toMatchObject({
      source: "claude-legacy",
      slug: "qa",
      agentId: "qa-id",
    });
  });
});
