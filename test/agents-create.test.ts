import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentsCommand, type CommandContext } from "../src/commands.js";

function factoryFor(
  call: (name: string, args: Record<string, unknown>) => Promise<unknown>,
) {
  return () => ({
    call,
    operations: async () => ({}),
    attach: async () => ({}),
    fetch: async () => {},
  });
}

async function sandbox(): Promise<string> {
  return mkdtemp(join(tmpdir(), "switch-axi-create-"));
}

describe("agents create", () => {
  it("maps flags to create_agent and writes a 0600 key file without leaking the key", async () => {
    const cwd = await sandbox();
    const seen: { name?: string; args?: Record<string, unknown> } = {};
    const output = await agentsCommand(
      [
        "create",
        "--type",
        "opencode",
        "--name",
        "helper",
        "--desc",
        "Helps triage",
        "--option",
        "model=opus",
        "--option",
        "region=us",
        "--icon-url",
        "https://example.com/icon.png",
        "--display-name",
        "Helper",
      ],
      { cwd, json: true, env: {} } satisfies CommandContext,
      factoryFor(async (name, args) => {
        seen.name = name;
        seen.args = args;
        return { id: "agent-1", api_key: "secret-key" };
      }),
    );
    expect(seen.name).toBe("create_agent");
    expect(seen.args).toEqual({
      agent_type: "opencode",
      name: "helper",
      description: "Helps triage",
      options: { model: "opus", region: "us" },
      icon_url: "https://example.com/icon.png",
      display_name: "Helper",
    });
    expect(output).toContain("agent-1");
    expect(output).toContain("helper");
    expect(output).not.toContain("secret-key");
    const file = join(cwd, "helper.switch-agent-key.json");
    expect(output).toContain(file);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({
      id: "agent-1",
      api_key: "secret-key",
    });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it("omits optional fields when their flags are absent", async () => {
    const cwd = await sandbox();
    let captured: Record<string, unknown> = {};
    await agentsCommand(
      ["create", "--type", "codex", "--name", "n", "--desc", "d"],
      { cwd, json: true, env: {} } satisfies CommandContext,
      factoryFor(async (_name, args) => {
        captured = args;
        return { id: "agent-2", api_key: "k" };
      }),
    );
    expect(captured).toEqual({
      agent_type: "codex",
      name: "n",
      description: "d",
    });
  });

  it("validates required flags, types, and option shape", async () => {
    const cwd = await sandbox();
    const context = { cwd, json: true, env: {} } satisfies CommandContext;
    const factory = factoryFor(async () => ({}));
    await expect(
      agentsCommand(["create", "--name", "n", "--desc", "d"], context, factory),
    ).rejects.toThrow("usage: switch-axi agents create");
    await expect(
      agentsCommand(
        ["create", "--type", "opencode", "--desc", "d"],
        context,
        factory,
      ),
    ).rejects.toThrow("usage: switch-axi agents create");
    await expect(
      agentsCommand(
        ["create", "--type", "opencode", "--name", "n"],
        context,
        factory,
      ),
    ).rejects.toThrow("usage: switch-axi agents create");
    await expect(
      agentsCommand(
        ["create", "--type", "bogus", "--name", "n", "--desc", "d"],
        context,
        factory,
      ),
    ).rejects.toThrow("--type must be one of claude-code, codex, opencode");
    await expect(
      agentsCommand(
        [
          "create",
          "--type",
          "opencode",
          "--name",
          "n",
          "--desc",
          "d",
          "--option",
          "no-equals",
        ],
        context,
        factory,
      ),
    ).rejects.toThrow("--option must be k=v");
    await expect(
      agentsCommand(
        [
          "create",
          "--type",
          "opencode",
          "--name",
          "n",
          "--desc",
          "d",
          "--overwrite",
        ],
        context,
        factory,
      ),
    ).rejects.toThrow("unknown flag: --overwrite");
  });

  it("reports a write failure clearly and leaves no partial key file", async () => {
    const cwd = join(await sandbox(), "missing-dir");
    const target = join(cwd, "helper.switch-agent-key.json");
    await expect(
      agentsCommand(
        ["create", "--type", "opencode", "--name", "helper", "--desc", "d"],
        { cwd, json: true, env: {} } satisfies CommandContext,
        factoryFor(async () => ({ id: "agent-1", api_key: "secret-key" })),
      ),
    ).rejects.toThrow(`failed to write credential file ${target}`);
    await expect(stat(target)).rejects.toThrow();
  });

  it("renders a 403 as a gateway-permission message, not a generic error", async () => {
    const cwd = await sandbox();
    await expect(
      agentsCommand(
        ["create", "--type", "opencode", "--name", "helper", "--desc", "d"],
        { cwd, json: true, env: {} } satisfies CommandContext,
        factoryFor(async () => {
          throw new Error("Switch API request failed (HTTP 403): forbidden");
        }),
      ),
    ).rejects.toThrow(/gateway settings/);
  });

  it("renders a 409 name clash as a create-only message", async () => {
    const cwd = await sandbox();
    await expect(
      agentsCommand(
        ["create", "--type", "opencode", "--name", "helper", "--desc", "d"],
        { cwd, json: true, env: {} } satisfies CommandContext,
        factoryFor(async () => {
          throw new Error("Switch API request failed (HTTP 409): exists");
        }),
      ),
    ).rejects.toThrow(/already exists/);
  });
});
