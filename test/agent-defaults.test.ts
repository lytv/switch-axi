import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  agentCreateDefaultsPath,
  loadAgentCreateDefaults,
} from "../src/agent-defaults.js";

async function sandbox(): Promise<string> {
  return mkdtemp(join(tmpdir(), "switch-axi-defaults-"));
}

function envFor(cwd: string): NodeJS.ProcessEnv {
  return { HOME: cwd, XDG_CONFIG_HOME: join(cwd, "xdg-config") };
}

async function writeDefaults(cwd: string, body: string): Promise<string> {
  const file = agentCreateDefaultsPath(envFor(cwd));
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, body);
  return file;
}

describe("loadAgentCreateDefaults", () => {
  it("returns empty defaults when the file is missing", async () => {
    const cwd = await sandbox();
    expect(loadAgentCreateDefaults(envFor(cwd))).toEqual({});
  });

  it("loads optional keys from a valid file", async () => {
    const cwd = await sandbox();
    await writeDefaults(
      cwd,
      JSON.stringify({
        agent_type: "opencode",
        auto_session: true,
        base_working_dir: "/Users/lytv/tools/myjira/",
        git_repo_url: "https://github.com/lytvrks/firstmate",
        owner_only: false,
      }),
    );
    expect(loadAgentCreateDefaults(envFor(cwd))).toEqual({
      agent_type: "opencode",
      auto_session: true,
      base_working_dir: "/Users/lytv/tools/myjira/",
      git_repo_url: "https://github.com/lytvrks/firstmate",
      owner_only: false,
    });
  });

  it("fails fast on bad JSON, naming the file", async () => {
    const cwd = await sandbox();
    const file = await writeDefaults(cwd, "{");
    expect(() => loadAgentCreateDefaults(envFor(cwd))).toThrow(
      `invalid agent-create defaults file ${file}: bad JSON`,
    );
  });

  it("fails fast on an unknown agent_type, naming the key", async () => {
    const cwd = await sandbox();
    const file = await writeDefaults(
      cwd,
      JSON.stringify({ agent_type: "bogus" }),
    );
    expect(() => loadAgentCreateDefaults(envFor(cwd))).toThrow(
      `invalid agent-create defaults file ${file}: unknown agent_type`,
    );
  });

  it("fails fast on a relative base_working_dir, naming the key", async () => {
    const cwd = await sandbox();
    const file = await writeDefaults(
      cwd,
      JSON.stringify({ base_working_dir: "relative/path" }),
    );
    expect(() => loadAgentCreateDefaults(envFor(cwd))).toThrow(
      `invalid agent-create defaults file ${file}: base_working_dir must be an absolute path`,
    );
  });

  it("fails fast on an unknown key", async () => {
    const cwd = await sandbox();
    const file = await writeDefaults(
      cwd,
      JSON.stringify({ bypass_permissions: true }),
    );
    expect(() => loadAgentCreateDefaults(envFor(cwd))).toThrow(
      `invalid agent-create defaults file ${file}: unknown key bypass_permissions`,
    );
  });
});
