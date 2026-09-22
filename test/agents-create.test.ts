import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { agentCreateDefaultsPath } from "../src/agent-defaults.js";
import type { Operation } from "../src/client.js";
import { agentsCommand, type CommandContext } from "../src/commands.js";
import {
  addPendingLocation,
  pendingLocationsPath,
} from "../src/pending-locations.js";

const execFile = promisify(execFileCallback);
const secret = "api-key-must-not-leak";

function factoryFor(
  call: (name: string, args: Record<string, unknown>) => Promise<unknown>,
  operations: Record<string, Operation> = {},
) {
  return () => ({
    call,
    operations: async () => operations,
    attach: async () => ({}),
    fetch: async () => {},
  });
}

const ownerOnlyOps: Record<string, Operation> = {
  create_agent: {
    description: "create",
    input_schema: {
      type: "object",
      properties: { owner_only: { type: "boolean" } },
    },
  },
};

async function sandbox(): Promise<string> {
  return mkdtemp(join(tmpdir(), "switch-axi-create-"));
}

function testEnv(
  cwd: string,
  extra: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    HOME: cwd,
    XDG_CONFIG_HOME: join(cwd, "xdg-config"),
    PATH: process.env.PATH,
    SWITCH_API_ENDPOINT: "https://switch.example",
    SWITCH_API_TOKEN: "token-qa",
    SWITCH_AGENT_ID: "qa-id",
    ...extra,
  };
}

function contextFor(
  cwd: string,
  extra: NodeJS.ProcessEnv = {},
): CommandContext {
  return { cwd, json: true, env: testEnv(cwd, extra) };
}

async function writeDefaults(
  cwd: string,
  data: Record<string, unknown>,
): Promise<string> {
  const file = agentCreateDefaultsPath(testEnv(cwd));
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, JSON.stringify(data));
  return file;
}

async function initRepo(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await execFile("git", ["init"], { cwd: dir });
  await execFile("git", ["config", "user.email", "test@example.com"], {
    cwd: dir,
  });
  await execFile("git", ["config", "user.name", "Test"], { cwd: dir });
  await writeFile(join(dir, "README.md"), "repo\n");
  await execFile("git", ["add", "README.md"], { cwd: dir });
  await execFile("git", ["commit", "-m", "init"], { cwd: dir });
}

function expectNoSecret(text: string): void {
  expect(text).not.toContain(secret);
}

