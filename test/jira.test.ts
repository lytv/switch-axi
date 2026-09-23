import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { jiraCommand, type CommandContext } from "../src/commands.js";

const context: CommandContext = { cwd: process.cwd(), json: false, env: {} };
const jsonContext: CommandContext = { cwd: process.cwd(), json: true, env: {} };

type Call = (name: string, args: Record<string, unknown>) => Promise<unknown>;
const stubClient = (call: Call) => () => ({
  call,
  operations: async () => ({}),
  attach: async () => ({}),
  fetch: async () => {},
});
const yes = async () => "yes";

describe("jira instances", () => {
  it("lists instances without ever exposing a secret", async () => {
    let seen: Record<string, unknown> = {};
    const output = await jiraCommand(
      ["instances", "list"],
      jsonContext,
      stubClient(async (name, args) => {
        expect(name).toBe("list_jira_instances");
        seen = args;
        return { instances: [], jira_agent_name: "jira" };
      }),
      yes,
    );
    expect(seen).toEqual({});
    expect(JSON.parse(output).jira.jira_agent_name).toBe("jira");
  });

  it("rejects reveal, rotate, and add with an admin-UI pointer", async () => {
    const noop = stubClient(async () => ({}));
    for (const args of [
      ["instances", "reveal", "acme"],
      ["instances", "rotate-secret", "acme"],
      ["instances", "add"],
    ]) {
      await expect(jiraCommand(args, context, noop, yes)).rejects.toThrow(
        /server configuration only|admin-UI-only/,
      );
    }
  });
});

describe("jira triggers list/show", () => {
  it("passes the instance filter through", async () => {
    let seen: Record<string, unknown> = {};
    await jiraCommand(
      ["triggers", "list", "--instance", "acme"],
      jsonContext,
      stubClient(async (name, args) => {
        expect(name).toBe("list_jira_triggers");
        seen = args;
        return [];
      }),
      yes,
    );
    expect(seen).toEqual({ instance: "acme" });
  });

  it("shows one trigger by id", async () => {
    let seen: Record<string, unknown> = {};
    await jiraCommand(
      ["triggers", "show", "rule-1"],
      context,
      stubClient(async (name, args) => {
        expect(name).toBe("get_jira_trigger");
        seen = args;
        return {};
      }),
      yes,
    );
    expect(seen).toEqual({ trigger_id: "rule-1" });
  });
});

describe("jira triggers dry-run", () => {
  it("sends overrides and a payload file, never posts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "switch-axi-jira-"));
    const file = join(dir, "payload.json");
    await writeFile(file, JSON.stringify({ issue: { key: "KAN-1" } }));
    let seen: Record<string, unknown> = {};
    const output = await jiraCommand(
      [
        "triggers",
        "dry-run",
        "rule-1",
        "--overrides",
        '{"project":"KAN"}',
        "--payload",
        file,
      ],
      jsonContext,
      stubClient(async (name, args) => {
        expect(name).toBe("dry_run_jira_trigger");
        seen = args;
        return { matched: true, would_post: false };
      }),
      yes,
    );
    expect(seen).toEqual({
      trigger_id: "rule-1",
      sample_overrides: { project: "KAN" },
      payload: { issue: { key: "KAN-1" } },
    });
    expect(JSON.parse(output).dry_run.would_post).toBe(false);
  });

  it("fails loud on bad overrides and missing payload files", async () => {
    const noop = stubClient(async () => ({}));
    await expect(
      jiraCommand(
        ["triggers", "dry-run", "rule-1", "--overrides", "[1]"],
        context,
        noop,
        yes,
      ),
    ).rejects.toThrow("--overrides must be one JSON object");
    await expect(
      jiraCommand(
        ["triggers", "dry-run", "rule-1", "--payload", "no-such-file.json"],
        context,
        noop,
        yes,
      ),
    ).rejects.toThrow("cannot read --payload file");
  });
});

