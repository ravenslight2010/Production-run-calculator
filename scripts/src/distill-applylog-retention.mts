import fs from "node:fs";
import path from "node:path";
import { IMPORT_SOURCE_RETENTION_DAYS, IMPORT_SOURCE_RETENTION_MS } from "@workspace/db/schema";

const MARKER_SUFFIX = ".applylog-retention.json";
const MARKER_FORMAT = "private-applylog-export-retention-v1";
const MAX_DIRECTORY_ENTRIES = 1_000;
const MAX_MARKER_BYTES = 4_096;

type ExportRetentionMarker = {
  format: typeof MARKER_FORMAT;
  createdAt: string;
  expiresAt: string;
  outputFile: string;
};

export type ApplyLogExportCleanupResult = {
  markedExportsExamined: number;
  expiredExportsRemoved: number;
  unexpiredExportsRetained: number;
  invalidMarkersSkipped: number;
  deletionFailures: number;
};

function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
}

function markerPathFor(outputFile: string): string {
  return `${outputFile}${MARKER_SUFFIX}`;
}

export function writeApplyLogExportRetentionMarker(outputFile: string, now = Date.now()): void {
  const createdAt = new Date(now).toISOString();
  const marker: ExportRetentionMarker = {
    format: MARKER_FORMAT,
    createdAt,
    expiresAt: new Date(now + IMPORT_SOURCE_RETENTION_MS).toISOString(),
    outputFile: path.basename(outputFile),
  };
  const markerPath = markerPathFor(outputFile);
  const fd = fs.openSync(markerPath, "wx", 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(marker)}\n`);
    fs.fsyncSync(fd);
    fs.fchmodSync(fd, 0o600);
  } finally {
    fs.closeSync(fd);
  }
}

function isMarker(value: unknown, markerName: string): value is ExportRetentionMarker {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const marker = value as Record<string, unknown>;
  if (
    Object.keys(marker).sort().join(",") !== "createdAt,expiresAt,format,outputFile" ||
    marker.format !== MARKER_FORMAT ||
    typeof marker.createdAt !== "string" ||
    typeof marker.expiresAt !== "string" ||
    typeof marker.outputFile !== "string" ||
    marker.outputFile !== markerName
  ) return false;
  const createdAt = Date.parse(marker.createdAt);
  const expiresAt = Date.parse(marker.expiresAt);
  return Number.isFinite(createdAt) &&
    Number.isFinite(expiresAt) &&
    new Date(createdAt).toISOString() === marker.createdAt &&
    new Date(expiresAt).toISOString() === marker.expiresAt &&
    expiresAt === createdAt + IMPORT_SOURCE_RETENTION_MS;
}

async function listBoundedDirectory(directory: string): Promise<import("node:fs").Dirent[]> {
  const handle = await fs.promises.opendir(directory);
  const entries: import("node:fs").Dirent[] = [];
  try {
    while (entries.length <= MAX_DIRECTORY_ENTRIES) {
      const entry = await handle.read();
      if (!entry) break;
      entries.push(entry);
    }
  } finally {
    await handle.close().catch(() => {});
  }
  if (entries.length > MAX_DIRECTORY_ENTRIES) {
    throw new Error("Private export directory exceeds the bounded cleanup limit");
  }
  return entries;
}

function resolvePrivateDirectory(directory: string, repoRoot: string): string {
  if (!path.isAbsolute(directory)) throw new Error("--directory must be an absolute path");
  const actual = fs.realpathSync(directory);
  if (isWithin(fs.realpathSync(repoRoot), actual)) {
    throw new Error("--directory must be outside the repository");
  }
  const stat = fs.statSync(actual);
  if (!stat.isDirectory() || (stat.mode & 0o077) !== 0) {
    throw new Error("--directory must be a private owner-only directory");
  }
  return actual;
}

export async function cleanupExpiredApplyLogExports(options: {
  directory: string;
  repoRoot: string;
  now?: number;
}): Promise<ApplyLogExportCleanupResult> {
  const directory = resolvePrivateDirectory(options.directory, options.repoRoot);
  const entries = await listBoundedDirectory(directory);
  const result: ApplyLogExportCleanupResult = {
    markedExportsExamined: 0,
    expiredExportsRemoved: 0,
    unexpiredExportsRetained: 0,
    invalidMarkersSkipped: 0,
    deletionFailures: 0,
  };
  const now = options.now ?? Date.now();

  for (const entry of entries) {
    if (!entry.name.endsWith(MARKER_SUFFIX)) continue;
    result.markedExportsExamined++;
    if (!entry.isFile()) {
      result.invalidMarkersSkipped++;
      continue;
    }
    const markerPath = path.join(directory, entry.name);
    const outputName = entry.name.slice(0, -MARKER_SUFFIX.length);
    if (!outputName || path.basename(outputName) !== outputName) {
      result.invalidMarkersSkipped++;
      continue;
    }
    try {
      const markerStat = fs.lstatSync(markerPath);
      if (!markerStat.isFile() || (markerStat.mode & 0o077) !== 0 || markerStat.size > MAX_MARKER_BYTES) {
        result.invalidMarkersSkipped++;
        continue;
      }
      const raw: unknown = JSON.parse(fs.readFileSync(markerPath, "utf8"));
      if (!isMarker(raw, outputName)) {
        result.invalidMarkersSkipped++;
        continue;
      }
      if (Date.parse(raw.expiresAt) > now) {
        result.unexpiredExportsRetained++;
        continue;
      }
      const outputPath = path.join(directory, outputName);
      try {
        const outputStat = fs.lstatSync(outputPath);
        if (!outputStat.isFile() || (outputStat.mode & 0o077) !== 0) {
          result.invalidMarkersSkipped++;
          continue;
        }
        fs.unlinkSync(outputPath);
      } catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
          result.deletionFailures++;
          continue;
        }
      }
      try {
        fs.unlinkSync(markerPath);
        result.expiredExportsRemoved++;
      } catch {
        result.deletionFailures++;
      }
    } catch {
      result.invalidMarkersSkipped++;
    }
  }
  return result;
}