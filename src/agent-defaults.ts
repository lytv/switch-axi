import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export const AGENT_TYPES = ["claude-code", "codex", "opencode"] as const;
export type AgentType = (typeof AGENT_TYPES)[number];

export type AgentCreateDefaults = {
  agent_type?: AgentType;
  auto_session?: boolean;
  base_working_dir?: string;
  git_repo_url?: string;
  owner_only?: boolean;
};

const knownKeys = new Set([
  "agent_type",
  "auto_session",
  "base_working_dir",
  "git_repo_url",
  "owner_only",
]);

export function switchAxiConfigDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const xdg =
    typeof env.XDG_CONFIG_HOME === "string" ? env.XDG_CONFIG_HOME.trim() : "";
  const home =
    typeof env.HOME === "string" && env.HOME.trim()
      ? env.HOME.trim()
      : homedir();
  return join(xdg || join(home, ".config"), "switch-axi");
}

export function agentCreateDefaultsPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(switchAxiConfigDir(env), "agent-create-defaults.json");
}

export function loadAgentCreateDefaults(
  env: NodeJS.ProcessEnv = process.env,
): AgentCreateDefaults {
  const file = agentCreateDefaultsPath(env);
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(
      `invalid agent-create defaults file ${file}: ${(error as Error).message}`,
      { cause: error },
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`invalid agent-create defaults file ${file}: bad JSON`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(
      `invalid agent-create defaults file ${file}: must be a JSON object`,
    );
  const data = value as Record<string, unknown>;
  for (const key of Object.keys(data)) {
    if (!knownKeys.has(key))
      throw new Error(
        `invalid agent-create defaults file ${file}: unknown key ${key}`,
      );
  }
  const result: AgentCreateDefaults = {};
  if ("agent_type" in data) {
    if (
      typeof data.agent_type !== "string" ||
      !AGENT_TYPES.includes(data.agent_type as AgentType)
    )
      throw new Error(
        `invalid agent-create defaults file ${file}: unknown agent_type`,
      );
    result.agent_type = data.agent_type as AgentType;
  }
  if ("auto_session" in data) {
    if (typeof data.auto_session !== "boolean")
      throw new Error(
        `invalid agent-create defaults file ${file}: auto_session must be a boolean`,
      );
    result.auto_session = data.auto_session;
  }
  if ("base_working_dir" in data) {
    if (
      typeof data.base_working_dir !== "string" ||
      !isAbsolute(data.base_working_dir)
    )
      throw new Error(
        `invalid agent-create defaults file ${file}: base_working_dir must be an absolute path`,
      );
    result.base_working_dir = data.base_working_dir;
  }
  if ("git_repo_url" in data) {
    if (typeof data.git_repo_url !== "string" || !data.git_repo_url.trim())
      throw new Error(
        `invalid agent-create defaults file ${file}: git_repo_url must be a non-empty string`,
      );
    result.git_repo_url = data.git_repo_url;
  }
  if ("owner_only" in data) {
    if (typeof data.owner_only !== "boolean")
      throw new Error(
        `invalid agent-create defaults file ${file}: owner_only must be a boolean`,
      );
    result.owner_only = data.owner_only;
  }
  return result;
}
