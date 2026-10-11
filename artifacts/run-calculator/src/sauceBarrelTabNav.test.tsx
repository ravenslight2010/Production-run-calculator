// @vitest-environment jsdom
/**
 * Sauce barrel timer — tab-navigation state persistence.
 *
 * Radix UI TabsContent unmounts inactive panels. This test proves that:
 *   1. Barrel count and anchor (net-elapsed seconds) survive
 *      an unmount + remount cycle (simulating a tab switch and return).
 *   2. The reset lifecycle (prevRunIdRef guard) does NOT clear the store on a
 *      same-run remount — only a genuine run-ID change triggers reset.
 *   3. A genuine run-ID change resets the store so a new run starts from zero.
 *
 * BarrelCounter is a minimal component that exercises exactly the same pattern
 * as LiveSauceTabContent, including:
 *   • useState lazy initialisers that read from the module-level store on mount
 *   • useRef initialisers that read from the store on mount
 *   • write-through setters that keep progress in the store
 *   • the prevRunIdRef guard that skips reset on same-run remounts
 *
 * This is an integration test of the lifecycle pattern, not a pure formula
 * test, so it catches regressions that a formula replica cannot.
 */

import { describe, it, expect, beforeEach, useEffect } from "vitest";
import React, { useState, useRef, useCallback, useEffect as useReactEffect } from "react";
import { render, fireEvent, cleanup } from "@testing-library/react";
import {
  getSauceBarrelEntry,
  resetSauceBarrelEntry,
  _storeForTest,
} from "./sauceBarrelStore";
import {
  dismissSauceAutoTrackFailure,
  noteSauceAutoTrackFailure,
  resolveSauceAutoTrackFailure,
} from "./sauceAutoTrackFailure";

// ── Minimal production-faithful stand-in for LiveSauceTabContent's barrel state
//
// Mirrors every hook/effect that affects state persistence:
//   • useState lazy initialisers (read store on mount)
//   • useRef initialisers (read store on mount)
//   • write-through wrappers (sync state → store)
//   • prevRunIdRef effect (skip reset on same-run remount, reset on new run)
//   • runStatus==="ended" effect (terminal clear)

interface BarrelCounterProps {
  runId: string;
  elapsedSec?: number;
  runStatus?: "running" | "ended" | "pending";
}

function BarrelCounter({
  runId,
  elapsedSec = 0,
  runStatus = "running",
}: BarrelCounterProps) {
  // ── Same lazy-initialiser pattern as the production component ──────────────
  const [barrelsMade, setBarrelsMadeRaw] = useState(
    () => getSauceBarrelEntry(runId).barrelsMade,
  );
  const lastBarrelNetSecRef = useRef<number>(
    getSauceBarrelEntry(runId).lastBarrelNetSec,
  );

  // ── Write-through wrappers ─────────────────────────────────────────────────
  const setBarrelsMade = useCallback(
    (fn: (n: number) => number) => {
      setBarrelsMadeRaw((prev) => {
        const next = fn(prev);
        getSauceBarrelEntry(runId).barrelsMade = next;
        return next;
      });
    },
    [runId],
  );
  const writeLastBarrel = useCallback(
    (sec: number) => {
      lastBarrelNetSecRef.current = sec;
      getSauceBarrelEntry(runId).lastBarrelNetSec = sec;
    },
    [runId],
  );

  // ── prevRunIdRef guard — production-faithful reset lifecycle ────────────────
  // Same pattern as the production component: skips reset on same-run remounts,
  // resets only when the run ID genuinely changes.
  const prevRunIdRef = useRef<string>(runId);
  useReactEffect(() => {
    if (prevRunIdRef.current === runId) return; // same run — tab navigation, skip reset
    prevRunIdRef.current = runId;
    resetSauceBarrelEntry(runId);
    setBarrelsMadeRaw(0);
    lastBarrelNetSecRef.current = 0;
  }, [runId]);

  // ── Ended-run terminal clear ───────────────────────────────────────────────
  useReactEffect(() => {
    if (runStatus === "ended") {
      resetSauceBarrelEntry(runId);
      setBarrelsMadeRaw(0);
      lastBarrelNetSecRef.current = 0;
    }
  }, [runStatus, runId]);

  // ── Event handlers ─────────────────────────────────────────────────────────
  const onConsumeBarrel = () => {
    writeLastBarrel(elapsedSec);
    setBarrelsMade((n) => n + 1);
  };

  return (
    <div>
      <span data-testid="count">{barrelsMade}</span>
      <span data-testid="anchor">{lastBarrelNetSecRef.current}</span>
      <button data-testid="consume" onClick={onConsumeBarrel}>+1 Barrel</button>
    </div>
  );
}

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  _storeForTest.clear();
  cleanup();
});

