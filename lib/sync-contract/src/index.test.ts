import { describe, expect, it } from "vitest";
import {
  SYNC_DELTA_MAP_SECTIONS,
  applySyncDeltaData,
  buildSyncDeltaData,
} from "./index";

describe("sync delta shape contract", () => {
  it.each(SYNC_DELTA_MAP_SECTIONS)(
    "builds and applies sparse changes and tombstones for %s",
    (section) => {
      const before = {
        dayState: { date: "2026-09-17", runs: [] },
        [section]: { changed: { value: 1 }, removed: { value: 2 }, kept: { value: 3 } },
      };
      const after = {
        dayState: before.dayState,
        [section]: { changed: { value: 4 }, added: { value: 5 }, kept: { value: 3 } },
      };
      const delta = buildSyncDeltaData(before, after);

      expect(delta[section]).toEqual({
        changed: { value: 4 },
        removed: null,
        added: { value: 5 },
      });
      expect(applySyncDeltaData(before, delta)).toEqual(after);
    },
  );

  it("replaces non-map sections and applies top-level tombstones", () => {
    const before = {
      dayState: { date: "2026-09-17", runs: [{ id: "old" }] },
      history: [{ id: "old" }],
      removedSection: { stale: true },
    };
    const after = {
      dayState: { date: "2026-09-17", runs: [{ id: "new" }] },
      history: [{ id: "new" }],
    };
    const delta = buildSyncDeltaData(before, after);

    expect(delta).toEqual({
      dayState: after.dayState,
      history: after.history,
      removedSection: null,
    });
    expect(applySyncDeltaData(before, delta)).toEqual(after);
  });
});