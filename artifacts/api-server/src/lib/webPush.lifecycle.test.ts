import { createHash } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computeServerCalc } from "@workspace/live-calc";

// Repository fixtures only: no database connection, jobs, or external sends.
const mocks = vi.hoisted(() => ({
  select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
  send: vi.fn(),
}));
vi.mock("@workspace/db", async () => ({
  ...await import("@workspace/db/schema"),
  db: mocks,
}));
vi.mock("./serverJobs", () => ({ registerServerJob: vi.fn() }));
vi.mock("./roles", () => ({ getUserCapabilities: vi.fn(async () => []) }));
vi.mock("./logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("web-push", () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: mocks.send },
}));

import {
  dailySyncTable, scheduledAlertRecordsTable, webPushAlertArmsTable,
  webPushDeliveriesTable, webPushSubscriptionsTable,
} from "@workspace/db/schema";
import {
  alertCandidates, fifteenArm, freezerCandidates, pendingFreezerArms, runWebPushAlerts,
} from "./webPush";

const NOW = Date.parse("2030-04-01T12:00:00Z");
const DATE = "2030-04-01";
const key = (id: string, startedAt: number) =>
  createHash("sha256").update(`${id}:${startedAt}`).digest("hex").slice(0, 24);
const fixture = () => ({
  dayState: {
    runs: [
      { id: "old", startedAt: NOW - 600_000, endedAt: NOW - 30_000 },
      { id: "active", startedAt: NOW - 120_000, subTab: "crusts", autoTrackDisabled: true },
      { id: "pending" },
    ],
  },
  runValues: {
    old: { approxLineSpeed: 1, casesNeeded: 1, casesPerSkid: 1, freezerTime: 1 },
    active: {
      approxLineSpeed: 60, pizzasPerCase: 6, casesNeeded: 100, casesPerSkid: 60,
      crustsPerCase: 60, freezerTime: 0,
    },
  },
  packagingProgress: { active: { skidsCompleted: 0, casesOnCurrentSkid: 0 } },
});

describe("canonical background alert lifecycle with real calculations", () => {
  beforeEach(() => { mocks.send.mockClear(); });

  it.each([undefined, -1, 0, 2, 99])("ignores device selection %s after the first run ends", (currentIndex) => {
    const data = fixture();
    const payload = { ...data, dayState: { ...data.dayState, currentIndex } };
    const before = JSON.stringify(payload);
    // This is the old calculation target: canonical sync omits currentIndex.
    expect(computeServerCalc(data, [], NOW)?.runId).toBe("old");
    const expected = alertCandidates({
      ...data, dayState: { runs: [data.dayState.runs[1]!] },
    }, DATE, NOW);
    expect(expected.map((c) => c.kind)).toEqual([
      "fifteenMin", "batchDue", "warehouseStaging",
    ]);
    expect(alertCandidates(payload, DATE, NOW)).toEqual(expected);
    const activeKey = key("active", data.dayState.runs[1]!.startedAt!);
    expect(expected.every((c) => c.id.startsWith(`${DATE}:${activeKey}:`))).toBe(true);
    expect(expected.find((c) => c.kind === "batchDue")?.id).toMatch(/:batch:2$/);
    expect(JSON.stringify(payload)).toBe(before);
  });

  it("uses only active settings and progress for batches, staging, and completion", () => {
    const data = fixture();
    data.dayState.runs[1]!.autoTrackDisabled = false;
    data.runValues.active.casesPerSkid = 10;
    expect(alertCandidates(data, DATE, NOW).map((c) => c.kind)).toEqual(["fifteenMin"]);
    data.packagingProgress.active.casesOnCurrentSkid = 95;
    expect(alertCandidates(data, DATE, NOW).map((c) => c.kind)).toEqual([
      "fifteenMin", "warehouseStaging", "warehouseStaging",
    ]);
    data.packagingProgress.active.casesOnCurrentSkid = 100;
    expect(alertCandidates(data, DATE, NOW).map((c) => c.kind)).toEqual(["runComplete"]);
  });

  it("binds pre-threshold arming and crossing to the same opaque generation", () => {
    const data = fixture();
    data.runValues.active.casesNeeded = 200; // 20 minutes at the active speed
    const arm = fifteenArm(data, NOW);
    expect(arm).toBe(key("active", data.dayState.runs[1]!.startedAt!));
    data.runValues.active.casesNeeded = 100; // now below fifteen minutes
    const candidate = alertCandidates(data, DATE, NOW).find((c) => c.kind === "fifteenMin")!;
    expect(candidate.armKey).toBe(arm);
    expect(candidate.id).toBe(`${DATE}:${arm}:fifteen-min`);
    expect(fifteenArm(data, NOW)).toBeNull();
    expect(alertCandidates(data, DATE, NOW + 1_000).find((c) => c.kind === "fifteenMin")?.id).toBe(candidate.id);
    data.dayState.runs[1]!.startedAt! += 1;
    expect(alertCandidates(data, DATE, NOW).find((c) => c.kind === "fifteenMin")?.armKey).not.toBe(arm);
  });

  it.each(["paused", "ended", "pending", "missing-values", "zero-speed"] as const)(
    "suppresses both timing alerts and arms for %s without falling back to old values", (state) => {
      const data = fixture();
      if (state === "paused") Object.assign(data.dayState.runs[1]!, { pausedAt: NOW - 1_000 });
      if (state === "ended") Object.assign(data.dayState.runs[1]!, { endedAt: NOW - 1_000 });
      if (state === "pending") data.dayState.runs = [{ id: "pending" }];
      if (state === "missing-values") Reflect.deleteProperty(data.runValues, "active");
      if (state === "zero-speed") data.runValues.active.approxLineSpeed = 0;
      expect(alertCandidates(data, DATE, NOW)).toEqual([]);
      expect(fifteenArm(data, NOW)).toBeNull();
    },
  );

  it("uses the latest lifecycle even when paused, rather than alerting for an earlier running run", () => {
    const data = fixture();
    const latest = {
      id: "latest", startedAt: NOW - 60_000, pausedAt: NOW - 1_000,
      subTab: "crusts", autoTrackDisabled: true,
    };
    Object.assign(data.runValues, { latest: { ...data.runValues.active } });
    data.dayState.runs.push(latest);
    expect(alertCandidates(data, DATE, NOW)).toEqual([]);
    expect(fifteenArm(data, NOW)).toBeNull();
  });

  it("keeps ended-run freezer arms and due alerts independent of the active run", () => {
    const data = fixture();
    const arm = pendingFreezerArms(data, NOW);
    expect(arm).toEqual([key("old", data.dayState.runs[0]!.startedAt!)]);
    expect(freezerCandidates(data, DATE, NOW)).toEqual([]);
    expect(freezerCandidates(data, DATE, NOW + 30_000)).toEqual([{
      id: `${DATE}:${arm[0]}:freezer-empty`, kind: "freezerEmpty",
      dueAt: NOW + 30_000, armKey: arm[0],
    }]);
    expect(pendingFreezerArms(data, NOW + 30_000)).toEqual([]);
  });
});