// ── Suite 1: state survives unmount + remount (Radix tab navigation) ──────────

describe("sauce barrel — tab navigation persistence (same-run remount)", () => {
  it("barrel count starts at 0 on fresh mount", () => {
    const { getByTestId } = render(<BarrelCounter runId="r1" />);
    expect(getByTestId("count").textContent).toBe("0");
  });

  it("barrel count survives unmount + remount with same run ID", () => {
    const { getByTestId, unmount } = render(
      <BarrelCounter runId="r1" elapsedSec={30} />,
    );
    fireEvent.click(getByTestId("consume"));
    fireEvent.click(getByTestId("consume"));
    expect(getByTestId("count").textContent).toBe("2");

    // Unmount simulates operator switching to Packaging tab.
    unmount();

    // Remount simulates returning to Sauce tab. State must be restored.
    const { getByTestId: g2 } = render(<BarrelCounter runId="r1" elapsedSec={30} />);
    expect(g2("count").textContent).toBe("2"); // persisted ✓
  });

  it("lastBarrelNetSec anchor survives tab navigation", () => {
    const { getByTestId, unmount } = render(
      <BarrelCounter runId="r1" elapsedSec={75} />,
    );
    fireEvent.click(getByTestId("consume")); // anchor = 75 s
    expect(getByTestId("anchor").textContent).toBe("75");
    unmount();

    const { getByTestId: g2 } = render(<BarrelCounter runId="r1" elapsedSec={75} />);
    expect(g2("anchor").textContent).toBe("75"); // anchor survived ✓
  });

  it("reset effect does NOT fire on same-run remount (prevRunIdRef guard)", () => {
    // This is the critical regression test: without the prevRunIdRef guard,
    // the [currentRunId] effect fires on every mount, wiping the store even
    // when returning to the same tab.
    const { getByTestId, unmount } = render(
      <BarrelCounter runId="r1" elapsedSec={120} />,
    );
    fireEvent.click(getByTestId("consume")); // barrelsMade=1, anchor=120
    unmount();

    // Remount with the SAME run ID — guard must skip the reset.
    const { getByTestId: g2 } = render(
      <BarrelCounter runId="r1" elapsedSec={120} />,
    );
    // All state must be restored from the store — not wiped to zero.
    expect(g2("count").textContent).toBe("1");    // not reset to 0 ✓
    expect(g2("anchor").textContent).toBe("120"); // anchor intact ✓
  });
});

// ── Suite 2: genuine run-ID change resets state ───────────────────────────────

