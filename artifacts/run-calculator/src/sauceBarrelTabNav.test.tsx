// @vitest-environment jsdom
/**
 * Sauce barrel timer — tab-navigation state persistence.
 *
 * Radix UI TabsContent unmounts inactive panels. This test proves that:
 *   1. Barrel count, anchor (net-elapsed seconds), and alert latch keys survive
 *      an unmount + remount cycle (simulating a tab switch and return).
 *   2. The reset lifecycle (prevRunIdRef guard) does NOT clear the store on a
 *      same-run remount — only a genuine run-ID change triggers reset.
 *   3. A genuine run-ID change resets the store so a new run starts from zero.
 *
 * BarrelCounter is a minimal component that exercises exactly the same pattern
 * as LiveSauceTabContent, including:
 *   • useState lazy initialisers that read from the module-level store on mount
 *   • useRef initialisers that read from the store on mount
 *   • write-through setters that keep the store in sync
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
  paused?: boolean;
  runStatus?: "running" | "ended" | "pending";
}

function BarrelCounter({
  runId,
  elapsedSec = 0,
  paused = false,
  runStatus = "running",
}: BarrelCounterProps) {
  // ── Same lazy-initialiser pattern as the production component ──────────────
  const [barrelsMade, setBarrelsMadeRaw] = useState(
    () => getSauceBarrelEntry(runId).barrelsMade,
  );
  const [showBarrelDue, setShowBarrelDueRaw] = useState(
    () => getSauceBarrelEntry(runId).showBarrelDue,
  );
  const [showQuickCheck, setShowQuickCheckRaw] = useState(
    () => getSauceBarrelEntry(runId).showQuickCheck,
  );
  const [lastBarrelNetSec, setLastBarrelNetSec] = useState(
    () => getSauceBarrelEntry(runId).lastBarrelNetSec,
  );
  const lastBarrelNetSecRef = useRef<number>(
    getSauceBarrelEntry(runId).lastBarrelNetSec,
  );
  const barrelDueKeyRef = useRef<string>(
    getSauceBarrelEntry(runId).barrelDueKey,
  );
  const quickCheckKeyRef = useRef<string>(
    getSauceBarrelEntry(runId).quickCheckKey,
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
  const setShowBarrelDue = useCallback(
    (val: boolean) => {
      getSauceBarrelEntry(runId).showBarrelDue = val;
      setShowBarrelDueRaw(val);
    },
    [runId],
  );
  const setShowQuickCheck = useCallback(
    (val: boolean) => {
      getSauceBarrelEntry(runId).showQuickCheck = val;
      setShowQuickCheckRaw(val);
    },
    [runId],
  );
  const writeLastBarrel = useCallback(
    (sec: number) => {
      lastBarrelNetSecRef.current = sec;
      setLastBarrelNetSec(sec);
      getSauceBarrelEntry(runId).lastBarrelNetSec = sec;
    },
    [runId],
  );
  const writeBarrelDueKey = useCallback(
    (key: string) => {
      barrelDueKeyRef.current = key;
      getSauceBarrelEntry(runId).barrelDueKey = key;
    },
    [runId],
  );
  const writeQuickCheckKey = useCallback(
    (key: string) => {
      quickCheckKeyRef.current = key;
      getSauceBarrelEntry(runId).quickCheckKey = key;
    },
    [runId],
  );

  // ── prevRunIdRef guard — production-faithful lifecycle ─────────────────────
  // Same-run remounts preserve state; a run change hydrates that run's entry.
  const prevRunIdRef = useRef<string>(runId);
  useReactEffect(() => {
    if (prevRunIdRef.current === runId) return; // same run — tab navigation
    prevRunIdRef.current = runId;
    const entry = getSauceBarrelEntry(runId);
    setBarrelsMadeRaw(entry.barrelsMade);
    lastBarrelNetSecRef.current = entry.lastBarrelNetSec;
    setLastBarrelNetSec(entry.lastBarrelNetSec);
    setShowBarrelDueRaw(entry.showBarrelDue);
    barrelDueKeyRef.current = entry.barrelDueKey;
    quickCheckKeyRef.current = entry.quickCheckKey;
    setShowQuickCheckRaw(entry.showQuickCheck);
  }, [runId]);

  // ── Ended-run terminal clear ───────────────────────────────────────────────
  useReactEffect(() => {
    if (runStatus === "ended") {
      resetSauceBarrelEntry(runId);
      setBarrelsMadeRaw(0);
      setShowBarrelDueRaw(false);
      setShowQuickCheckRaw(false);
    }
  }, [runStatus, runId]);

  // ── Event handlers ─────────────────────────────────────────────────────────
  const onConsumeBarrel = () => {
    writeLastBarrel(elapsedSec);
    setBarrelsMade((n) => n + 1);
    setShowBarrelDue(false);
  };
  const onFireAlert = () => {
    const key = `${runId}-${barrelsMade}`;
    if (barrelDueKeyRef.current === key) return;
    writeBarrelDueKey(key);
    setShowBarrelDue(true);
  };
  const onFireQuickCheck = () => {
    const key = `${runId}-qc-1`;
    if (quickCheckKeyRef.current === key) return;
    writeQuickCheckKey(key);
    setShowQuickCheck(true);
  };
  const onDismissAlert = () => setShowBarrelDue(false);
  const onDismissQuickCheck = () => setShowQuickCheck(false);

  return (
    <div>
      <span data-testid="count">{barrelsMade}</span>
      <span data-testid="anchor">{lastBarrelNetSec}</span>
      <span data-testid="elapsed">{paused ? 0 : Math.max(0, elapsedSec - lastBarrelNetSec)}</span>
      <span data-testid="due-key">{barrelDueKeyRef.current}</span>
      <span data-testid="qc-key">{quickCheckKeyRef.current}</span>
      {showBarrelDue && <span data-testid="alert">alert</span>}
      {showQuickCheck && <span data-testid="qc">qc</span>}
      <button data-testid="consume" onClick={onConsumeBarrel}>+1 Barrel</button>
      <button data-testid="fire-alert" onClick={onFireAlert}>Fire Alert</button>
      <button data-testid="fire-qc" onClick={onFireQuickCheck}>Fire QC</button>
      <button data-testid="dismiss" onClick={onDismissAlert}>Dismiss</button>
      <button data-testid="dismiss-qc" onClick={onDismissQuickCheck}>Dismiss QC</button>
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

  it("barrel-due latch key survives tab navigation", () => {
    const { getByTestId, unmount } = render(<BarrelCounter runId="r1" />);
    fireEvent.click(getByTestId("fire-alert")); // latch = "r1-0"
    expect(getByTestId("due-key").textContent).toBe("r1-0");
    unmount();

    const { getByTestId: g2 } = render(<BarrelCounter runId="r1" />);
    expect(g2("due-key").textContent).toBe("r1-0"); // latch key survived ✓
  });

  it("quick-check latch key survives tab navigation", () => {
    const { getByTestId, unmount } = render(<BarrelCounter runId="r1" />);
    fireEvent.click(getByTestId("fire-qc"));
    expect(getByTestId("qc-key").textContent).toBe("r1-qc-1");
    unmount();

    const { getByTestId: g2 } = render(<BarrelCounter runId="r1" />);
    expect(g2("qc-key").textContent).toBe("r1-qc-1"); // key survived ✓
  });

  it("alert visibility survives tab navigation", () => {
    const { getByTestId, unmount } = render(<BarrelCounter runId="r1" />);
    fireEvent.click(getByTestId("fire-alert"));
    expect(getByTestId("alert")).toBeTruthy();
    unmount();

    const { getByTestId: g2 } = render(<BarrelCounter runId="r1" />);
    expect(g2("alert")).toBeTruthy(); // banner still showing on return ✓
  });

  it("dismissed alert stays dismissed after tab navigation", () => {
    const { getByTestId, unmount, queryByTestId } = render(
      <BarrelCounter runId="r1" />,
    );
    fireEvent.click(getByTestId("fire-alert"));
    fireEvent.click(getByTestId("dismiss")); // user dismissed
    expect(queryByTestId("alert")).toBeNull();
    unmount();

    const { queryByTestId: q2 } = render(<BarrelCounter runId="r1" />);
    expect(q2("alert")).toBeNull(); // stays dismissed ✓
  });

  it("quick-check banner survives tab navigation", () => {
    const { getByTestId, unmount } = render(<BarrelCounter runId="r1" />);
    fireEvent.click(getByTestId("fire-qc"));
    expect(getByTestId("qc")).toBeTruthy();
    unmount();

    const { getByTestId: g2 } = render(<BarrelCounter runId="r1" />);
    expect(g2("qc")).toBeTruthy(); // qc banner survived ✓
  });

  it("reset effect does NOT fire on same-run remount (prevRunIdRef guard)", () => {
    // This is the critical regression test: without the prevRunIdRef guard,
    // the [currentRunId] effect fires on every mount, wiping the store even
    // when returning to the same tab.
    const { getByTestId, unmount } = render(
      <BarrelCounter runId="r1" elapsedSec={120} />,
    );
    fireEvent.click(getByTestId("consume")); // barrelsMade=1, anchor=120
    // After consume barrelsMade=1, so alert key becomes "r1-1".
    fireEvent.click(getByTestId("fire-alert")); // latch="r1-1", showBarrelDue=true
    unmount();

    // Remount with the SAME run ID — guard must skip the reset.
    const { getByTestId: g2 } = render(
      <BarrelCounter runId="r1" elapsedSec={120} />,
    );
    // All state must be restored from the store — not wiped to zero.
    expect(g2("count").textContent).toBe("1");     // not reset to 0 ✓
    expect(g2("anchor").textContent).toBe("120");  // anchor intact ✓
    expect(g2("due-key").textContent).toBe("r1-1"); // latch intact ✓
    expect(g2("alert")).toBeTruthy();              // banner still showing ✓
  });
});

// ── Suite 2: genuine run-ID change hydrates that run's state ──────────────────

describe("sauce barrel — genuine run-ID change hydrates per-run state", () => {
  it("new run ID (while component stays mounted) starts fresh when unseen", () => {
    // Mount with run-A, consume a barrel.
    const { getByTestId, rerender } = render(
      <BarrelCounter runId="run-A" elapsedSec={20} />,
    );
    fireEvent.click(getByTestId("consume"));
    expect(getByTestId("count").textContent).toBe("1");

    // Re-render with an unseen run ID — effect should hydrate its empty entry.
    rerender(<BarrelCounter runId="run-B" elapsedSec={0} />);
    expect(getByTestId("count").textContent).toBe("0"); // reset ✓
    expect(getByTestId("anchor").textContent).toBe("0"); // anchor reset ✓
    expect(getByTestId("due-key").textContent).toBe(""); // latch cleared ✓
  });

  it("switching runs preserves each run's independent anchor", () => {
    resetSauceBarrelEntry("run-A");
    const { getByTestId, rerender } = render(
      <BarrelCounter runId="run-A" elapsedSec={30} />,
    );
    fireEvent.click(getByTestId("consume")); // run-A anchor=30
    rerender(<BarrelCounter runId="run-B" elapsedSec={0} />);
    fireEvent.click(getByTestId("consume")); // run-B anchor=0

    rerender(<BarrelCounter runId="run-A" elapsedSec={35} />);
    const entryA = getSauceBarrelEntry("run-A");
    expect(entryA.lastBarrelNetSec).toBe(30);
    expect(getByTestId("anchor").textContent).toBe("30");
    expect(getByTestId("elapsed").textContent).toBe("5");
  });

  it("new-run remount (unmount run-A, mount run-B) starts fresh when unseen", () => {
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

describe("sauce barrel — reload and pause/wake lifecycle", () => {
  it("reload restores a consumed barrel anchor and starts its elapsed time at zero", () => {
    const { getByTestId, unmount } = render(
      <BarrelCounter runId="r1" elapsedSec={42} />,
    );
    fireEvent.click(getByTestId("consume"));
    expect(getByTestId("elapsed").textContent).toBe("0");
    unmount();

    const { getByTestId: reloaded } = render(
      <BarrelCounter runId="r1" elapsedSec={42} />,
    );
    expect(reloaded("anchor").textContent).toBe("42");
    expect(reloaded("elapsed").textContent).toBe("0");
    expect(getSauceBarrelEntry("r1").lastBarrelNetSec).toBe(42);
  });

  it("pause and wake keep rendered elapsed time aligned with the persisted anchor", () => {
    const { getByTestId, rerender } = render(
      <BarrelCounter runId="r1" elapsedSec={18} />,
    );
    fireEvent.click(getByTestId("consume")); // anchor=18
    rerender(<BarrelCounter runId="r1" elapsedSec={18} paused />);
    expect(getByTestId("elapsed").textContent).toBe("0");
    expect(getSauceBarrelEntry("r1").lastBarrelNetSec).toBe(18);

    rerender(<BarrelCounter runId="r1" elapsedSec={23} />);
    expect(getByTestId("elapsed").textContent).toBe("5");
    expect(getSauceBarrelEntry("r1").lastBarrelNetSec).toBe(18);
  });
});

// ── Suite 3: ended-run terminal clear ────────────────────────────────────────

describe("sauce barrel — ended-run terminal clear", () => {
  it("runStatus='ended' clears barrel count and banners", () => {
    const { getByTestId, queryByTestId, rerender } = render(
      <BarrelCounter runId="r1" runStatus="running" />,
    );
    fireEvent.click(getByTestId("consume"));
    fireEvent.click(getByTestId("fire-alert"));
    expect(getByTestId("count").textContent).toBe("1");
    expect(getByTestId("alert")).toBeTruthy();

    rerender(<BarrelCounter runId="r1" runStatus="ended" />);
    expect(getByTestId("count").textContent).toBe("0"); // cleared ✓
    expect(queryByTestId("alert")).toBeNull();           // banner cleared ✓
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

// ── Suite 4: consuming a barrel records correct anchor and clears alert ────────

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

  it("consuming a barrel clears the nearly-exhausted banner", () => {
    const { getByTestId, queryByTestId } = render(
      <BarrelCounter runId="r1" />,
    );
    fireEvent.click(getByTestId("fire-alert"));
    expect(getByTestId("alert")).toBeTruthy();
    fireEvent.click(getByTestId("consume")); // consume clears the banner
    expect(queryByTestId("alert")).toBeNull(); // cleared ✓
    expect(getSauceBarrelEntry("r1").showBarrelDue).toBe(false);
  });
});
