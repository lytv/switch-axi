import { cp, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const PACKAGED_SKILLS = ["switch-axi", "switch-room-setup"];

export function skillRoots(home: string = homedir()): string[] {
  return [
    join(home, ".agents", "skills"),
    join(home, ".claude", "skills"),
    join(home, ".codex", "skills"),
    join(home, ".config", "opencode", "skills"),
  ];
}

/**
 * Copies each packaged skill directory into every skill root that exists
 * (or whose parent exists) and is writable. Missing roots are skipped.
 * Failures are printed, never thrown, so a bad root cannot fail install.
 */
export async function installSkills(
  packageRoot: string,
  roots: string[] = skillRoots(),
): Promise<void> {
  for (const root of roots) {
    const exists = await stat(root)
      .then((s) => s.isDirectory())
      .catch(() => false);
    if (!exists) continue;

    for (const skill of PACKAGED_SKILLS) {
      const src = join(packageRoot, "skills", skill);
      const dest = join(root, skill);
      try {
        await cp(src, dest, { recursive: true });
      } catch (error) {
        console.error(
          `switch-axi: could not install skill to ${dest}: ${(error as Error).message} (packaged skill: ${src})`,
        );
      }
    }
  }
}
