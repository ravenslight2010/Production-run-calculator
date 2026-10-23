import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// No shell, optional native addon, flock, WSL, or locale-dependent tasklist output.
export function runWindowsMetadataHelper(request: unknown): string {
  if (process.platform !== "win32") throw new Error("Windows metadata helper requires native Windows");
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot || !path.isAbsolute(systemRoot)) throw new Error("Windows SystemRoot is unavailable");
  const result = spawnSync(
    path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-File",
      fileURLToPath(new URL("./metadata-maintenance-windows.ps1", import.meta.url))],
    {
      input: JSON.stringify(request),
      encoding: "utf8",
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error(`Windows metadata maintenance failed; leave unverified locks untouched: ${
      result.error?.message ?? result.stderr.trim()
    }`);
  }
  return result.stdout.trim();
}

export function replaceWindowsMetadataFile(
  decisionPath: string,
  before: Buffer,
  after: string,
): void {
  if (!fs.statSync(decisionPath).isFile()) throw new Error("decision file must be a regular file");
  runWindowsMetadataHelper({
    operation: "replace",
    decisionPath,
    before: before.toString("base64"),
    after: Buffer.from(after, "utf8").toString("base64"),
  });
}
