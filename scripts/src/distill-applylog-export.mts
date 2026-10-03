import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createApplyLogCandidate,
  type ApplyLogExportRecord,
  verifyCandidate,
} from "@workspace/distill-dataset";
import { loadProductionContract } from "./distill-backfill.mts";

const PAGE_SIZE = 20;
const MAX_RECORDS = 5_000;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 250 * 1024 * 1024;
const MAX_PAGE_BYTES = 24 * 1024 * 1024;
const MAX_LINE_BYTES = 1024 * 1024;

type ExportOptions = {
  apiBase: string;
  cookieFile: string;
  out: string;
  repoRoot: string;
};

type ExportPage = {
  records: ApplyLogExportRecord[];
  nextCursor: string | null;
};

function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function privatePath(filePath: string, repoRoot: string, label: string): string {
  if (!path.isAbsolute(filePath)) throw new Error(`${label} must be an absolute path outside the repository`);
  const actual = fs.realpathSync(filePath);
  if (isWithin(fs.realpathSync(repoRoot), actual)) throw new Error(`${label} must be outside the repository`);
  return actual;
}

function readCookieHeader(cookieFile: string, repoRoot: string): string {
  const actual = privatePath(cookieFile, repoRoot, "--cookie-file");
  const stat = fs.statSync(actual);
  if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size < 1 || stat.size > 8192) {
    throw new Error("--cookie-file must be a small regular file with owner-only permissions");
  }
  const value = fs.readFileSync(actual, "utf8").trim();
  if (!value || /[\r\n]/u.test(value)) throw new Error("--cookie-file must contain one HTTP Cookie header line");
  return value;
}

function validateApiBase(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("--api-base must be an HTTPS URL (HTTP is allowed only for localhost)");
  }
  const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !localHttp) ||
    url.username || url.password || url.search || url.hash
  ) throw new Error("--api-base must be an HTTPS URL (HTTP is allowed only for localhost)");
  return url;
}

function openPrivateOutput(out: string, repoRoot: string): { fd: number; actualPath: string } {
  if (!path.isAbsolute(out)) throw new Error("--out must be an absolute path outside the repository");
  const absolute = path.resolve(out);
  const parent = fs.realpathSync(path.dirname(absolute));
  const actualPath = path.join(parent, path.basename(absolute));
  if (isWithin(fs.realpathSync(repoRoot), actualPath)) {
    throw new Error("--out must be outside the repository");
  }
  const parentStat = fs.statSync(parent);
  if (!parentStat.isDirectory() || (parentStat.mode & 0o077) !== 0) {
    throw new Error("--out parent directory must have owner-only permissions");
  }
  if (fs.existsSync(actualPath)) throw new Error("--out must name a new file");
  const fd = fs.openSync(actualPath, "wx", 0o600);
  fs.fchmodSync(fd, 0o600);
  return { fd, actualPath };
}

function parsePage(value: unknown): ExportPage {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Evidence export returned an invalid page");
  }
  const page = value as Record<string, unknown>;
  if (
    !Array.isArray(page.records) ||
    page.records.some((record) => !record || typeof record !== "object" || Array.isArray(record)) ||
    !(page.nextCursor === null || typeof page.nextCursor === "string")
  ) throw new Error("Evidence export returned an invalid page");
  return { records: page.records as ApplyLogExportRecord[], nextCursor: page.nextCursor as string | null };
}

