import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureMasterDataSnapshot,
  loadChangeHistory,
  recordMasterDataChange,
  restoreMasterDataSnapshot,
  saveChangeHistory,
  undoChange,
} from "./storage";
import { readLegacyMasterDataHistory, resolveLegacyMasterDataHistory } from "./legacyMasterDataHistory";
import { setProfileCacheIdentity } from "./profileCache";
import { CHANGE_HISTORY_KEY, MAX_CHANGE_HISTORY } from "./types";

const legacy = (id = "legacy-one") => ({
  id, ts: 100, type: "rename", description: "Synthetic legacy rename",
  before: { "run-calc-day": '{"private":"do not project"}', "run-calc-supervisor-pin": "SYNTHETIC_PIN" },
});

it("explicit legacy resolution removes only the old history key, never pending work or PIN state", () => {
  localStorage.setItem(CHANGE_HISTORY_KEY, JSON.stringify([legacy()]));
  localStorage.setItem("synthetic-recovery-outbox", "retained");
  localStorage.setItem("run-calc-supervisor-pin", "synthetic-current-state");
  resolveLegacyMasterDataHistory();
  expect(localStorage.getItem(CHANGE_HISTORY_KEY)).toBeNull();
  expect(localStorage.getItem("synthetic-recovery-outbox")).toBe("retained");
  expect(localStorage.getItem("run-calc-supervisor-pin")).toBe("synthetic-current-state");
});

it("does not claim legacy resolution when browser storage rejects removal", () => {
  localStorage.setItem(CHANGE_HISTORY_KEY, JSON.stringify([legacy()]));
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("Synthetic storage unavailable"); });
  expect(() => resolveLegacyMasterDataHistory()).toThrow(/storage unavailable/iu);
  expect(readLegacyMasterDataHistory().items).toHaveLength(1);
});

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  setProfileCacheIdentity(null);
  setProfileCacheIdentity({ userId: "synthetic-manager", scope: "live" });
});

describe("retired browser master-data rollback", () => {
  it("projects bounded metadata only, retaining all original legacy bytes", () => {
    const raw = JSON.stringify(Array.from({ length: MAX_CHANGE_HISTORY + 3 }, (_, i) => legacy(`legacy-${i}`)));
    localStorage.setItem(CHANGE_HISTORY_KEY, raw);
    const result = readLegacyMasterDataHistory();
    expect(result.problem).toBeNull();
    expect(result.items).toHaveLength(MAX_CHANGE_HISTORY);
    expect(result.items[0]).toMatchObject({ before: {}, evidence: "legacy-only" });
    expect(JSON.stringify(result)).not.toMatch(/SYNTHETIC_PIN|do not project|run-calc-day/);
    expect(localStorage.getItem(CHANGE_HISTORY_KEY)).toBe(raw);
  });

  it("cannot restore any legacy key, discard newer changes, or acknowledge an Undo", () => {
    const records = {
      [CHANGE_HISTORY_KEY]: JSON.stringify([legacy()]),
      "run-calc-day": '{"liveCounter":42}',
      "run-calc-run-values": '{"started":{"skidsCompleted":7}}',
      "run-calc-history": '[{"completed":true}]',
      "run-calc-supervisor-pin": "SYNTHETIC_CURRENT_PIN",
      "run-calc-templates-outbox-v1:live:other": '[{"pending":"retain"}]',
      "run-calculator:operational-intent-outbox:v1:other": '[{"pending":"retain"}]',
      "run-calc-fkv-queue-v2:other": '[{"pending":"retain"}]',
      "unrelated-key": "retain",
    };
    for (const [key, value] of Object.entries(records)) localStorage.setItem(key, value);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const reads = vi.spyOn(Storage.prototype, "getItem");
    const keys = vi.spyOn(Storage.prototype, "key");
    expect(captureMasterDataSnapshot()).toEqual({});
    expect(reads).not.toHaveBeenCalled();
    expect(keys).not.toHaveBeenCalled();
    expect(undoChange("legacy-one")).toBe(false);
    expect(undoChange("unknown")).toBe(false);
    expect(() => restoreMasterDataSnapshot(legacy().before)).toThrow(/Browser rollback is disabled/);
    expect(() => saveChangeHistory([])).toThrow(/read-only/);
    expect(fetchSpy).not.toHaveBeenCalled();
    for (const [key, value] of Object.entries(records)) expect(localStorage.getItem(key), key).toBe(value);
  });

  it("records only bounded session notices, without retaining supplied snapshots or replacing legacy evidence", () => {
    const raw = JSON.stringify([legacy()]);
    localStorage.setItem(CHANGE_HISTORY_KEY, raw);
    for (let i = 0; i < MAX_CHANGE_HISTORY + 2; i++) {
      recordMasterDataChange("add", "x".repeat(1000), { "private-browser-data": "NEVER_RETAIN" });
    }
    const items = loadChangeHistory();
    expect(items).toHaveLength(MAX_CHANGE_HISTORY);
    expect(items.every((item) => item.evidence === "session-only" && item.description.length === 500)).toBe(true);
    expect(JSON.stringify(items)).not.toContain("NEVER_RETAIN");
    expect(localStorage.getItem(CHANGE_HISTORY_KEY)).toBe(raw);
    setProfileCacheIdentity({ userId: "another-manager", scope: "sandbox" });
    expect(loadChangeHistory().filter((item) => item.evidence === "session-only")).toEqual([]);
    expect(localStorage.getItem(CHANGE_HISTORY_KEY)).toBe(raw);
  });

  it.each(["{broken", "{}", JSON.stringify([null, { id: 1 }, legacy()])])(
    "surfaces malformed legacy evidence without deleting or replacing it: %s",
    (raw) => {
      localStorage.setItem(CHANGE_HISTORY_KEY, raw);
      expect(readLegacyMasterDataHistory().problem).toMatch(/retained|not been changed/);
      expect(localStorage.getItem(CHANGE_HISTORY_KEY)).toBe(raw);
    },
  );

  it("fails explicitly on oversized evidence and unavailable storage, without changing stored data", () => {
    const oversized = "x".repeat(4 * 1024 * 1024 + 1);
    localStorage.setItem(CHANGE_HISTORY_KEY, oversized);
    expect(readLegacyMasterDataHistory().problem).toMatch(/too large/);
    expect(localStorage.getItem(CHANGE_HISTORY_KEY)).toBe(oversized);
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Unavailable"); });
    expect(readLegacyMasterDataHistory()).toMatchObject({ items: [], problem: expect.stringMatching(/unavailable/) });
    get.mockRestore();
    expect(localStorage.getItem(CHANGE_HISTORY_KEY)).toBe(oversized);
  });
});
