import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { switchAxiConfigDir } from "./agent-defaults.js";

export function pendingLocationsPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(switchAxiConfigDir(env), "pending-locations.json");
}

async function readDirs(file: string): Promise<string[]> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const value: unknown = JSON.parse(raw);
  if (
    !value ||
    typeof value !== "object" ||
    !Array.isArray((value as { dirs?: unknown }).dirs)
  )
    throw new Error(
      `invalid pending-locations file ${file}: must have a dirs array`,
    );
  return (value as { dirs: unknown[] }).dirs.filter(
    (entry): entry is string => typeof entry === "string",
  );
}

/** Appends dir to the pending-locations file, deduplicated. */
export async function addPendingLocation(
  dir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const file = pendingLocationsPath(env);
  const dirs = await readDirs(file);
  if (!dirs.includes(dir)) dirs.push(dir);
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, `${JSON.stringify({ dirs })}\n`);
  return file;
}
