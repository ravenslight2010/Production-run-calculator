import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

const IDLE_WINDOW_MS = 60_000;
const PROCESS_SAMPLE_INTERVAL_MS = 5_000;
const SYNC_RECOVERY_REQUESTS = 8;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chicagoDate() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type) => parts.find((entry) => entry.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

async function readProcessSample(pid) {
  const stat = await readFile(`/proc/${pid}/stat`, "utf8");
  const afterCommand = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/);
  const cpuTicks = Number(afterCommand[11]) + Number(afterCommand[12]);
  const status = await readFile(`/proc/${pid}/status`, "utf8");
  const rssKb = Number(status.match(/^VmRSS:\s+(\d+)\s+kB$/m)?.[1]);
  assert(Number.isFinite(cpuTicks) && Number.isFinite(rssKb), "Could not read isolated API process metrics.");
  return { cpuTicks, rssKb };
}

async function readDatabaseSample(stage) {
  const { rows: [row] } = await stage.query(`
    SELECT xact_commit::text AS commits,
           tup_returned::text AS tuples_returned,
           numbackends::int AS backends
    FROM pg_stat_database
    WHERE datname = current_database()
  `);
  assert(row, "Could not read isolated PostgreSQL workload counters.");
  return {
    commits: Number(row.commits),
    tuplesReturned: Number(row.tuples_returned),
    backends: Number(row.backends),
  };
}

async function readActiveRunEvidence(stage, date) {
  const { rows: [syncRow] } = await stage.query(
    `SELECT canonical_revision::text AS revision,
            jsonb_array_length(COALESCE(data->'dayState'->'runs', '[]'::jsonb))::int AS runs
     FROM daily_sync WHERE date = $1 AND scope = 'live'`,
    [date],
  );
  const { rows: [intentRow] } = await stage.query(
    `SELECT count(*) FILTER (
       WHERE command_type = 'auto-track' AND outcome = 'accepted'
     )::int AS accepted_auto_track
     FROM operational_intent_ledger WHERE date = $1 AND scope = 'live'`,
    [date],
  );
  return {
    canonicalRevision: Number(syncRow?.revision ?? 0),
    runCount: Number(syncRow?.runs ?? 0),
    acceptedAutoTrackIntents: Number(intentRow?.accepted_auto_track ?? 0),
  };
}

