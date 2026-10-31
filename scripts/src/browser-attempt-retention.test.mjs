import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { closeSync, existsSync, ftruncateSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync,
  readdirSync, rmSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { cleanupBrowserAttempts, previewBrowserAttemptRetention, RETENTION_DAYS } from "./browser-attempt-retention.mjs";
import { startBrowserAttempt, claimBrowserAttempt } from "./browser-attempt-progress.mjs";
import { sourceFixture, put } from "./fixtures/build-identity-fixture.mjs";
import { captureReleaseIdentity } from "./release-source-identity.mjs";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-29T10:00:00Z");
function fixture(t) {
  const root = mkdtempSync(resolve(tmpdir(), "attempt-retention-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const base = resolve(root, ".local/browser-verification-attempts");
  mkdirSync(base, { recursive: true });
  const options = { root, now: NOW, alive: () => false };
  return { root, base, options };
}
function age(path, days = 40) {
  const when = new Date(NOW - days * DAY);
  for (const name of readdirSync(path)) utimesSync(resolve(path, name), when, when);
  utimesSync(path, when, when);
}
function attempt(f, { days = 40, phase = "ended", complete = false, owner = true } = {}) {
  const id = randomUUID();
  const path = resolve(f.base, id);
  mkdirSync(path);
  const start = {
    schemaVersion: 1, attemptId: id, environment: "isolated-test",
    authority: "diagnostic-only; never release evidence or resumable passes",
    phase: "startup", startedAt: new Date(NOW - days * DAY).toISOString(),
  };
  writeFileSync(resolve(path, "start.json"), JSON.stringify(start));
  if (phase !== "startup") {
    writeFileSync(resolve(path, "progress.json"), JSON.stringify({
      ...start, phase, coverage: complete ? "COMPLETE" : "INCOMPLETE",
    }));
    writeFileSync(resolve(path, "reporter-claim"), "claimed\n");
  }
  if (owner) writeFileSync(resolve(path, "retention-owner.json"), JSON.stringify({
    schemaVersion: 1, kind: "browser-attempt-owner", host: hostname(), pids: [123456789],
  }));
  age(path, days);
  return { id, path };
}
const rowFor = (f, a) => previewBrowserAttemptRetention(f.options).attempts.find((row) => row.attemptId === a.id);

test("inventory and dry run account bytes, pending files, ages without modifying files", (t) => {
  const f = fixture(t);
  const old = attempt(f);
  const recent = attempt(f, { days: 7 });
  const pending = `progress.json.${randomUUID()}.pending`;
  writeFileSync(resolve(old.path, pending), "metadata-only");
  age(old.path);
  const before = readdirSync(old.path);
  const preview = previewBrowserAttemptRetention(f.options);
  assert.equal(preview.retentionDays, 30);
  assert.equal(preview.totals.candidateAttempts, 1);
  assert.equal(preview.totals.pendingFiles, 1);
  assert.equal(preview.totals.pendingBytes, 13);
  const total = [old, recent].flatMap((a) => readdirSync(a.path).map((n) => lstatSync(resolve(a.path, n)).size)).reduce((a, b) => a + b, 0);
  assert.equal(preview.totals.bytes, total);
  assert.equal(Object.values(preview.ageBuckets).reduce((a, b) => a + b), total);
  assert.deepEqual(readdirSync(old.path), before);
  const result = cleanupBrowserAttempts(f.options);
  assert.equal(result.deletedAttempts, 1);
  assert.equal(result.deletedBytes, preview.totals.candidateBytes);
  assert(!existsSync(old.path));
  assert(existsSync(recent.path));
});

test("live, uncertain, remote and legacy unknown activity remain protected even after 30 days", (t) => {
  const f = fixture(t);
  for (const phase of ["startup", "running", "ended"]) {
    const active = attempt(f, { phase });
    assert.equal(rowFor({ ...f, options: { ...f.options, alive: () => true } }, active).reason, "active-or-uncertain-owner");
  }
  const remote = attempt(f);
  const ownerPath = resolve(remote.path, "retention-owner.json");
  const owner = JSON.parse(readFileSync(ownerPath));
  owner.host = "different-host";
  writeFileSync(ownerPath, JSON.stringify(owner)); age(remote.path);
  assert.equal(rowFor(f, remote).reason, "active-or-uncertain-owner");
  const legacy = attempt(f, { phase: "running", owner: false });
  assert.equal(rowFor(f, legacy).reason, "legacy-activity-unknown");
  const abandoned = attempt(f, { phase: "startup" });
  assert.equal(rowFor(f, abandoned).eligible, true);
  assert.equal(cleanupBrowserAttempts({ ...f.options, alive: () => true }).deletedAttempts, 0);
});

test("newest complete baseline, explicit retain pins, external reports and user evidence survive", (t) => {
  const f = fixture(t);
  const prior = attempt(f, { days: 90, complete: true });
  const latest = attempt(f, { days: 40, complete: true });
  const pinned = attempt(f, { days: 95, complete: true });
  writeFileSync(resolve(pinned.path, "retain"), "owner baseline"); age(pinned.path, 95);
  const user = attempt(f);
  writeFileSync(resolve(user.path, "owner-evidence.pdf"), "PRIVATE evidence"); age(user.path);
  const report = resolve(f.root, "release-baseline.json");
  writeFileSync(report, "retained release evidence");
  assert.equal(rowFor(f, latest).reason, "latest-complete-baseline");
  assert.equal(rowFor(f, pinned).reason, "retained");
  assert.equal(rowFor(f, user).eligible, false);
  assert.equal(cleanupBrowserAttempts(f.options).deletedAttempts, 1);
  assert(!existsSync(prior.path));
  for (const a of [latest, pinned, user]) assert(existsSync(a.path));
  assert.equal(readFileSync(report, "utf8"), "retained release evidence");
});

test("legacy ended records expire, but refreshed pending files and exact cutoff do not", (t) => {
  const f = fixture(t);
  const old = attempt(f, { owner: false });
  const exact = attempt(f, { days: RETENTION_DAYS });
  const pending = attempt(f);
  writeFileSync(resolve(pending.path, `progress.json.${randomUUID()}.pending`), "new write");
  assert.equal(rowFor(f, pending).reason, "within-retention");
  assert.equal(rowFor(f, exact).reason, "within-retention");
  assert.equal(cleanupBrowserAttempts(f.options).deletedAttempts, 1);
  assert(!existsSync(old.path));
});

test("each Chromium and WebKit lane keeps its own latest complete snapshot", (t) => {
  const f = fixture(t);
  for (const lane of ["chromium-full", "webkit-smoke", "webkit-compatibility", "webkit-compatibility-debug"]) {
    const baseline = attempt(f, { complete: true, days: 40 });
    const previous = attempt(f, { complete: true, days: 80 });
    for (const a of [baseline, previous]) {
      const path = resolve(a.path, "start.json");
      writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path)), lane }));
      age(a.path, a === baseline ? 40 : 80);
    }
    assert.equal(rowFor(f, baseline).reason, "latest-complete-baseline");
    assert.equal(rowFor(f, previous).eligible, true);
  }
  assert.equal(cleanupBrowserAttempts(f.options).deletedAttempts, 4);
  assert.equal(readdirSync(f.base).length, 4);
});

