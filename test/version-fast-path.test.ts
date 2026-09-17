import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const exec = promisify(execFile);
describe("version fast path", () => {
  it("prints the built package version", async () => {
    const result = await exec(process.execPath, [
      "dist/bin/switch-axi.js",
      "--version",
    ]);
    expect(result.stdout.trim()).toBe("0.1.0");
  });
});