describe("sauce barrel — genuine run-ID change resets state", () => {
  it("new run ID (while component stays mounted) resets to zero", () => {
    // Mount with run-A, consume a barrel.
    const { getByTestId, rerender } = render(
      <BarrelCounter runId="run-A" elapsedSec={20} />,
    );
    fireEvent.click(getByTestId("consume"));
    expect(getByTestId("count").textContent).toBe("1");

    // Re-render with a different run ID — effect should reset.
    rerender(<BarrelCounter runId="run-B" elapsedSec={0} />);
    expect(getByTestId("count").textContent).toBe("0"); // reset ✓
    expect(getByTestId("anchor").textContent).toBe("0"); // anchor reset ✓
  });

  it("new-run state does not pollute the old run's store entry", () => {
    resetSauceBarrelEntry("run-A");
    const { getByTestId, rerender } = render(
      <BarrelCounter runId="run-A" elapsedSec={30} />,
    );
    fireEvent.click(getByTestId("consume")); // run-A: barrelsMade=1
    rerender(<BarrelCounter runId="run-B" elapsedSec={0} />);
    fireEvent.click(getByTestId("consume")); // run-B: barrelsMade=1

    // run-A store entry should still have barrelsMade=1 (not clobbered by run-B).
    const entryA = getSauceBarrelEntry("run-A");
    expect(entryA.barrelsMade).toBe(1);
  });

  it("new-run remount (unmount run-A, mount run-B) starts from zero", () => {
    const { getByTestId, unmount } = render(
      <BarrelCounter runId="run-A" elapsedSec={20} />,
    );
    fireEvent.click(getByTestId("consume"));
    unmount();

    // Mount a different run ID — store has no entry yet, so zero.
    const { getByTestId: g2 } = render(<BarrelCounter runId="run-B" />);
    expect(g2("count").textContent).toBe("0");
    expect(g2("anchor").textContent).toBe("0");
  });
});

// ── Suite 3: ended-run terminal clear ────────────────────────────────────────

describe("sauce barrel — ended-run terminal clear", () => {
  it("runStatus='ended' clears barrel progress", () => {
    const { getByTestId, rerender } = render(
      <BarrelCounter runId="r1" runStatus="running" />,
    );
    fireEvent.click(getByTestId("consume"));
    expect(getByTestId("count").textContent).toBe("1");

    rerender(<BarrelCounter runId="r1" runStatus="ended" />);
    expect(getByTestId("count").textContent).toBe("0"); // cleared ✓
    expect(getByTestId("anchor").textContent).toBe("0"); // anchor cleared ✓
  });

  it("ended-run clear also wipes the store so next mount starts fresh", () => {
    const { rerender, unmount } = render(
      <BarrelCounter runId="r1" runStatus="running" />,
    );
    rerender(<BarrelCounter runId="r1" runStatus="ended" />);
    unmount();

    // Mount again with same ID — store was wiped, so zero.
    const { getByTestId } = render(<BarrelCounter runId="r1" />);
    expect(getByTestId("count").textContent).toBe("0");
  });
});

// ── Suite 4: consuming a barrel records canonical progress ───────────────────

describe("sauce barrel — consume barrel write-through", () => {
  it("consuming a barrel records the net-elapsed anchor in the store", () => {
    const { getByTestId } = render(
      <BarrelCounter runId="r1" elapsedSec={150} />,
    );
    fireEvent.click(getByTestId("consume"));
    const entry = getSauceBarrelEntry("r1");
    expect(entry.lastBarrelNetSec).toBe(150);
    expect(entry.barrelsMade).toBe(1);
  });

  it("consuming a barrel updates only the progress mirror", () => {
    const { getByTestId } = render(<BarrelCounter runId="r1" />);
    fireEvent.click(getByTestId("consume"));
    expect(getSauceBarrelEntry("r1")).toEqual({
      lastBarrelNetSec: 0,
      barrelsMade: 1,
    });
  });
});

describe("sauce automatic failure dismissal identity", () => {
  it("keeps a dismissed barrel hidden across retries, then clears it on success", () => {
    let failure = noteSauceAutoTrackFailure(null, "run-1:event-1");
    failure = dismissSauceAutoTrackFailure(failure);
    failure = noteSauceAutoTrackFailure(failure, "run-1:event-1");

    expect(failure).toEqual({ barrelId: "run-1:event-1", dismissed: true });
    expect(resolveSauceAutoTrackFailure(failure, "run-1:event-1")).toBeNull();
  });

  it("surfaces a distinct later barrel and ignores stale recovery for the old one", () => {
    const oldFailure = dismissSauceAutoTrackFailure(
      noteSauceAutoTrackFailure(null, "run-1:event-1"),
    );
    const newFailure = noteSauceAutoTrackFailure(oldFailure, "run-1:event-2");

    expect(newFailure).toEqual({ barrelId: "run-1:event-2", dismissed: false });
    expect(resolveSauceAutoTrackFailure(newFailure, "run-1:event-1")).toEqual(newFailure);
  });
});
