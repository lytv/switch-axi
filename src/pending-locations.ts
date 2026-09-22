import { chmod, mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { switchAxiConfigDir } from "./agent-defaults.js";

type ReadDirsResult = { dirs: string[]; replaced: boolean };

export type PendingLocationResult = {
  file: string;
  replacedInvalidFile: boolean;
};

export function pendingLocationsPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(switchAxiConfigDir(env), "pending-locations.json");
}

async function readDirs(file: string): Promise<ReadDirsResult> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { dirs: [], replaced: false };
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { dirs: [], replaced: true };
  }
  if (
    !value ||
    typeof value !== "object" ||
    !Array.isArray((value as { dirs?: unknown }).dirs)
  )
    return { dirs: [], replaced: true };
  return {
    dirs: (value as { dirs: unknown[] }).dirs.filter(
      (entry): entry is string => typeof entry === "string",
    ),
    replaced: false,
  };
}

async function acquireLock(file: string): Promise<() => Promise<void>> {
  const lock = `${file}.lock`;
  const deadline = Date.now() + 1_000;
  for (;;) {
    try {
      const handle = await open(lock, "wx");
      return async () => {
        await handle.close();
        await unlink(lock);
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() >= deadline)
        throw new Error(`timed out acquiring pending-locations lock ${lock}`, {
          cause: error,
        });
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

/** Appends dir to the pending-locations file, deduplicated. */
export async function addPendingLocation(
  dir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PendingLocationResult> {
  const file = pendingLocationsPath(env);
  await mkdir(join(file, ".."), { recursive: true, mode: 0o700 });
  const release = await acquireLock(file);
  try {
    const { dirs, replaced } = await readDirs(file);
    if (!dirs.includes(dir)) dirs.push(dir);
    await writeFile(file, `${JSON.stringify({ dirs })}\n`, { mode: 0o600 });
    await chmod(file, 0o600);
    return { file, replacedInvalidFile: replaced };
  } finally {
    await release();
  }
}