test("failed deletion is explicit and a subsequent pass resumes a partial quarantine", (t) => {
  const f = fixture(t);
  const old = attempt(f);
  let calls = 0;
  const first = cleanupBrowserAttempts({ ...f.options, unlink(path) {
    if (++calls === 2) throw new Error("PRIVATE filesystem error");
    unlinkSync(path);
  } });
  assert.equal(first.failures.length, 1);
  assert.equal(first.deletedFiles, 1);
  assert(!JSON.stringify(first).includes("PRIVATE"));
  assert(existsSync(resolve(f.base, `.cleanup-${old.id}`, "cleanup.json")));
  const second = cleanupBrowserAttempts(f.options);
  assert.equal(second.deletedAttempts, 1);
  assert.equal(second.failures.length, 0);
  assert.equal(readdirSync(f.base).length, 0);
});

test("pre-rename cleanup markers and empty interrupted quarantines are recoverable", (t) => {
  const f = fixture(t);
  const old = attempt(f);
  writeFileSync(resolve(old.path, "cleanup.json"), JSON.stringify({
    schemaVersion: 1, kind: "approved-browser-cleanup", attemptId: old.id,
    retentionDays: 30, approvedAt: NOW - 1,
  }));
  mkdirSync(resolve(f.base, `.cleanup-${randomUUID()}`));
  assert.equal(cleanupBrowserAttempts(f.options).deletedAttempts, 2);
  assert.deepEqual(readdirSync(f.base), []);
});

