import { readFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";

// Matches Switch Console's Electron `app.getPath('appData')` per-OS convention.
function appDataDir(env: NodeJS.ProcessEnv): string {
  const home =
    typeof env.HOME === "string" && env.HOME.trim()
      ? env.HOME.trim()
      : homedir();
  if (platform() === "darwin")
    return join(home, "Library", "Application Support");
  if (platform() === "win32")
    return (
      (env.APPDATA?.trim() || undefined) ?? join(home, "AppData", "Roaming")
    );
  return (env.XDG_CONFIG_HOME?.trim() || undefined) ?? join(home, ".config");
}

// Console's USER_DATA_DIR_NAME: `switchdash` for an installed build, `switchdash-dev` in dev.
const CONSOLE_USER_DATA_DIRS = ["switchdash", "switchdash-dev"];

type ControlFile = { port: number; token: string };

async function readControlFile(path: string): Promise<ControlFile | undefined> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
  if (
    !value ||
    typeof value !== "object" ||
    typeof (value as { port?: unknown }).port !== "number" ||
    typeof (value as { token?: unknown }).token !== "string"
  )
    return undefined;
  return value as ControlFile;
}

/** Best-effort: tells a running Switch Console to open dir. Never throws. */
export async function notifyConsoleOpenFolder(
  dir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const base = appDataDir(env);
  for (const name of CONSOLE_USER_DATA_DIRS) {
    const control = await readControlFile(join(base, name, "control-api.json"));
    if (!control) continue;
    try {
      const response = await fetch(
        `http://127.0.0.1:${control.port}/locations/open`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-switch-control-token": control.token,
          },
          body: JSON.stringify({ dir }),
          signal: AbortSignal.timeout(1000),
        },
      );
      if (response.ok) return true;
    } catch {
      // refused or unreachable; try the next candidate
    }
  }
  return false;
}
