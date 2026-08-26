/**
 * Capture the bounded production input for a source-library audit.
 *
 * This deliberately uses a READ ONLY transaction and an allowlisted set of
 * master-data tables. It must not be used to export auth, conversations,
 * inventory, or transient run state.
 *
 * Usage:
 *   DATABASE_URL=... pnpm --filter @workspace/scripts run audit:source-snapshot \
 *     --out attached_assets/source-library/audits/production-snapshot-YYYY-MM-DD.json
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const DEFAULT_MAX_ROWS = 10_000;
const SOURCE_ROOT = path.resolve(process.cwd(), "..", "attached_assets", "source-library");

const TABLES = [
  { name: "brand_profiles", orderBy: "key", scope: "scope" },
  { name: "cheese_recipes", orderBy: "id", scope: "scope" },
  { name: "dough_recipes", orderBy: "id", scope: "scope" },
  { name: "sauce_recipes", orderBy: "id", scope: "scope" },
  { name: "mixes", orderBy: "id", scope: "scope" },
  { name: "ingredients", orderBy: "id", scope: "scope" },
] as const;

type SourceFile = {
  path: string;
  bytes: number;
  sha256: string;
};

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function sourceFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) throw new Error(`Source library not found: ${directory}`);
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    // Retained captures live under this directory but are evidence, not source
    // inputs. Excluding them also prevents a snapshot from hashing itself.
    if (entry.isDirectory() && entry.name === "audits") continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

function sourceManifest(): { files: SourceFile[]; sha256: string } {
  const files = sourceFiles(SOURCE_ROOT).map((full) => {
    const bytes = fs.readFileSync(full);
    return {
      path: path.relative(SOURCE_ROOT, full).split(path.sep).join("/"),
      bytes: bytes.byteLength,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    };
  });
  return {
    files,
    sha256: crypto.createHash("sha256").update(JSON.stringify(files)).digest("hex"),
  };
}

function gitRevision(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const out = argument("--out");
  if (!out) throw new Error("--out is required; choose a retained audit snapshot path");
  const maxRows = Number(argument("--max-rows") ?? DEFAULT_MAX_ROWS);
  if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > 100_000) {
    throw new Error("--max-rows must be an integer from 1 through 100000");
  }

  // Load the shared DB package only after validating CLI arguments. This
  // keeps --help/argument errors useful even when no database is configured.
  const { pool } = await import("@workspace/db");
  const client = await pool.connect();
  const tables: Record<string, { rowCount: number; rows: unknown[] }> = {};
  const capturedAt = new Date().toISOString();
  const manifest = sourceManifest();

  try {
    await client.query("BEGIN");
    await client.query("SET TRANSACTION READ ONLY");
    await client.query("SET LOCAL statement_timeout = '60s'");

    for (const table of TABLES) {
      const countResult = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM "${table.name}" WHERE "${table.scope}" = $1`,
        ["live"],
      );
      const rowCount = Number(countResult.rows[0]?.count ?? 0);
      if (rowCount > maxRows) {
        throw new Error(
          `${table.name} contains ${rowCount} live rows, exceeding --max-rows=${maxRows}; refusing an incomplete snapshot`,
        );
      }
      const result = await client.query(
        `SELECT * FROM "${table.name}" WHERE "${table.scope}" = $1 ORDER BY "${table.orderBy}" LIMIT $2`,
        ["live", maxRows],
      );
      tables[table.name] = { rowCount, rows: result.rows };
    }
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }

  const snapshot = {
    format: "source-audit-production-snapshot",
    formatVersion: 1,
    capturedAt,
    sourceLibrary: {
      root: "attached_assets/source-library",
      gitRevision: gitRevision(),
      manifest,
    },
    comparisonScope: {
      databaseScope: "live",
      tables: TABLES.map(({ name }) => name),
      maxRowsPerTable: maxRows,
      included: "Factory master data used by the source-library audit: profiles, dough, sauce, cheese, mix, and ingredient catalog rows.",
      excluded: "Authentication, users, AI conversations/memory, inventory, daily sync state, runs, audit logs, and other transient or personal data.",
      consistency: "All tables were read in one PostgreSQL READ ONLY transaction.",
    },
    tables,
  };

  const destination = path.resolve(process.cwd(), out);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `${JSON.stringify(snapshot, null, 2)}\n`, { flag: "wx" });
  console.log(`Wrote read-only source audit snapshot: ${path.relative(process.cwd(), destination)}`);
  console.log(`Captured ${TABLES.length} tables; source manifest ${manifest.sha256}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});