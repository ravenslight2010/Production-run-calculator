/**
 * Select the authoritative workbook revision in each importable source folder.
 * This is file-only and deliberately never opens a database connection.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(process.cwd(), "..");
const SOURCE_ROOT = path.join(ROOT, "attached_assets/source-library");
const KINDS = ["specs", "dough", "sauce", "cheese", "premix"] as const;
type Kind = (typeof KINDS)[number];

export type ManifestEntry = {
  path: string; identity: string; timestamp: number; bytes: number; sha256: string; importer: string;
};
export type SourceLibraryManifest = {
  format: "source-library-manifest"; formatVersion: 1; root: string;
  retained: ManifestEntry[];
  excludedOlderDuplicates: Array<ManifestEntry & { retainedPath: string; reason: "older-timestamped-revision" }>;
  sha256: string;
};

const sha = (bytes: Buffer) => crypto.createHash("sha256").update(bytes).digest("hex");
const slash = (value: string) => value.split(path.sep).join("/");
const importerByKind: Record<Kind, string> = {
  specs: "spec-import", dough: "dough-workbook-import", sauce: "sauce-workbook-import",
  cheese: "cheese-workbook-import", premix: "premix-workbook-import",
};

/** Strip the transport timestamp only; revision/version text remains identity. */
export function normalizedWorkbookIdentity(relativePath: string): string {
  const parsed = path.posix.parse(slash(relativePath));
  const stem = parsed.name.replace(/(?:[_\s-])\d{10,}$/u, "");
  return `${parsed.dir === "." ? "" : `${parsed.dir}/`}${stem}`
    .toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9]+/g, " ").trim();
}

export function timestampedWorkbook(relativePath: string): number {
  const match = path.posix.basename(slash(relativePath)).match(/(?:[_\s-])(\d{10,})\.xlsx$/iu);
  if (!match) throw new Error(`Workbook must end in a timestamp: ${relativePath}`);
  return Number(match[1]);
}

export function buildSourceLibraryManifest(root = SOURCE_ROOT): SourceLibraryManifest {
  const candidates: ManifestEntry[] = [];
  for (const kind of KINDS) {
    const dir = path.join(root, kind);
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).filter((x) => x.isFile()).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!/\.xlsx$/iu.test(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const bytes = fs.readFileSync(full);
      const relative = slash(path.relative(root, full));
      candidates.push({ path: relative, identity: normalizedWorkbookIdentity(relative), timestamp: timestampedWorkbook(relative), bytes: bytes.length, sha256: sha(bytes), importer: importerByKind[kind] });
    }
  }
  const retained: ManifestEntry[] = [];
  const excludedOlderDuplicates: SourceLibraryManifest["excludedOlderDuplicates"] = [];
  const groups = new Map<string, ManifestEntry[]>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.identity) ?? [];
    group.push(candidate);
    groups.set(candidate.identity, group);
  }
  for (const group of groups.values()) {
    const ordered = [...group].sort((a, b) => b.timestamp - a.timestamp || a.path.localeCompare(b.path));
    const winner = ordered[0]!;
    retained.push(winner);
    for (const old of ordered.slice(1)) excludedOlderDuplicates.push({ ...old, retainedPath: winner.path, reason: "older-timestamped-revision" });
  }
  retained.sort((a, b) => a.path.localeCompare(b.path));
  excludedOlderDuplicates.sort((a, b) => a.path.localeCompare(b.path));
  const boundary = { format: "source-library-manifest" as const, formatVersion: 1 as const, root: "attached_assets/source-library", retained, excludedOlderDuplicates };
  return { ...boundary, sha256: sha(Buffer.from(JSON.stringify(boundary))) };
}

function main() {
  const requested = process.argv.indexOf("--out");
  const out = path.resolve(ROOT, requested >= 0 ? process.argv[requested + 1]! : "attached_assets/source-library/audits/source-library-manifest-2026-08-26.json");
  const manifest = buildSourceLibraryManifest();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${slash(path.relative(ROOT, out))}: ${manifest.retained.length} retained, ${manifest.excludedOlderDuplicates.length} excluded`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main();