describe("canonical fifteen-minute durable claim wiring", () => {
  it("looks up the active arm, deduplicates reevaluation, and preserves opt-outs without sends", async () => {
    vi.stubEnv("WEB_PUSH_QUIET_HOURS", "");
    const data = fixture();
    data.runValues.old.freezerTime = 0;
    data.dayState.runs[1]!.autoTrackDisabled = false;
    data.runValues.active.casesPerSkid = 10;
    data.runValues.active.casesNeeded = 200;
    const arms = new Set<string>();
    const records = new Map<string, Record<string, unknown>>();
    const armLookups: unknown[][] = [];
    const deliveryClaims: unknown[] = [];
    const dialect = new PgDialect();
    mocks.select.mockImplementation(() => ({
      from: (table: unknown) => {
        const query = {
          innerJoin: () => query,
          where: async (condition: Parameters<PgDialect["sqlToQuery"]>[0]) => {
            if (table === dailySyncTable) return [{ scope: "live", date: DATE, data }];
            if (table === scheduledAlertRecordsTable) return [];
            if (table === webPushAlertArmsTable) {
              const params = dialect.sqlToQuery(condition).params;
              armLookups.push(params);
              return [...arms].filter((arm) => params.includes(arm)).map((runKey) => ({ runKey }));
            }
            if (table === webPushSubscriptionsTable) return [{
              id: "opted-out-device", userId: "fixture-user",
              endpoint: "https://fcm.googleapis.com/fixture-token",
              notificationPrefs: { fifteenMin: false }, createdAt: new Date(NOW - 600_000),
            }];
            throw new Error("Unexpected fixture read");
          },
        };
        return query;
      },
    }));
    mocks.insert.mockImplementation((table: unknown) => ({
      values: (value: Record<string, unknown>) => ({
        onConflictDoNothing: () => {
          let inserted = false;
          if (table === webPushAlertArmsTable) arms.add(String(value.runKey));
          else if (table === scheduledAlertRecordsTable) {
            if (!records.has(String(value.alertId))) {
              records.set(String(value.alertId), value);
              inserted = true;
            }
          } else if (table === webPushDeliveriesTable) deliveryClaims.push(value);
          else throw new Error("Unexpected fixture write");
          return Object.assign(Promise.resolve(), {
            returning: async () => inserted ? [{ id: value.id }] : [],
          });
        },
      }),
    }));
    mocks.delete.mockReturnValue({ where: async () => {} });
    mocks.update.mockReturnValue({ set: () => ({ where: async () => {} }) });
    try {
      await runWebPushAlerts(NOW, { scope: "live", date: DATE });
      expect(arms).toEqual(new Set([key("active", data.dayState.runs[1]!.startedAt!)]));
      expect(records.size).toBe(0);
      data.runValues.active.casesNeeded = 100;
      await runWebPushAlerts(NOW + 1_000, { scope: "live", date: DATE });
      await runWebPushAlerts(NOW + 2_000, { scope: "live", date: DATE });
      expect(armLookups).toHaveLength(2);
      expect(armLookups.every((params) => params.includes([...arms][0]))).toBe(true);
      expect([...records.values()].map((r) => r.alertKind)).toEqual(["fifteenMin"]);
      expect(deliveryClaims).toEqual([]);
      expect(mocks.send).not.toHaveBeenCalled();
      // A new lifecycle must not borrow the previous run generation's arm.
      data.dayState.runs[1]!.startedAt! += 1;
      await runWebPushAlerts(NOW + 3_000, { scope: "live", date: DATE });
      expect(records.size).toBe(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