describe("jira triggers add/update", () => {
  const addFlags = [
    "add",
    "--name",
    "KAN to In Progress",
    "--instance",
    "acme",
    "--project",
    "KAN",
    "--fire-on",
    "transition",
    "--target-status",
    "In Progress",
    "--target",
    "room",
    "--room",
    "dev-room",
    "--agent",
    "coder",
    "--template",
    "{{issue.key}} is now {{issue.status}}",
  ];

  it("maps add flags to create_jira_trigger fields", async () => {
    let seen: Record<string, unknown> = {};
    await jiraCommand(
      ["triggers", ...addFlags, "--thread-by", "issue_key", "--disabled"],
      jsonContext,
      stubClient(async (name, args) => {
        expect(name).toBe("create_jira_trigger");
        seen = args;
        return {};
      }),
      yes,
    );
    expect(seen).toEqual({
      name: "KAN to In Progress",
      instance: "acme",
      project_key: "KAN",
      fire_on: "transition",
      target_status: "In Progress",
      target_kind: "room",
      target_room_id: "dev-room",
      agent_name: "coder",
      message_template: "{{issue.key}} is now {{issue.status}}",
      thread_by: "issue_key",
      enabled: false,
    });
  });

  it("rejects missing required add fields and bad enums", async () => {
    const noop = stubClient(async () => ({}));
    await expect(
      jiraCommand(["triggers", "add", "--name", "x"], context, noop, yes),
    ).rejects.toThrow("requires --name --instance");
    await expect(
      jiraCommand(
        ["triggers", ...addFlags, "--fire-on", "sometimes"],
        context,
        noop,
        yes,
      ),
    ).rejects.toThrow("--fire-on must be one of");
    await expect(
      jiraCommand(
        ["triggers", ...addFlags, "--target", "group", "--room", "dev-room"],
        context,
        noop,
        yes,
      ),
    ).rejects.toThrow("--target group requires --group");
  });

  it("sends partial update fields with the trigger id", async () => {
    let seen: Record<string, unknown> = {};
    await jiraCommand(
      ["triggers", "update", "rule-1", "--template", "hi", "--enabled"],
      jsonContext,
      stubClient(async (name, args) => {
        expect(name).toBe("update_jira_trigger");
        seen = args;
        return {};
      }),
      yes,
    );
    expect(seen).toEqual({
      trigger_id: "rule-1",
      message_template: "hi",
      enabled: true,
    });
  });

  it("rejects empty updates and room/group without target", async () => {
    const noop = stubClient(async () => ({}));
    await expect(
      jiraCommand(["triggers", "update", "rule-1"], context, noop, yes),
    ).rejects.toThrow("at least one field flag");
    await expect(
      jiraCommand(
        ["triggers", "update", "rule-1", "--room", "dev-room"],
        context,
        noop,
        yes,
      ),
    ).rejects.toThrow("--room/--group require --target");
  });
});

describe("jira triggers delete", () => {
  it("asks for confirmation, deletes on yes", async () => {
    const prompts: string[] = [];
    let seen: Record<string, unknown> = {};
    await jiraCommand(
      ["triggers", "delete", "rule-1"],
      jsonContext,
      stubClient(async (name, args) => {
        expect(name).toBe("delete_jira_trigger");
        seen = args;
        return { trigger_id: "rule-1", status: "deleted" };
      }),
      async (prompt) => {
        prompts.push(prompt);
        return "yes";
      },
    );
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("rule-1");
    expect(seen).toEqual({ trigger_id: "rule-1" });
  });

  it("cancels on no and skips the prompt with --yes", async () => {
    const noop = stubClient(async () => ({}));
    await expect(
      jiraCommand(
        ["triggers", "delete", "rule-1"],
        context,
        noop,
        async () => "no",
      ),
    ).rejects.toThrow("delete cancelled");
    let prompted = false;
    await jiraCommand(
      ["triggers", "delete", "rule-1", "--yes"],
      context,
      noop,
      async () => {
        prompted = true;
        return "yes";
      },
    );
    expect(prompted).toBe(false);
  });
});

describe("jira deliveries/tokens/agent-options", () => {
  it("maps deliveries filters (--rule to rule_id)", async () => {
    let seen: Record<string, unknown> = {};
    await jiraCommand(
      [
        "deliveries",
        "list",
        "--instance",
        "acme",
        "--rule",
        "rule-1",
        "--limit",
        "10",
      ],
      jsonContext,
      stubClient(async (name, args) => {
        expect(name).toBe("list_jira_deliveries");
        seen = args;
        return { deliveries: [] };
      }),
      yes,
    );
    expect(seen).toEqual({ instance: "acme", rule_id: "rule-1", limit: 10 });
    const noop = stubClient(async () => ({}));
    await expect(
      jiraCommand(["deliveries", "list", "--limit", "0"], context, noop, yes),
    ).rejects.toThrow("--limit must be a positive integer");
  });

  it("lists message tokens with no args", async () => {
    let called = false;
    const output = await jiraCommand(
      ["tokens"],
      jsonContext,
      stubClient(async (name, args) => {
        expect(name).toBe("list_jira_message_tokens");
        expect(args).toEqual({});
        called = true;
        return ["issue.key"];
      }),
      yes,
    );
    expect(called).toBe(true);
    expect(JSON.parse(output).tokens).toEqual(["issue.key"]);
  });

  it("requires exactly one of --room/--group for agent-options", async () => {
    let seen: Record<string, unknown> = {};
    await jiraCommand(
      ["agent-options", "--room", "dev-room"],
      jsonContext,
      stubClient(async (name, args) => {
        expect(name).toBe("list_jira_agent_options");
        seen = args;
        return [];
      }),
      yes,
    );
    expect(seen).toEqual({ room_id: "dev-room" });
    const noop = stubClient(async () => ({}));
    await expect(
      jiraCommand(["agent-options"], context, noop, yes),
    ).rejects.toThrow("usage: switch-axi jira agent-options");
    await expect(
      jiraCommand(
        ["agent-options", "--room", "r", "--group", "g"],
        context,
        noop,
        yes,
      ),
    ).rejects.toThrow("usage: switch-axi jira agent-options");
  });
});

describe("jira help", () => {
  it("states instances are server config and secrets are admin-UI-only", async () => {
    const output = await jiraCommand(
      ["--help"],
      context,
      stubClient(async () => ({})),
    );
    expect(output).toContain("server configuration only");
    expect(output).toContain("no instances add");
    expect(output).toContain("admin-UI-only");
  });
});
