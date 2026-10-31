import { hostname } from "node:os";
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, opendirSync,
  readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Owner approved automatic 30-day retention. No release reports are in scope.
export const RETENTION_DAYS = 30;
const DAY = 86_400_000;
const UUID = "[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}";
const ID = new RegExp(`^${UUID}$`);
const QUARANTINE = new RegExp(`^\\.cleanup-(${UUID})$`);
const FILE = new RegExp(`^(?:start\\.json|progress\\.json|reporter-claim|retention-owner\\.json|reporter-owner\\.json|(?:progress\\.json\\.${UUID}\\.pending))$`);
const MAX_ENTRIES = 10_000;
const MAX_FILES = 512;
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_ATTEMPTS = 100;
const storage = (root) => resolve(root, ".local/browser-verification-attempts");
const regular = (path) => {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.nlink !== 1) throw new Error("unsafe-entry");
  return stat;
};
const json = (path, budget) => {
  const size = regular(path).size;
  if (size > 2 * 1024 * 1024) throw new Error("oversize-metadata");
  if (budget) {
    budget.remaining -= size;
    if (budget.remaining < 0) { budget.exhausted = true; throw new Error("read-budget"); }
  }
  return JSON.parse(readFileSync(path, "utf8"));
};
function names(path, limit) {
  const directory = opendirSync(path);
  const result = [];
  let truncated = false;
  try {
    let entry;
    while ((entry = directory.readSync())) {
      if (result.length === limit) { truncated = true; break; }
      result.push(entry.name);
    }
  } finally { directory.closeSync(); }
  return { names: result, truncated };
}
function safeStorage(root) {
  for (const path of [resolve(root, ".local"), storage(root)]) {
    try {
      if (!lstatSync(path).isDirectory()) throw new Error("unsafe-storage");
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  }
  return true;
}
function exclusiveJson(path, value) {
  const fd = openSync(path, "wx", 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(value)}\n`);
    fsyncSync(fd);
  } finally { closeSync(fd); }
}
/** Metadata only: both launcher and reporter processes protect their attempt. */
export function writeBrowserAttemptOwner(directory, reporter = false) {
  exclusiveJson(resolve(directory, reporter ? "reporter-owner.json" : "retention-owner.json"), {
    schemaVersion: 1, kind: "browser-attempt-owner", host: hostname(),
    pids: reporter ? [process.pid] : [process.pid, process.ppid],
  });
}
function ownerDead(path, alive, budget) {
  const owner = json(path, budget);
  if (owner.schemaVersion !== 1 || owner.kind !== "browser-attempt-owner" ||
      owner.host !== hostname() || !Array.isArray(owner.pids) ||
      owner.pids.length < 1 || owner.pids.length > 2 ||
      owner.pids.some((pid) => !Number.isSafeInteger(pid) || pid <= 1)) return false;
  return owner.pids.every((pid) => !alive(pid));
}
const isAlive = (pid) => {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if (error.code === "ESRCH") return false;
    return true; // Permission errors and unknown failures are not proof of death.
  }
};
function inspect(base, name, now, alive, budget) {
  const match = QUARANTINE.exec(name);
  const id = match?.[1] ?? name;
  const path = resolve(base, name);
  const recognized = ID.test(id);
  const row = { attemptId: recognized ? id : null, directory: recognized ? name : null, bytes: 0, files: 0,
    pendingBytes: 0, pendingFiles: 0, ageDays: null, reason: "unrecognized",
    eligible: false, quarantine: !!match };
  try {
    if (!recognized || !lstatSync(path).isDirectory()) return row;
    const listing = names(path, MAX_FILES + 1);
    if (listing.truncated || listing.names.filter((name) => name !== "cleanup.json").length > MAX_FILES) {
      row.reason = "file-limit"; return row;
    }
    const files = listing.names.map((name) => {
      const stat = regular(resolve(path, name));
      row.bytes += stat.size;
      row.files++;
      if (name.endsWith(".pending")) {
        row.pendingFiles++; row.pendingBytes += stat.size;
      }
      return { name, size: stat.size, mtimeMs: stat.mtimeMs,
        ino: stat.ino, dev: stat.dev };
    });
    row.entries = files;
    const marked = listing.names.includes("cleanup.json");
    const newest = Math.max(marked ? 0 : lstatSync(path).mtimeMs,
      ...files.filter((file) => file.name !== "cleanup.json").map((file) => file.mtimeMs));
    row.ageDays = Math.max(0, (now - newest) / DAY);
    if (listing.names.includes("retain")) { row.reason = "retained"; return row; }
    if (listing.names.some((name) => !FILE.test(name) && name !== "cleanup.json"))
      return row;
    if (match || marked) {
      // Empty quarantine directories can remain if interrupted after the final unlink.
      if (match && !listing.names.length) {
        row.reason = "interrupted-cleanup"; row.eligible = true; return row;
      }
      const marker = json(resolve(path, "cleanup.json"), budget);
      if (marker.schemaVersion !== 1 || marker.kind !== "approved-browser-cleanup" ||
          marker.attemptId !== id || marker.retentionDays !== RETENTION_DAYS ||
          !Number.isFinite(marker.approvedAt) || marker.approvedAt > now)
        return row;
      // An interrupted cleanup was already checked before its atomic rename.
      if (match) {
        row.reason = "interrupted-cleanup"; row.eligible = true; return row;
      }
    }
    const start = json(resolve(path, "start.json"), budget);
    if (start.schemaVersion !== 1 || start.attemptId !== id ||
        start.environment !== "isolated-test" || start.phase !== "startup" ||
        start.authority !== "diagnostic-only; never release evidence or resumable passes" ||
        !Number.isFinite(Date.parse(start.startedAt))) return row;
    row.lane = start.lane ?? "chromium-full";
    if (!["chromium-full", "webkit-smoke", "webkit-compatibility", "webkit-compatibility-debug"].includes(row.lane))
      return row;
    const progress = listing.names.includes("progress.json") ? json(resolve(path, "progress.json"), budget) : null;
    if (progress && (progress.schemaVersion !== 1 || progress.attemptId !== id ||
        progress.environment !== start.environment || progress.authority !== start.authority))
      return row;
    row.complete = progress?.coverage === "COMPLETE";
    row.startedAt = Date.parse(start.startedAt);
    if (listing.names.includes("reporter-claim") &&
        (regular(resolve(path, "reporter-claim")).size !== 8 ||
        readFileSync(resolve(path, "reporter-claim"), "utf8") !== "claimed\n")) return row;
    const owners = listing.names.filter((name) => name === "retention-owner.json" || name === "reporter-owner.json");
    if (owners.some((name) => !ownerDead(resolve(path, name), alive, budget))) {
      row.reason = "active-or-uncertain-owner"; return row;
    }
    // Older interrupted attempts predate ownership metadata. Never infer their
    // inactivity from elapsed time alone. Ended, claimed legacy attempts are safe.
    if (!owners.length && !(progress?.phase === "ended" && listing.names.includes("reporter-claim"))) {
      row.reason = "legacy-activity-unknown"; return row;
    }
    if (row.ageDays <= RETENTION_DAYS) { row.reason = "within-retention"; return row; }
    row.eligible = true; row.reason = "expired";
  } catch {
    row.reason = "unreadable-or-unsafe";
  }
  return row;
}
function publicRow({ entries, complete, startedAt, ...row }) { return row; }

/** Read-only, bounded inventory; never reads case payloads into its output. */
export function previewBrowserAttemptRetention({ root, now = Date.now(), alive = isAlive }) {
  const report = { schemaVersion: 1, environment: "local-workspace", authority: "diagnostic-only",
    retentionDays: RETENTION_DAYS, capturedAt: new Date(now).toISOString(),
    truncated: false, attempts: [], totals: { bytes: 0, files: 0, pendingBytes: 0,
      pendingFiles: 0, candidateBytes: 0, candidateAttempts: 0 },
    ageBuckets: { under7: 0, days7to30: 0, days30to90: 0, over90: 0, unknown: 0 } };
  if (!safeStorage(root)) return report;
  const listing = names(storage(root), MAX_ENTRIES);
  report.truncated = listing.truncated;
  const budget = { remaining: MAX_BYTES, exhausted: false };
  const rows = [];
  for (const name of listing.names) {
    rows.push(inspect(storage(root), name, now, alive, budget));
    if (budget.exhausted) { report.truncated = true; break; }
  }
  // Keep each lane's newest complete snapshot; a newer WebKit run must not
  // displace the retained Chromium baseline (or another WebKit lane's baseline).
  const latestByLane = new Map();
  for (const row of rows.filter((row) => row.complete)) {
    if (!latestByLane.has(row.lane) || row.startedAt > latestByLane.get(row.lane).startedAt)
      latestByLane.set(row.lane, row);
  }
  for (const latest of latestByLane.values()) {
    latest.eligible = false; latest.reason = "latest-complete-baseline";
  }
  for (const row of rows) {
    const bucket = row.ageDays === null ? "unknown" : row.ageDays < 7 ? "under7" :
      row.ageDays <= 30 ? "days7to30" : row.ageDays <= 90 ? "days30to90" : "over90";
    report.ageBuckets[bucket] += row.bytes;
    for (const key of ["bytes", "files", "pendingBytes", "pendingFiles"]) report.totals[key] += row[key];
    if (row.eligible) {
      report.totals.candidateBytes += row.bytes; report.totals.candidateAttempts++;
    }
  }
  report.attempts = rows.map(publicRow);
  return report;
}

/** Explicit apply, also called at startup under the owner's standing approval. */
export function cleanupBrowserAttempts({ root, now = Date.now(), alive = isAlive,
  unlink = unlinkSync } = {}) {
  const preview = previewBrowserAttemptRetention({ root, now, alive });
  const result = { retentionDays: RETENTION_DAYS, deletedFiles: 0, deletedBytes: 0,
    deletedAttempts: 0, deferredAttempts: 0, failures: [], truncated: preview.truncated,
    limits: { attempts: MAX_ATTEMPTS, bytes: MAX_BYTES } };
  // Missing inventory entries could hide a retained baseline. Fail closed.
  if (preview.truncated) return result;
  const candidates = preview.attempts.filter((row) => row.eligible)
    .sort((a, b) => Number(b.quarantine) - Number(a.quarantine) || b.ageDays - a.ageDays);
  let budget = 0;
  for (const candidate of candidates) {
    if (result.deletedAttempts + result.failures.length >= MAX_ATTEMPTS || budget + candidate.bytes > MAX_BYTES) {
      result.deferredAttempts++; continue;
    }
    budget += candidate.bytes;
    let path = resolve(storage(root), candidate.directory);
    try {
      const fresh = inspect(storage(root), candidate.directory, now, alive);
      if (!fresh.eligible || fresh.bytes !== candidate.bytes || fresh.files !== candidate.files) {
        result.deferredAttempts++; continue;
      }
      if (!candidate.quarantine) {
        // Exclusive marker means concurrent cleaners cannot claim the same attempt.
        if (!fresh.entries.some((entry) => entry.name === "cleanup.json")) {
          exclusiveJson(resolve(path, "cleanup.json"), {
            schemaVersion: 1, kind: "approved-browser-cleanup",
            attemptId: candidate.attemptId, retentionDays: RETENTION_DAYS, approvedAt: now,
          });
        }
        const claimed = inspect(storage(root), candidate.directory, now, alive);
        if (!claimed.eligible) { result.deferredAttempts++; continue; }
        const quarantine = resolve(storage(root), `.cleanup-${candidate.attemptId}`);
        renameSync(path, quarantine);
        path = quarantine;
      }
      const listing = names(path, MAX_FILES + 1);
      if (listing.truncated || listing.names.some((name) => !FILE.test(name) && name !== "cleanup.json"))
        throw new Error("changed-cleanup");
      // The marker is deleted last, so an interrupted pass can be retried.
      for (const name of listing.names.filter((name) => name !== "cleanup.json")) {
        const stat = regular(resolve(path, name));
        unlink(resolve(path, name));
        result.deletedFiles++; result.deletedBytes += stat.size;
      }
      if (listing.names.includes("cleanup.json")) unlink(resolve(path, "cleanup.json"));
      rmdirSync(path);
      result.deletedAttempts++;
    } catch {
      result.failures.push({ attemptId: candidate.attemptId, code: "cleanup-incomplete",
        action: "Retry cleanup; unrecognized or retained files require owner review." });
    }
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length && args[0] !== "--apply"))
      throw new Error("invalid-arguments");
    const root = fileURLToPath(new URL("../../", import.meta.url));
    const result = args[0] === "--apply" ? cleanupBrowserAttempts({ root }) :
      previewBrowserAttemptRetention({ root });
    console.log(JSON.stringify(result, null, 2));
    if (result.failures?.length || result.truncated) process.exitCode = 1;
  } catch {
    console.error("Browser retention could not safely inspect storage. No further cleanup attempted.");
    process.exitCode = 1;
  }
}