describe("agents create", () => {
  it("maps flags to create_agent and writes a 0600 Console credential file without leaking the key", async () => {
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
      contextFor(cwd),
      factoryFor(async (name, args) => {
        seen.name = name;
        seen.args = args;
        return { id: "agent-1", api_key: secret };
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
    expectNoSecret(output);
    const file = join(cwd, ".switch", "agents", "helper.json");
    expect(output).toContain(file);
    expect(output).toContain("auto-adopt");
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({
      env: {
        SWITCH_AGENT_ID: "agent-1",
        SWITCH_API_ENDPOINT: "https://switch.example",
        SWITCH_API_TOKEN: secret,
      },
    });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(
      await readFile(join(cwd, ".switch", "agents", ".gitignore"), "utf8"),
    ).toBe("*\n");
  });

  it("omits optional fields when their flags are absent", async () => {
    const cwd = await sandbox();
    let captured: Record<string, unknown> = {};
    await agentsCommand(
      ["create", "--type", "codex", "--name", "n", "--desc", "d"],
      contextFor(cwd),
      factoryFor(async (_name, args) => {
        captured = args;
        return { id: "agent-2", api_key: secret };
      }),
    );
    expect(captured).toEqual({
      agent_type: "codex",
      name: "n",
      description: "d",
    });
  });

  it("prefers CLI flags over config over built-in defaults", async () => {
    const cwd = await sandbox();
    const base = join(cwd, "base");
    await mkdir(base);
    const override = join(cwd, "override");
    await writeDefaults(cwd, {
      agent_type: "claude-code",
      auto_session: false,
      owner_only: true,
      base_working_dir: base,
    });
    let captured: Record<string, unknown> = {};
    const output = await agentsCommand(
      [
        "create",
        "--type",
        "opencode",
        "--name",
        "helper",
        "--desc",
        "d",
        "--auto-session",
        "--anyone",
        "--repo-dir",
        override,
        "--no-clone",
      ],
      contextFor(cwd),
      factoryFor(async (_name, args) => {
        captured = args;
        return { id: "agent-3", api_key: secret };
      }, ownerOnlyOps),
    );
    expectNoSecret(output);
    expect(captured).toEqual({
      agent_type: "opencode",
      name: "helper",
      description: "d",
      options: { auto_session: true, repo_dir: override },
      owner_only: false,
    });
    expect(
      JSON.parse(
        await readFile(
          join(override, ".switch", "agents", "helper.json"),
          "utf8",
        ),
      ),
    ).toEqual({
      env: {
        SWITCH_AGENT_ID: "agent-3",
        SWITCH_API_ENDPOINT: "https://switch.example",
        SWITCH_API_TOKEN: secret,
      },
    });
  });

  it("uses config values when CLI flags are absent", async () => {
    const cwd = await sandbox();
    const base = join(cwd, "base");
    await mkdir(base);
    await writeDefaults(cwd, {
      agent_type: "opencode",
      auto_session: true,
      owner_only: false,
      base_working_dir: base,
    });
    let captured: Record<string, unknown> = {};
    const output = await agentsCommand(
      ["create", "--name", "helper", "--desc", "d", "--no-clone"],
      contextFor(cwd),
      factoryFor(async (_name, args) => {
        captured = args;
        return { id: "agent-4", api_key: secret };
      }, ownerOnlyOps),
    );
    expectNoSecret(output);
    const target = join(base, "helper");
    expect(captured).toEqual({
      agent_type: "opencode",
      name: "helper",
      description: "d",
      options: { auto_session: true, repo_dir: target },
      owner_only: false,
    });
    expect(
      JSON.parse(
        await readFile(
          join(target, ".switch", "agents", "helper.json"),
          "utf8",
        ),
      ),
    ).toHaveProperty("env.SWITCH_AGENT_ID", "agent-4");
  });

  it("sends owner_only false by default when the server advertises it", async () => {
    const cwd = await sandbox();
    let captured: Record<string, unknown> = {};
    const output = await agentsCommand(
      ["create", "--type", "opencode", "--name", "helper", "--desc", "d"],
      contextFor(cwd),
      factoryFor(async (_name, args) => {
        captured = args;
        return { id: "agent-5", api_key: secret };
      }, ownerOnlyOps),
    );
    expectNoSecret(output);
    expect(captured.owner_only).toBe(false);
  });

  it("omits owner_only when the server schema does not advertise it", async () => {
    const cwd = await sandbox();
    let captured: Record<string, unknown> = {};
    const output = await agentsCommand(
      [
        "create",
        "--type",
        "opencode",
        "--name",
        "helper",
        "--desc",
        "d",
        "--anyone",
      ],
      contextFor(cwd),
      factoryFor(async (_name, args) => {
        captured = args;
        return { id: "agent-6", api_key: secret };
      }),
    );
    expectNoSecret(output);
    expect(captured).not.toHaveProperty("owner_only");
    expect(output).toContain("does not advertise owner_only");
  });

  it("clones the configured repo into base/name and writes credentials there", async () => {
    const cwd = await sandbox();
    const source = join(cwd, "source");
    const base = join(cwd, "base");
    await initRepo(source);
    await mkdir(base);
    await writeDefaults(cwd, {
      git_repo_url: source,
      base_working_dir: base,
    });
    const output = await agentsCommand(
      ["create", "--type", "opencode", "--name", "helper", "--desc", "d"],
      contextFor(cwd),
      factoryFor(async () => ({ id: "agent-7", api_key: secret })),
    );
    expectNoSecret(output);
    const target = join(base, "helper");
    expect(await readFile(join(target, "README.md"), "utf8")).toBe("repo\n");
    const file = join(target, ".switch", "agents", "helper.json");
    expect(output).toContain(file);
    expect(JSON.parse(await readFile(file, "utf8")).env.SWITCH_API_TOKEN).toBe(
      secret,
    );
  });

  it("fails fast when the target directory already exists, before the API call", async () => {
    const cwd = await sandbox();
    const source = join(cwd, "source");
    const base = join(cwd, "base");
    await initRepo(source);
    await mkdir(join(base, "helper"), { recursive: true });
    await writeDefaults(cwd, {
      git_repo_url: source,
      base_working_dir: base,
    });
    let called = false;
    await expect(
      agentsCommand(
        ["create", "--type", "opencode", "--name", "helper", "--desc", "d"],
        contextFor(cwd),
        factoryFor(async () => {
          called = true;
          return { id: "agent-x", api_key: secret };
        }),
      ),
    ).rejects.toThrow(
      `target directory already exists: ${join(base, "helper")}`,
    );
    expect(called).toBe(false);
  });

  it("fails fast when base_working_dir does not exist, before the API call", async () => {
    const cwd = await sandbox();
    const missing = join(cwd, "missing-base");
    await writeDefaults(cwd, { base_working_dir: missing });
    let called = false;
    await expect(
      agentsCommand(
        [
          "create",
          "--type",
          "opencode",
          "--name",
          "helper",
          "--desc",
          "d",
          "--no-clone",
        ],
        contextFor(cwd),
        factoryFor(async () => {
          called = true;
          return { id: "agent-x", api_key: secret };
        }),
      ),
    ).rejects.toThrow(`base_working_dir does not exist: ${missing}`);
    expect(called).toBe(false);
  });

  it("fails fast when git is not on PATH, before the API call", async () => {
    const cwd = await sandbox();
    const source = join(cwd, "source");
    const base = join(cwd, "base");
    await initRepo(source);
    await mkdir(base);
    await writeDefaults(cwd, {
      git_repo_url: source,
      base_working_dir: base,
    });
    let called = false;
    await expect(
      agentsCommand(
        ["create", "--type", "opencode", "--name", "helper", "--desc", "d"],
        contextFor(cwd, { PATH: join(cwd, "no-git-bin") }),
        factoryFor(async () => {
          called = true;
          return { id: "agent-x", api_key: secret };
        }),
      ),
    ).rejects.toThrow("git is not on PATH");
    expect(called).toBe(false);
  });

  it("removes the target directory after a clone failure and reports git stderr", async () => {
    const cwd = await sandbox();
    const base = join(cwd, "base");
    await mkdir(base);
    const bogus = join(cwd, "not-a-repo");
    await mkdir(bogus);
    await writeDefaults(cwd, {
      git_repo_url: bogus,
      base_working_dir: base,
    });
    let called = false;
    await expect(
      agentsCommand(
        ["create", "--type", "opencode", "--name", "helper", "--desc", "d"],
        contextFor(cwd),
        factoryFor(async () => {
          called = true;
          return { id: "agent-x", api_key: secret };
        }),
      ),
    ).rejects.toThrow(/git clone failed; removed /);
    expect(called).toBe(false);
    await expect(stat(join(base, "helper"))).rejects.toThrow();
  });

  it("fails fast on an invalid defaults file before any API call", async () => {
    const cwd = await sandbox();
    const file = await writeDefaults(cwd, { agent_type: "nope" } as never);
    let called = false;
    await expect(
      agentsCommand(
        ["create", "--type", "opencode", "--name", "helper", "--desc", "d"],
        contextFor(cwd),
        factoryFor(async () => {
          called = true;
          return { id: "agent-x", api_key: secret };
        }),
      ),
    ).rejects.toThrow(
      `invalid agent-create defaults file ${file}: unknown agent_type`,
    );
    expect(called).toBe(false);
  });

  it("validates required flags, types, and option shape", async () => {
    const cwd = await sandbox();
    const context = contextFor(cwd);
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
    const cwd = await sandbox();
    await writeFile(join(cwd, ".switch"), "not-a-directory");
    const target = join(cwd, ".switch", "agents", "helper.json");
    await expect(
      agentsCommand(
        ["create", "--type", "opencode", "--name", "helper", "--desc", "d"],
        contextFor(cwd),
        factoryFor(async () => ({ id: "agent-1", api_key: secret })),
      ),
    ).rejects.toThrow(`failed to write credential file ${target}`);
    await expect(stat(target)).rejects.toThrow();
  });

  it("renders a 403 as a gateway-permission message, not a generic error", async () => {
    const cwd = await sandbox();
    await expect(
      agentsCommand(
        ["create", "--type", "opencode", "--name", "helper", "--desc", "d"],
        contextFor(cwd),
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
        contextFor(cwd),
        factoryFor(async () => {
          throw new Error("Switch API request failed (HTTP 409): exists");
        }),
      ),
    ).rejects.toThrow(/already exists/);
  });

  it("never prints the api_key on success or failure", async () => {
    const cwd = await sandbox();
    const success = await agentsCommand(
      ["create", "--type", "opencode", "--name", "helper", "--desc", "d"],
      contextFor(cwd),
      factoryFor(async () => ({ id: "agent-8", api_key: secret })),
    );
    expectNoSecret(success);
    try {
      await agentsCommand(
        ["create", "--type", "opencode", "--name", "helper", "--desc", "d"],
        contextFor(cwd),
        factoryFor(async () => {
          throw new Error("Switch API request failed (HTTP 403): forbidden");
        }),
      );
      throw new Error("expected failure");
    } catch (error) {
      expectNoSecret(String(error));
    }
  });

  it("saves the new working directory to pending-locations.json, deduplicated", async () => {
    const cwd = await sandbox();
    const env = testEnv(cwd);
    const output = await agentsCommand(
      ["create", "--type", "opencode", "--name", "helper", "--desc", "d"],
      contextFor(cwd),
      factoryFor(async () => ({ id: "agent-9", api_key: secret })),
    );
    expectNoSecret(output);
    expect(
      JSON.parse(await readFile(pendingLocationsPath(env), "utf8")),
    ).toEqual({ dirs: [cwd] });

    await agentsCommand(
      ["create", "--type", "opencode", "--name", "helper2", "--desc", "d"],
      contextFor(cwd),
      factoryFor(async () => ({ id: "agent-10", api_key: secret })),
    );
    expect(
      JSON.parse(await readFile(pendingLocationsPath(env), "utf8")),
    ).toEqual({ dirs: [cwd] });
  });

  it("succeeds when Console is not running (no control-api.json reachable)", async () => {
    const cwd = await sandbox();
    const output = await agentsCommand(
      ["create", "--type", "opencode", "--name", "helper", "--desc", "d"],
      contextFor(cwd),
      factoryFor(async () => ({ id: "agent-11", api_key: secret })),
    );
    expectNoSecret(output);
    expect(output).toContain("saved for the next Console start");
  });

  it("keeps concurrent pending locations", async () => {
    const cwd = await sandbox();
    const env = testEnv(cwd);
    const dirs = [join(cwd, "one"), join(cwd, "two")];
    await Promise.all(dirs.map((dir) => addPendingLocation(dir, env)));
    expect(
      JSON.parse(await readFile(pendingLocationsPath(env), "utf8")),
    ).toEqual({
      dirs: expect.arrayContaining(dirs),
    });
  });

  it("replaces an invalid pending-locations file and reports it", async () => {
    const cwd = await sandbox();
    const env = testEnv(cwd);
    const file = pendingLocationsPath(env);
    await mkdir(join(file, ".."), { recursive: true });
    await writeFile(file, "invalid JSON");
    const output = await agentsCommand(
      ["create", "--type", "opencode", "--name", "helper", "--desc", "d"],
      contextFor(cwd),
      factoryFor(async () => ({ id: "agent-12", api_key: secret })),
    );
    expect(output).toContain("invalid pending-locations file was replaced");
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ dirs: [cwd] });
  });

  it("continues when a pending-locations lock is orphaned", async () => {
    const cwd = await sandbox();
    const env = testEnv(cwd);
    const file = pendingLocationsPath(env);
    await mkdir(join(file, ".."), { recursive: true });
    await writeFile(`${file}.lock`, "");
    const output = await agentsCommand(
      ["create", "--type", "opencode", "--name", "helper", "--desc", "d"],
      contextFor(cwd),
      factoryFor(async () => ({ id: "agent-13", api_key: secret })),
    );
    expect(output).toContain("Failed to save");
    expect(output).toContain("timed out acquiring pending-locations lock");
  });
});
