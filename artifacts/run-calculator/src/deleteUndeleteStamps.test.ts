// @vitest-environment jsdom
//
// Regression guard for the "re-imported flavor doesn't show up anywhere" bug.
// deletedItems tombstones sync via a pure union, so a deliberate RE-ADD of a
// once-deleted name (a spec import calling clearDeleted + re-registering the
// flavor) used to be resurrected as "deleted" by the very next sync pull:
// unionDeletedItems merged the server's tombstone back in and dropDeleted
// stripped the flavor out of the pickers, while the imported profile sat
// orphaned on the server. Per-name delete/un-delete stamps now arbitrate:
// an un-delete stamped AFTER the delete wins the compare (legacy tombstones
// with no stamp count as 0), and a later re-delete stamps newer and wins again.

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  tombstoneDeleted,
  clearDeleted,
  loadDeletedItems,
  unionDeletedItems,
  dropDeleted,
  loadDeletedStamps,
  loadUndeletedStamps,
  mergeStampMaps,
  flavorNamespace,
} from "./storage";

const NS = flavorNamespace("Lucia's Craft");

describe("delete/un-delete stamps", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.useRealTimers());

  it("legacy tombstone (no stamp) is dropped normally", () => {
    // Simulate a synced legacy tombstone arriving with no local delete stamp.
    const map = unionDeletedItems({}, { [NS]: ["house special"] });
    expect(dropDeleted(["House Special", "Supreme"], map, NS)).toEqual(["Supreme"]);
  });

  it("un-delete beats a legacy (unstamped) synced tombstone", () => {
    // Device never held the tombstone locally — clearDeleted must still stamp.
    clearDeleted(NS, "House Special");
    // Next sync pull unions the server tombstone back in…
    const map = unionDeletedItems(loadDeletedItems(), { [NS]: ["house special"] });
    // …but the un-delete stamp wins, so the flavor survives.
    expect(dropDeleted(["House Special"], map, NS)).toEqual(["House Special"]);
  });

  it("a later re-delete beats an earlier un-delete", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    clearDeleted(NS, "House Special");
    vi.setSystemTime(2_000_000);
    tombstoneDeleted(NS, "House Special");
    const map = unionDeletedItems(loadDeletedItems(), undefined);
    expect(dropDeleted(["House Special"], map, NS)).toEqual([]);
  });

  it("a later un-delete beats an earlier stamped delete", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    tombstoneDeleted(NS, "House Special");
    vi.setSystemTime(2_000_000);
    clearDeleted(NS, "House Special");
    // Tombstone comes back from a peer's union…
    const map = unionDeletedItems(loadDeletedItems(), { [NS]: ["house special"] });
    expect(dropDeleted(["House Special"], map, NS)).toEqual(["House Special"]);
  });

  it("un-delete only shields its own namespace/name", () => {
    clearDeleted(NS, "House Special");
    const map = unionDeletedItems({}, {
      [NS]: ["house special", "supreme"],
      brands: ["house special"],
    });
    expect(dropDeleted(["House Special", "Supreme"], map, NS)).toEqual(["House Special"]);
    expect(dropDeleted(["House Special"], map, "brands")).toEqual([]);
  });

  it("mergeStampMaps takes the per-name max and tolerates junk", () => {
    const merged = mergeStampMaps(
      { [NS]: { "house special": 5 } },
      { [NS]: { "house special": 9, supreme: 3 }, junk: { bad: "x" as unknown as number } },
    );
    expect(merged[NS]["house special"]).toBe(9);
    expect(merged[NS]["supreme"]).toBe(3);
    expect(merged.junk).toEqual({});
  });

  it("stamps persist through load/save round-trip", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_234);
    tombstoneDeleted(NS, "X");
    clearDeleted(NS, "Y");
    expect(loadDeletedStamps()[NS]["x"]).toBe(1_234);
    expect(loadUndeletedStamps()[NS]["y"]).toBe(1_234);
  });
});