test("activity or a retention pin appearing after preview prevents removal", (t) => {
  const activeFixture = fixture(t);
  const active = attempt(activeFixture);
  let probes = 0;
  const result = cleanupBrowserAttempts({
    ...activeFixture.options, alive: () => ++probes > 1,
  });
  assert.equal(result.deletedFiles, 0);
  assert(existsSync(active.path));

  const pinnedFixture = fixture(t);
  const pinned = attempt(pinnedFixture);
  probes = 0;
  const pinnedResult = cleanupBrowserAttempts({
    ...pinnedFixture.options, alive: () => {
      if (++probes === 2) writeFileSync(resolve(pinned.path, "retain"), "new owner pin");
      return false;
    },
  });
  assert.equal(pinnedResult.deletedFiles, 0);
  assert(existsSync(resolve(pinned.path, "retain")));
});

test("malformed metadata, symlinks, unknown files and user filenames fail closed", (t) => {
  const f = fixture(t);
  const bad = attempt(f);
  writeFileSync(resolve(bad.path, "progress.json"), "{broken"); age(bad.path);
  const linked = attempt(f);
  const external = resolve(f.root, "PRIVATE-user-file");
  writeFileSync(external, "preserve");
  symlinkSync(external, resolve(linked.path, `progress.json.${randomUUID()}.pending`));
  age(linked.path);
  symlinkSync(linked.path, resolve(f.base, randomUUID()));
  mkdirSync(resolve(f.base, "PRIVATE-user-folder"));
  const preview = previewBrowserAttemptRetention(f.options);
  assert(!JSON.stringify(preview).includes("PRIVATE"));
  assert.equal(cleanupBrowserAttempts(f.options).deletedAttempts, 0);
  assert.equal(readFileSync(external, "utf8"), "preserve");
});

test("unsafe storage ancestors are rejected rather than followed", (t) => {
  const f = fixture(t);
  const second = fixture(t);
  rmSync(second.root, { recursive: true });
  mkdirSync(second.root);
  symlinkSync(resolve(f.root, ".local"), resolve(second.root, ".local"));
  assert.throws(() => cleanupBrowserAttempts(second.options), /unsafe-storage/);
});

test("large file inventories and oversized records remain untouched", (t) => {
  const f = fixture(t);
  const huge = attempt(f);
  writeFileSync(resolve(huge.path, "progress.json"), " ".repeat(2 * 1024 * 1024 + 1));
  age(huge.path);
  const crowded = attempt(f);
  for (let i = 0; i < 513; i++)
    writeFileSync(resolve(crowded.path, `progress.json.${randomUUID()}.pending`), "");
  age(crowded.path);
  assert.equal(rowFor(f, crowded).reason, "file-limit");
  assert.equal(cleanupBrowserAttempts(f.options).deletedAttempts, 0);
});

test("cleanup stops at 100 attempts and reports deferral", (t) => {
  const f = fixture(t);
  for (let i = 0; i < 102; i++) attempt(f);
  const result = cleanupBrowserAttempts(f.options);
  assert.equal(result.deletedAttempts, 100);
  assert.equal(result.deferredAttempts, 2);
  assert.equal(cleanupBrowserAttempts(f.options).deletedAttempts, 2);
});

