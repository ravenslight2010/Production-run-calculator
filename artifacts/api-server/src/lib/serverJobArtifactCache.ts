import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CanonicalReportExportFormat } from "./canonicalReportExport";

// Export bytes must not be retained in Postgres job JSON. This cache is local to
// the API worker deployment (the same deployment serves the download route).
// Deployments with persistent/shared storage can point this at that mounted
// location. Its small bounded retention makes ephemeral instances safe too.
const root = process.env.SERVER_JOB_ARTIFACT_DIR ?? "/tmp/api-server-job-artifacts";
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const valid = (value: string) => /^[0-9a-f-]{36}$/i.test(value);
const extension = (format: CanonicalReportExportFormat) => format === "print" ? "html" : format;
const artifactPath = (jobId: string, format: CanonicalReportExportFormat) => {
  if (!valid(jobId)) throw new Error("Invalid export artifact id");
  return join(root, `${jobId}.${extension(format)}`);
};

export async function pruneServerJobArtifacts(now = Date.now()): Promise<number> {
  await mkdir(root, { recursive: true });
  const entries = await Promise.all((await readdir(root)).map(async (name) => {
    const path = join(root, name);
    try { const info = await stat(path); return info.isFile() ? { path, ...info } : null; } catch { return null; }
  }));
  let kept = entries.filter((entry): entry is NonNullable<typeof entry> => !!entry);
  let removed = 0;
  for (const entry of kept.filter((entry) => now - entry.mtimeMs > MAX_AGE_MS)) {
    await unlink(entry.path).catch(() => undefined);
    removed++;
  }
  kept = kept.filter((entry) => now - entry.mtimeMs <= MAX_AGE_MS).sort((a, b) => a.mtimeMs - b.mtimeMs);
  let bytes = kept.reduce((sum, entry) => sum + entry.size, 0);
  while (bytes > MAX_BYTES && kept.length) {
    const entry = kept.shift()!;
    bytes -= entry.size;
    await unlink(entry.path).catch(() => undefined);
    removed++;
  }
  return removed;
}

export async function writeServerJobArtifact(jobId: string, format: CanonicalReportExportFormat, bytes: Uint8Array): Promise<{ byteLength: number; sha256: string }> {
  if (bytes.byteLength > MAX_BYTES) throw new Error("Export artifact exceeds 64 MiB cache limit");
  await pruneServerJobArtifacts();
  const path = artifactPath(jobId, format);
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, bytes);
  await rename(temp, path);
  await pruneServerJobArtifacts();
  return { byteLength: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export async function readServerJobArtifact(jobId: string, format: CanonicalReportExportFormat): Promise<Buffer | null> {
  try { return await readFile(artifactPath(jobId, format)); } catch { return null; }
}