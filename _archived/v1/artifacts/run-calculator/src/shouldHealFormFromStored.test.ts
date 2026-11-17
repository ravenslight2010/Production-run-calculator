// @vitest-environment node
//
// Regression guard for the "form shows 0 cases after sign-in" bug. On a fresh
// device right after sign-in the app auto-selects run 0 before synced values
// arrive; the sync-apply form-reset block compares against the PRE-apply
// dayStateRef — whose blank local run id isn't in the payload — so it skips the
// reset, leaving the live form all-default ("0 cases needed") even though
// localStorage now holds the real synced values. The server sends only ONE
// initial SSE payload on connect, so nothing later heals it.
//
// The fix is a heal effect on currentRunId in home.tsx whose pure decision is
// shouldHealFormFromStored (storage.ts): reset the form to the stored copy ONLY
// when the live form is all-default over a populated stored value (the same
// isEmptyOverPopulated guard the sync receive path uses) AND no local edit
// landed within the recent-edit window. Anything looser re-introduces the
// empty-over-populated clobber class of bugs; anything tighter regresses the
// original "0 cases after sign-in" symptom. This asserts both boundaries.

import { describe, it, expect } from "vitest";
import {
  shouldHealFormFromStored,
  isEmptyOverPopulated,
  RECENT_LOCAL_EDIT_WINDOW_MS,
} from "./storage";
import { DEFAULT_VALUES, type FormValues } from "./types";

const populated = (): FormValues => ({
  ...DEFAULT_VALUES,
  casesNeeded: 240,
  dieType: "10in",
});

const NOW = 1_000_000_000;
// A "long ago" edit stamp — comfortably outside the quiet window.
const LONG_AGO = NOW - RECENT_LOCAL_EDIT_WINDOW_MS * 10;

describe("shouldHealFormFromStored", () => {
  it("heals the fresh-device first-sync case: all-default live form, populated stored, no recent edit", () => {
    // This IS the "0 cases needed after sign-in" bug: if this returns false the
    // regression ships.
    expect(
      shouldHealFormFromStored({ ...DEFAULT_VALUES }, populated(), LONG_AGO, NOW),
    ).toBe(true);
  });

  it("never touches a form that already has real data (heal is one-directional)", () => {
    const live = { ...DEFAULT_VALUES, casesNeeded: 999 };
    expect(shouldHealFormFromStored(live, populated(), LONG_AGO, NOW)).toBe(false);
  });

  it("never heals a legitimately blank run (stored is also all-default)", () => {
    expect(
      shouldHealFormFromStored(
        { ...DEFAULT_VALUES },
        { ...DEFAULT_VALUES },
        LONG_AGO,
        NOW,
      ),
    ).toBe(false);
  });

  it("suppresses the heal when a local edit landed inside the quiet window (typing wins)", () => {
    // The operator just typed something; a form.reset here could clobber the
    // keystroke before autosave persists it.
    const justNow = NOW - 1;
    expect(
      shouldHealFormFromStored({ ...DEFAULT_VALUES }, populated(), justNow, NOW),
    ).toBe(false);
  });

  it("suppresses the heal exactly AT the window boundary (strictly-greater semantics)", () => {
    const atBoundary = NOW - RECENT_LOCAL_EDIT_WINDOW_MS;
    expect(
      shouldHealFormFromStored({ ...DEFAULT_VALUES }, populated(), atBoundary, NOW),
    ).toBe(false);
  });

  it("heals once the quiet window has elapsed (window + 1ms)", () => {
    const pastBoundary = NOW - RECENT_LOCAL_EDIT_WINDOW_MS - 1;
    expect(
      shouldHealFormFromStored({ ...DEFAULT_VALUES }, populated(), pastBoundary, NOW),
    ).toBe(true);
  });

  it("heals when no local edit has ever happened (ref initialized to 0)", () => {
    // home.tsx initializes lastLocalEditRef to 0 — the common fresh-sign-in state.
    expect(
      shouldHealFormFromStored({ ...DEFAULT_VALUES }, populated(), 0, NOW),
    ).toBe(true);
  });

  it("uses the same emptiness predicate as the sync receive path (isEmptyOverPopulated)", () => {
    // Lock the coupling: the heal must fire exactly when isEmptyOverPopulated
    // does (given a quiet window), so the receive-side and heal-side guards
    // can't drift apart.
    const cases: Array<[FormValues, FormValues]> = [
      [{ ...DEFAULT_VALUES }, populated()],
      [populated(), populated()],
      [{ ...DEFAULT_VALUES }, { ...DEFAULT_VALUES }],
      [populated(), { ...DEFAULT_VALUES }],
    ];
    for (const [live, stored] of cases) {
      expect(shouldHealFormFromStored(live, stored, LONG_AGO, NOW)).toBe(
        isEmptyOverPopulated(live, stored),
      );
    }
  });
});
