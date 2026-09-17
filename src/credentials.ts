import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Credentials = {
  slug: string;
  name: string;
  agentId: string;
  endpoint: string;
  token: string;
  source: "environment" | "store" | "claude-legacy";
};

export type ResolveOptions = {
  cwd: string;
  agent?: string;
  env?: NodeJS.ProcessEnv;
};
type Parsed = Omit<Credentials, "source">;

function string(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readJson(file: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(file, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function parse(file: string, slug: string): Parsed | undefined {
  const data = readJson(file);
  if (!data) return undefined;
  const env =
    data.env && typeof data.env === "object"
      ? (data.env as Record<string, unknown>)
      : {};
  const endpoint = string(data.endpoint) || string(env.SWITCH_API_ENDPOINT);
  const token = string(data.token) || string(env.SWITCH_API_TOKEN);
  const agentId = string(data.agent_id) || string(env.SWITCH_AGENT_ID);
  if (!endpoint || !token || !agentId) return undefined;
  return {
    slug,
    name: string(data.name) || slug,
    endpoint: endpoint.replace(/\/+$/, ""),
    token,
    agentId,
  };
}

function store(cwd: string): Parsed[] {
  const dir = join(cwd, ".switch", "agents");
  try {
    return readdirSync(dir)
      .filter((file) => file.endsWith(".json"))
      .sort()
      .flatMap((file) => {
        const entry = parse(join(dir, file), file.slice(0, -5));
        return entry ? [entry] : [];
      });
  } catch {
    return [];
  }
}

function legacy(cwd: string, slug: string): Parsed | undefined {
  return parse(
    join(cwd, ".claude", "switch-subagents", `${slug}.settings.json`),
    slug,
  );
}

export function resolveCredentials(options: ResolveOptions): Credentials {
  const env = options.env ?? process.env;
  const agents = store(options.cwd);
  if (options.agent) {
    const selected = agents.find((agent) => agent.slug === options.agent);
    if (selected) return { ...selected, source: "store" };
    const fallback = legacy(options.cwd, options.agent);
    if (fallback) return { ...fallback, source: "claude-legacy" };
    throw new Error(
      `no Switch credentials for agent ${options.agent} in ${options.cwd}`,
    );
  }
  const endpoint = string(env.SWITCH_API_ENDPOINT);
  const token = string(env.SWITCH_API_TOKEN);
  const agentId = string(env.SWITCH_AGENT_ID);
  if (endpoint && token && agentId) {
    return {
      slug: options.agent ?? "environment",
      name: options.agent ?? "environment",
      endpoint: endpoint.replace(/\/+$/, ""),
      token,
      agentId,
      source: "environment",
    };
  }
  if (endpoint || token || agentId)
    throw new Error(
      "incomplete SWITCH_* environment: set endpoint, token, and agent id, or unset all three",
    );

  if (agents.length === 1) return { ...agents[0], source: "store" };
  if (agents.length > 1)
    throw new Error(
      `multiple Switch agents in ${join(options.cwd, ".switch", "agents")}; use --agent <slug>`,
    );
  throw new Error(
    `no Switch credentials in ${join(options.cwd, ".switch", "agents")}; set SWITCH_* or use --agent for a Claude legacy entry`,
  );
}
