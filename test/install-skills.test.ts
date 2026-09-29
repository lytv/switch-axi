import { chmod, mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installSkills } from "../src/install-skills.js";

async function sandbox(): Promise<string> {
  return mkdtemp(join(tmpdir(), "switch-axi-install-skills-"));
}

async function packagedSkills(root: string): Promise<string> {
  const packageRoot = join(root, "package");
  for (const skill of ["switch-axi", "switch-room-setup", "switch-jira"]) {
    const dir = join(packageRoot, "skills", skill);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), `# ${skill}\n`);
  }
  return packageRoot;
}

describe("installSkills", () => {
  it("installs the switch-jira skill", async () => {
    const root = await sandbox();
    const packageRoot = await packagedSkills(root);
    const skillsRoot = join(root, "skills");
    await mkdir(skillsRoot);

    await installSkills(packageRoot, [skillsRoot]);

    expect(
      (await stat(join(skillsRoot, "switch-jira", "SKILL.md"))).isFile(),
    ).toBe(true);
  });
  it("skips a missing root without throwing", async () => {
    const root = await sandbox();
    const packageRoot = await packagedSkills(root);
    const missing = join(root, "does-not-exist", "skills");

    await expect(
      installSkills(packageRoot, [missing]),
    ).resolves.toBeUndefined();
  });

  it("does not throw when a root is not writable", async () => {
    const root = await sandbox();
    const packageRoot = await packagedSkills(root);
    const readOnly = join(root, "readonly-skills");
    await mkdir(readOnly, { recursive: true });
    await chmod(readOnly, 0o555);

    try {
      await expect(
        installSkills(packageRoot, [readOnly]),
      ).resolves.toBeUndefined();
    } finally {
      await chmod(readOnly, 0o755);
    }
  });
});