async function requestSync(stage, date, snapshot) {
  const url = new URL("/api/sync/today", stage.appUrl);
  url.searchParams.set("today", date);
  if (snapshot) url.searchParams.set("snapshot", snapshot);
  const startedAt = performance.now();
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${stage.credentials.manager.token}` },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  const durationMs = performance.now() - startedAt;
  const body = await response.json();
  return {
    status: response.status,
    durationMs: Math.round(durationMs * 100) / 100,
    snapshot: response.headers.get("X-Sync-Snapshot"),
    unchanged: body?.unchanged === true,
    runCount: Array.isArray(body?.dayState?.runs) ? body.dayState.runs.length : null,
  };
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

async function measureScenario(stage, name, date) {
  const warmup = await requestSync(stage, date, null);
  assert.equal(warmup.status, 200, `${name}: sync warm-up failed.`);

  const processSamples = [await readProcessSample(stage.appPid)];
  const databaseBefore = await readDatabaseSample(stage);
  const runEvidenceBefore = await readActiveRunEvidence(stage, date);
  const idleStartedAt = Date.now();
  const idleDeadline = idleStartedAt + IDLE_WINDOW_MS;
  while (Date.now() < idleDeadline) {
    await delay(Math.min(PROCESS_SAMPLE_INTERVAL_MS, idleDeadline - Date.now()));
    processSamples.push(await readProcessSample(stage.appPid));
  }
  const idleDurationMs = Date.now() - idleStartedAt;
  const databaseAfterIdle = await readDatabaseSample(stage);
  const runEvidenceAfterIdle = await readActiveRunEvidence(stage, date);

  const latencies = [];
  const statuses = [];
  let snapshot = warmup.snapshot;
  let unchangedResponses = 0;
  let lastRunCount = warmup.runCount;
  for (let index = 0; index < SYNC_RECOVERY_REQUESTS; index += 1) {
    const response = await requestSync(stage, date, index === 0 ? null : snapshot);
    statuses.push(response.status);
    assert.equal(response.status, 200, `${name}: sync recovery request failed.`);
    latencies.push(response.durationMs);
    if (response.snapshot) snapshot = response.snapshot;
    if (response.unchanged) unchangedResponses += 1;
    if (response.runCount !== null) lastRunCount = response.runCount;
  }
  const databaseAfterRecovery = await readDatabaseSample(stage);
  const cpuTicks = processSamples.map((sample) => sample.cpuTicks);
  const rssValues = processSamples.map((sample) => sample.rssKb);

  return {
    scenario: name,
    idleWindowMs: idleDurationMs,
    syncRecovery: {
      requestCount: latencies.length,
      non200Responses: statuses.filter((status) => status !== 200).length,
      medianMs: percentile(latencies, 0.5),
      p95Ms: percentile(latencies, 0.95),
      snapshotReceived: Boolean(snapshot),
      unchangedResponses,
      finalRunCount: lastRunCount,
    },
    duringIdle: {
      transactionCommits: databaseAfterIdle.commits - databaseBefore.commits,
      tuplesReturned: databaseAfterIdle.tuplesReturned - databaseBefore.tuplesReturned,
      backendCountBefore: databaseBefore.backends,
      backendCountAfter: databaseAfterIdle.backends,
      appCpuTicks: Math.max(0, cpuTicks.at(-1) - cpuTicks[0]),
      appRssMinKb: Math.min(...rssValues),
      appRssMaxKb: Math.max(...rssValues),
      processSamples: processSamples.length,
      canonicalRevisionBefore: runEvidenceBefore.canonicalRevision,
      canonicalRevisionAfter: runEvidenceAfterIdle.canonicalRevision,
      runCountBefore: runEvidenceBefore.runCount,
      runCountAfter: runEvidenceAfterIdle.runCount,
      acceptedAutoTrackIntents: runEvidenceAfterIdle.acceptedAutoTrackIntents -
        runEvidenceBefore.acceptedAutoTrackIntents,
    },
    duringRecovery: {
      transactionCommits: databaseAfterRecovery.commits - databaseAfterIdle.commits,
      tuplesReturned: databaseAfterRecovery.tuplesReturned - databaseAfterIdle.tuplesReturned,
    },
  };
}

function activeRunData(date) {
  const now = Date.now();
  const runId = "isolated-synthetic-active-run";
  return {
    dayState: {
      date,
      currentIndex: 0,
      runs: [{ id: runId, subTab: "crusts", startedAt: now - 120_000, metaUpdatedAt: now - 120_000 }],
    },
    runValuesUpdatedAt: { [runId]: now - 120_000 },
    runValues: {
      [runId]: {
        casesNeeded: 200,
        crustsPerCycle: 12,
        cycleSpeed: 600,
        speedAdjustment: 1,
        approxLineSpeed: 400,
        freezerTime: 3,
        pizzasPerCase: 12,
        casesPerSkid: 48,
        casesPerLayer: 12,
        doughballsPerTray: 36,
        batchesReady: 0,
        doughBatchYield: 150,
        crustsPerStack: 6,
        crustsPerCase: 12,
        targetDoughballWeight: 8,
        doughRecipe: [],
        sauceBarrelsMade: 0,
        sauceBarrelAnchorNetSec: 0,
        sauceBarrelCorrectionGeneration: 0,
        sauceOzPerPizza: 0,
        frontlineRecipeName: "",
        frontlineRecipe: [],
        app1Type: "Cheese",
        app1OzPerPizza: 2,
        app1BatchLbs: 50,
        app1CheeseRecipe: [],
        app1BatchesMade: 0,
        app1BatchAnchorNetSec: 0,
        app1BatchCorrectionGeneration: 0,
        app1StockLbs: 0,
        app1StockConsumedLbs: 0,
        app1StockAnchorNetSec: 0,
        app1StockCorrectionGeneration: 0,
        applicatorStockInitialized: true,
        app2Type: "",
        app2OzPerPizza: 0,
        app2BatchLbs: 0,
        app2CheeseRecipe: [],
        app3Type: "",
        app3OzPerPizza: 0,
        app3BatchLbs: 0,
        app3CheeseRecipe: [],
        app4Type: "",
        app4OzPerPizza: 0,
        app4BatchLbs: 0,
        app4CheeseRecipe: [],
        pep1Type: "",
        pep2Type: "",
        pep1Combined: true,
      },
    },
  };
}

export async function measureBackgroundLoad(stage, profile) {
  assert(["quiet", "full"].includes(profile), "Unknown isolated background profile.");
  const date = chicagoDate();
  const measurements = [];
  const emptyData = { dayState: { date, currentIndex: 0, runs: [] }, runValues: {} };
  await stage.query(
    `INSERT INTO daily_sync (date, scope, data, canonical_revision)
     VALUES ($1, 'live', $2::jsonb, 0)
     ON CONFLICT (date, scope) DO UPDATE
     SET data = EXCLUDED.data, canonical_revision = 0, updated_at = now()`,
    [date, JSON.stringify(emptyData)],
  );
  measurements.push(await measureScenario(stage, "idle-no-run", date));

  await stage.query(
    `UPDATE daily_sync SET data = $2::jsonb, canonical_revision = 0, updated_at = now()
     WHERE date = $1 AND scope = 'live'`,
    [date, JSON.stringify(activeRunData(date))],
  );
  measurements.push(await measureScenario(stage, "idle-active-run", date));

  return {
    profile,
    scope: "synthetic isolated database only",
    idleWindowMs: IDLE_WINDOW_MS,
    syncRecoveryRequestCountPerScenario: SYNC_RECOVERY_REQUESTS,
    measurements,
  };
}