export async function exportApplyLog(
  options: ExportOptions,
  dependencies: {
    fetchPage?: typeof fetch;
    contract?: Awaited<ReturnType<typeof loadProductionContract>>;
  } = {},
): Promise<{ exported: number; skipped: number }> {
  const cookie = readCookieHeader(options.cookieFile, options.repoRoot);
  const apiBase = validateApiBase(options.apiBase);
  const contract = dependencies.contract ?? await loadProductionContract(options.repoRoot);
  const fetchPage = dependencies.fetchPage ?? fetch;
  const endpoint = new URL(
    `${apiBase.pathname.replace(/\/+$/u, "")}/api/import-operations/distillation-evidence`,
    apiBase.origin,
  );
  const output = openPrivateOutput(options.out, options.repoRoot);
  let exported = 0;
  let skipped = 0;
  let responseBytes = 0;
  let outputBytes = 0;
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  try {
    do {
      const requestUrl = new URL(endpoint);
      requestUrl.searchParams.set("limit", String(PAGE_SIZE));
      if (cursor) requestUrl.searchParams.set("cursor", cursor);
      const response = await fetchPage(requestUrl, {
        method: "GET",
        headers: { Accept: "application/json", Cookie: cookie },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`Evidence export request failed (${response.status})`);
      const responseText = await response.text();
      const pageBytes = Buffer.byteLength(responseText, "utf8");
      responseBytes += pageBytes;
      if (pageBytes > MAX_PAGE_BYTES || responseBytes > MAX_RESPONSE_BYTES) {
        throw new Error("Evidence export exceeded its private size limit");
      }
      let pageValue: unknown;
      try {
        pageValue = JSON.parse(responseText);
      } catch {
        throw new Error("Evidence export returned invalid JSON");
      }
      const page = parsePage(pageValue);
      if (page.records.length > PAGE_SIZE) throw new Error("Evidence export exceeded its page limit");
      if (exported + skipped + page.records.length > MAX_RECORDS) {
        throw new Error("Evidence export exceeded its record limit");
      }
      for (const record of page.records) {
        const candidate = createApplyLogCandidate(record, {
          systemPromptSha256: contract.systemPromptSha256,
          currentParseVersion: contract.currentParseVersion,
        });
        if (!candidate || verifyCandidate(candidate, {
          systemPromptSha256: contract.systemPromptSha256,
          currentParseVersion: contract.currentParseVersion,
        }).state !== "verified") {
          skipped++;
          continue;
        }
        const line = `${JSON.stringify(candidate)}\n`;
        const lineBytes = Buffer.byteLength(line, "utf8");
        if (lineBytes > MAX_LINE_BYTES) {
          skipped++;
          continue;
        }
        if (outputBytes + lineBytes > MAX_TOTAL_BYTES) {
          throw new Error("Evidence export exceeds the supported JSONL file size limit");
        }
        fs.writeSync(output.fd, line);
        outputBytes += lineBytes;
        exported++;
      }
      cursor = page.nextCursor;
      if (cursor && seenCursors.has(cursor)) throw new Error("Evidence export returned a repeated cursor");
      if (cursor) seenCursors.add(cursor);
    } while (cursor);
    fs.fsyncSync(output.fd);
    fs.fchmodSync(output.fd, 0o600);
    fs.closeSync(output.fd);
    return { exported, skipped };
  } catch (error) {
    try { fs.closeSync(output.fd); } catch {}
    try { fs.rmSync(output.actualPath, { force: true }); } catch {}
    throw error;
  }
}

function parseArgs(args: string[], repoRoot: string): ExportOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (!["--api-base", "--cookie-file", "--out"].includes(flag)) {
      throw new Error(`Unknown argument: ${flag}`);
    }
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    values.set(flag, value);
  }
  const apiBase = values.get("--api-base");
  const cookieFile = values.get("--cookie-file");
  const out = values.get("--out");
  if (!apiBase || !cookieFile || !out) {
    throw new Error("Usage: distill:export-applylog --api-base URL --cookie-file PRIVATE_FILE --out PRIVATE_FILE");
  }
  return { apiBase, cookieFile, out, repoRoot };
}

async function main(): Promise<void> {
  const scriptPath = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(scriptPath), "../..");
  try {
    const result = await exportApplyLog(parseArgs(process.argv.slice(2), repoRoot));
    console.log(`Private Apply evidence export complete: ${result.exported} records exported, ${result.skipped} unsupported records skipped.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "private Apply evidence export failed");
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}