test("64 MiB candidate budget defers oversized attempts without deleting any files", (t) => {
  const f = fixture(t);
  const large = attempt(f);
  // Pending files are statted, not parsed; sparse files avoid allocating test data.
  const pending = resolve(large.path, `progress.json.${randomUUID()}.pending`);
  writeFileSync(pending, "");
  const fd = openSync(pending, "r+");
  try { ftruncateSync(fd, 64 * 1024 * 1024); }
  finally { closeSync(fd); }
  age(large.path);
  const result = cleanupBrowserAttempts(f.options);
  assert.equal(result.deletedFiles, 0);
  assert.equal(result.deferredAttempts, 1);
  assert(existsSync(pending));
});

test("inventory read budget exhaustion disables all deletion", (t) => {
  const f = fixture(t);
  const padding = "x".repeat(1_950_000);
  for (let i = 0; i < 35; i++) {
    const a = attempt(f);
    const path = resolve(a.path, "progress.json");
    writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path)), padding }));
    age(a.path);
  }
  assert.equal(previewBrowserAttemptRetention(f.options).truncated, true);
  const result = cleanupBrowserAttempts(f.options);
  assert.equal(result.truncated, true);
  assert.equal(result.deletedAttempts, 0);
  assert.equal(readdirSync(f.base).length, 35);
});

test("store entry cap disables deletion when a baseline might be outside inventory", (t) => {
  const f = fixture(t);
  attempt(f);
  for (let i = 0; i < 10_001; i++) mkdirSync(resolve(f.base, `unknown-${i}`));
  const result = cleanupBrowserAttempts(f.options);
  assert.equal(result.truncated, true);
  assert.equal(result.deletedFiles, 0);
});

test("maximum-sized diagnostic inventory still cleans with its extra cleanup marker", (t) => {
  const f = fixture(t);
  const a = attempt(f);
  for (let i = readdirSync(a.path).length; i < 512; i++)
    writeFileSync(resolve(a.path, `progress.json.${randomUUID()}.pending`), "");
  age(a.path);
  assert.equal(cleanupBrowserAttempts(f.options).deletedAttempts, 1);
  assert(!existsSync(a.path));
});

test("startup automatically cleans expired metadata and registers live ownership", (t) => {
  const root = sourceFixture(t);
  put(root, "scripts/package.json", "{}");
  const base = resolve(root, ".local/browser-verification-attempts");
  mkdirSync(base, { recursive: true });
  const old = attempt({ base }, { owner: false });
  const identity = captureReleaseIdentity(root);
  const id = startBrowserAttempt({ root, identity, now: () => NOW });
  assert(!existsSync(old.path));
  const path = resolve(base, id);
  const options = { root, now: NOW + 100 * DAY };
  age(path, 40);
  assert.equal(previewBrowserAttemptRetention(options).attempts[0].reason, "active-or-uncertain-owner");
  claimBrowserAttempt({ root, identity, attemptId: id });
  assert(existsSync(resolve(path, "reporter-owner.json")));
});

test("a cleanup-claimed attempt cannot be adopted by a reporter", (t) => {
  const root = sourceFixture(t);
  put(root, "scripts/package.json", "{}");
  const identity = captureReleaseIdentity(root);
  const id = startBrowserAttempt({ root, identity });
  const path = resolve(root, ".local/browser-verification-attempts", id);
  writeFileSync(resolve(path, "cleanup.json"), "{}");
  const before = readFileSync(resolve(path, "start.json"), "utf8");
  assert.throws(() => claimBrowserAttempt({ root, identity, attemptId: id }), /unavailable/);
  assert(!existsSync(resolve(path, "reporter-claim")));
  assert.equal(readFileSync(resolve(path, "start.json"), "utf8"), before);
});
