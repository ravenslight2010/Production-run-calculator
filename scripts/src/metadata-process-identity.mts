import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export type ProcessIdentity =
  | { platform: "linux"; bootId: string; startTimeTicks: string }
  | { platform: "darwin"; bootId: string; startTimeMicros: string };
export type LinuxIdentityFileReader = (filePath: string) => string;
export type ProcessIdentityReader = (
  pid: number,
  readIdentityFile?: LinuxIdentityFileReader,
) => ProcessIdentity;
export const darwinMetadataHelper = fileURLToPath(new URL("./metadata-darwin.py", import.meta.url));

export function isProcessIdentity(value: unknown): value is ProcessIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 3
    || typeof record.bootId !== "string"
    || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(record.bootId)) return false;
  const start = record.platform === "linux" ? record.startTimeTicks
    : record.platform === "darwin" ? record.startTimeMicros : undefined;
  return typeof start === "string" && /^[1-9]\d{0,24}$/u.test(start);
}

export function readProcessIdentity(
  pid: number,
  readIdentityFile: LinuxIdentityFileReader = (filePath) => fs.readFileSync(filePath, "utf8"),
): ProcessIdentity {
  if (process.platform === "darwin") {
    const result = spawnSync("python3", [darwinMetadataHelper, "identity", String(pid)], {
      encoding: "utf8", timeout: 10_000, maxBuffer: 4096,
    });
    if (result.error || result.status !== 0) {
      throw new Error(`cannot establish the Darwin process identity for metadata lock owner ${pid}`);
    }
    const identity: unknown = JSON.parse(result.stdout);
    if (!isProcessIdentity(identity) || identity.platform !== "darwin") {
      throw new Error(`cannot validate the Darwin process identity for metadata lock owner ${pid}`);
    }
    return identity;
  }
  if (process.platform !== "linux") throw new Error("unsupported metadata process-identity runtime");
  let statContents: string;
  let bootId: string;
  try {
    statContents = readIdentityFile(`/proc/${pid}/stat`);
    bootId = readIdentityFile("/proc/sys/kernel/random/boot_id").trim();
  } catch {
    throw new Error(`cannot establish the Linux process identity for metadata lock owner ${pid}`);
  }
  const fields = statContents.slice(statContents.lastIndexOf(")") + 1).trim().split(/\s+/u);
  const identity = { platform: "linux", bootId, startTimeTicks: fields[19] };
  if (statContents.lastIndexOf(")") < 0 || !isProcessIdentity(identity)) {
    throw new Error(`cannot validate the Linux process identity for metadata lock owner ${pid}`);
  }
  return identity;
}

export function sameProcessIdentity(a: ProcessIdentity, b: ProcessIdentity): boolean {
  return a.bootId === b.bootId && (
    a.platform === "linux" && b.platform === "linux" && a.startTimeTicks === b.startTimeTicks
    || a.platform === "darwin" && b.platform === "darwin" && a.startTimeMicros === b.startTimeMicros
  );
}
