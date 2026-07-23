// ── Manual mock for ../../hooks/useAutoTrack ──────────────────────────────────
//
// PURPOSE
// -------
// This file is the SINGLE authoritative source of truth for the useAutoTrack
// mock used across all test files that exercise LiveRunProvider.  Placing it
// here (src/hooks/__mocks__/useAutoTrack.ts) lets every test file activate it
// with a no-factory vi.mock() call:
//
//   vi.mock("../../hooks/useAutoTrack");
//
// Vitest resolves the __mocks__ sibling automatically.
//
// STRUCTURAL GUARANTEE
// --------------------
// All refs and functions are allocated ONCE at module scope, outside the
// useAutoTrack hook body.  Every call to useAutoTrack() returns the SAME
// object/function references.  This is mandatory because LiveRunProvider builds
// its `value` with a useMemo whose deps include the fields returned by
// useAutoTrack().  Inline allocations (vi.fn() or { current: 0 } written
// INSIDE the return body) produce a new reference on every render call, making
// the useMemo deps unstable, defeating memo()-based isolation, and silently
// freezing TickBar animation.
//
// EXTERNAL TICK REFS (for TickBar.animation.test.tsx)
// ---------------------------------------------------
// TickBar tests need to MUTATE the tickDueRefs slots from beforeEach so the
// probe component sees armed timestamps.  Import `mockAutoTrackTickRefs` from
// this file directly and mutate it — those mutations are visible through the
// tickDueRefs returned by useAutoTrack() because it is the same object.
//
//   import { mockAutoTrackTickRefs } from "../../hooks/__mocks__/useAutoTrack";
//
//   beforeEach(() => {
//     mockAutoTrackTickRefs.tray.current = Date.now() + 36_000;
//   });

import { vi } from "vitest";

// ── Module-scope allocations (stable refs across every useAutoTrack() call) ───

/** Exported so TickBar.animation.test.tsx can mutate slots in beforeEach. */
export const mockAutoTrackTickRefs = {
  case:      { current: 0 as number },
  tray:      { current: 0 as number },
  trayProd:  { current: 0 as number },
  batch:     { current: 0 as number },
  batchProd: { current: 0 as number },
};

const setAutoTrackProgress = vi.fn();
const autoSuppressUntilRef = { current: 0 as number };
const fireAutoTrackNow     = vi.fn();

// ── Mock hook ────────────────────────────────────────────────────────────────

export function useAutoTrack() {
  return {
    autoTrackProgress:    false,
    setAutoTrackProgress,
    autoTrackSuggestion:  null,
    autoSuppressUntilRef,
    fireAutoTrackNow,
    tickDueRefs:          mockAutoTrackTickRefs,
  };
}

export function suggestedDoughStaging() {
  return { trays: null, batches: null };
}
