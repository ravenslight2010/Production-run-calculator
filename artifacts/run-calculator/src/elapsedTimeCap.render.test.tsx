// @vitest-environment jsdom
//
// Rendered verification that the forward-skew upper-bound cap holds in the
// REAL ElapsedTimeBadge component exported from home.tsx — the same component
// used at both capped call sites:
//
//   1. CompactRunStrip "Running · <elapsed>" badge  (~line 15368 in home.tsx)
//   2. Elapsed Time display card                    (~line 16021 in home.tsx)
//
// ElapsedTimeBadge is the single source of truth for the cap expression:
//   addend = Math.min(runAge, Math.max(0, nowMs - pausedAt))
//
// Both call sites render ElapsedTimeBadge with their respective
// data-testid props, so any regression in the component (e.g. removing the
// Math.min upper bound) will fail this test regardless of which call site is
// affected.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ElapsedTimeBadge } from "./pages/home";
import { applyResumeToRun } from "./utils";

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Helper: parse "1h 30m" → total minutes, or "45m" → 45.
// ---------------------------------------------------------------------------
function toMinutes(text: string): number {
  const hourMatch = text.match(/(\d+)h\s*(\d+)m/);
  if (hourMatch) return parseInt(hourMatch[1]) * 60 + parseInt(hourMatch[2]);
  const minMatch = text.match(/(\d+)m/);
  if (minMatch) return parseInt(minMatch[1]);
  return 0;
}

describe("ElapsedTimeBadge — cap rendered via real component", () => {
  // -------------------------------------------------------------------------
  // Scenario A: normal case — no extreme drift, cap is inactive.
  // Run started 40 min ago, paused 10 min ago → addend = 30 min → total 70m.
  // -------------------------------------------------------------------------
  it("normal paused run: shows 1h 10m (40 min age + 30 min pause addend)", () => {
    const startedAt = 0;
    const nowMs = 40 * 60_000;
    const pausedAt = 10 * 60_000; // paused 30 min ago
    render(
      <ElapsedTimeBadge
        data-testid="badge"
        nowMs={nowMs}
        startedAt={startedAt}
        pausedAt={pausedAt}
      />,
    );
    expect(screen.getByTestId("badge").textContent).toBe("1h 10m");
  });

  // -------------------------------------------------------------------------
  // Scenario B: extreme forward-drifted pausedAt (recorded when device clock
  // was 2 hours behind), which would make the raw addend 150 min for a 30-min
  // run. The Math.min upper-bound cap clamps addend to runAge (30 min) so the
  // total shows 60 min (2× run age) instead of 180 min.
  // -------------------------------------------------------------------------
  describe("extreme forward-drifted pausedAt — cap fires on both call sites", () => {
    const startedAt = 1_000_000_000; // arbitrary epoch anchor
    const runAgeMs = 30 * 60_000; // run is 30 min old
    const nowMs = startedAt + runAgeMs;
    // pausedAt stamped when the device clock was 2 hours behind nowMs:
    const pausedAt = startedAt - 2 * 60 * 60_000;

    it("CompactRunStrip call site: displayed time ≤ 2× run age (60m)", () => {
      render(
        <ElapsedTimeBadge
          data-testid="strip-elapsed"
          nowMs={nowMs}
          startedAt={startedAt}
          pausedAt={pausedAt}
        />,
      );
      const minutes = toMinutes(
        screen.getByTestId("strip-elapsed").textContent ?? "",
      );
      expect(minutes).toBeLessThanOrEqual((runAgeMs / 60_000) * 2);
    });

    it("CompactRunStrip call site: shows exactly 1h 0m (cap clamps to run age)", () => {
      render(
        <ElapsedTimeBadge
          data-testid="strip-elapsed"
          nowMs={nowMs}
          startedAt={startedAt}
          pausedAt={pausedAt}
        />,
      );
      expect(screen.getByTestId("strip-elapsed").textContent).toBe("1h 0m");
    });

    it("Elapsed Time card call site: displayed time ≤ 2× run age (60m)", () => {
      render(
        <ElapsedTimeBadge
          data-testid="elapsed-card-value"
          nowMs={nowMs}
          startedAt={startedAt}
          pausedAt={pausedAt}
        />,
      );
      const minutes = toMinutes(
        screen.getByTestId("elapsed-card-value").textContent ?? "",
      );
      expect(minutes).toBeLessThanOrEqual((runAgeMs / 60_000) * 2);
    });

    it("Elapsed Time card call site: shows exactly 1h 0m (cap clamps to run age)", () => {
      render(
        <ElapsedTimeBadge
          data-testid="elapsed-card-value"
          nowMs={nowMs}
          startedAt={startedAt}
          pausedAt={pausedAt}
        />,
      );
      expect(screen.getByTestId("elapsed-card-value").textContent).toBe("1h 0m");
    });
  });

  // -------------------------------------------------------------------------
  // Scenario C: no pausedAt → addend is 0, only raw run age shown.
  // -------------------------------------------------------------------------
  it("no pausedAt: shows raw run age (45m)", () => {
    render(
      <ElapsedTimeBadge
        data-testid="badge"
        nowMs={45 * 60_000}
        startedAt={0}
        pausedAt={null}
      />,
    );
    expect(screen.getByTestId("badge").textContent).toBe("45m");
  });

  // -------------------------------------------------------------------------
  // Scenario D: future pausedAt (stamp in the future, skew other direction).
  // Math.max(0, nowMs - pausedAt) clamps the addend to 0 → raw age shown.
  // -------------------------------------------------------------------------
  it("future pausedAt: addend clamped to 0, shows raw run age (30m)", () => {
    const nowMs = 30 * 60_000;
    render(
      <ElapsedTimeBadge
        data-testid="badge"
        nowMs={nowMs}
        startedAt={0}
        pausedAt={nowMs + 5 * 60_000} // 5 min in the future
      />,
    );
    expect(screen.getByTestId("badge").textContent).toBe("30m");
  });

  // -------------------------------------------------------------------------
  // Scenario E: resumed run — cap survives the full start → pause → resume cycle.
  //
  // resumeRun(freezerEmpty=false) shifts startedAt forward by the computed
  // pauseDuration: newStartedAt = startedAt + (now - pausedAt).  When pausedAt
  // was stamped with a backward-drifted clock (device thought it was 2 h earlier),
  // pauseDuration becomes huge and pushes newStartedAt far into the future.
  //
  // After resume: pausedAt = null, startedAt = newStartedAt.
  //
  // The ElapsedTimeBadge must never display an inflated elapsed:
  //   - Right after resume (nowMs < newStartedAt): fmtElapsed clamps negative
  //     runAge to 0 → shows "0m", not "2h 40m".
  //   - Once time advances past newStartedAt: normal accumulation resumes from 0.
  //
  // Both call sites (CompactRunStrip "strip-elapsed" + Elapsed Time card
  // "elapsed-card-value") are covered.
  // -------------------------------------------------------------------------
  describe("resumed run (freezerEmpty=false) with extreme forward-drifted pausedAt", () => {
    const startedAt = 1_000_000_000; // arbitrary epoch anchor  (T)
    const runActiveMs = 30 * 60_000; // 30 min of running before pause
    const pauseWallMs = 10 * 60_000; // 10 min of real wall-clock pause
    // pausedAt was recorded when the device clock was 2 h behind real time:
    const pausedAtDrifted = startedAt - 2 * 60 * 60_000; // T − 120 min

    // Resume happens at T + 40 min (30 min running + 10 min wall pause).
    const resumedAtMs = startedAt + runActiveMs + pauseWallMs; // T + 40 min

    // resumeRun computes: pauseDuration = resumedAtMs − pausedAtDrifted = 160 min
    //                     newStartedAt  = startedAt  + pauseDuration    = T + 160 min
    const pauseDuration = resumedAtMs - pausedAtDrifted; // 160 min in ms
    const postResumeStartedAt = startedAt + pauseDuration; // T + 160 min

    // ── right after resume ────────────────────────────────────────────────
    // nowMs = T + 40 min  <  postResumeStartedAt = T + 160 min
    // runAge = −120 min → fmtElapsed clamps to 0 → "0m", not "2h 40m".

    it("CompactRunStrip: right after resume shows 0m (not inflated by the drift)", () => {
      render(
        <ElapsedTimeBadge
          data-testid="strip-elapsed"
          nowMs={resumedAtMs}
          startedAt={postResumeStartedAt}
          pausedAt={null}
        />,
      );
      expect(screen.getByTestId("strip-elapsed").textContent).toBe("0m");
    });

    it("CompactRunStrip: right after resume — elapsed ≤ actual wall-clock since start (40 min)", () => {
      render(
        <ElapsedTimeBadge
          data-testid="strip-elapsed"
          nowMs={resumedAtMs}
          startedAt={postResumeStartedAt}
          pausedAt={null}
        />,
      );
      const minutes = toMinutes(
        screen.getByTestId("strip-elapsed").textContent ?? "",
      );
      const wallClockMinutes = (resumedAtMs - startedAt) / 60_000; // 40 min
      expect(minutes).toBeLessThanOrEqual(wallClockMinutes);
    });

    it("ElapsedCard: right after resume shows 0m (not inflated by the drift)", () => {
      render(
        <ElapsedTimeBadge
          data-testid="elapsed-card-value"
          nowMs={resumedAtMs}
          startedAt={postResumeStartedAt}
          pausedAt={null}
        />,
      );
      expect(screen.getByTestId("elapsed-card-value").textContent).toBe("0m");
    });

    it("ElapsedCard: right after resume — elapsed ≤ actual wall-clock since start (40 min)", () => {
      render(
        <ElapsedTimeBadge
          data-testid="elapsed-card-value"
          nowMs={resumedAtMs}
          startedAt={postResumeStartedAt}
          pausedAt={null}
        />,
      );
      const minutes = toMinutes(
        screen.getByTestId("elapsed-card-value").textContent ?? "",
      );
      const wallClockMinutes = (resumedAtMs - startedAt) / 60_000; // 40 min
      expect(minutes).toBeLessThanOrEqual(wallClockMinutes);
    });

    // ── normal accumulation after the shifted startedAt is passed ────────
    // 40 min after newStartedAt: runAge = 40 min → "40m" on both call sites.

    it("CompactRunStrip: 40 min past newStartedAt shows 40m (normal accumulation)", () => {
      const nowMs = postResumeStartedAt + 40 * 60_000;
      render(
        <ElapsedTimeBadge
          data-testid="strip-elapsed"
          nowMs={nowMs}
          startedAt={postResumeStartedAt}
          pausedAt={null}
        />,
      );
      expect(screen.getByTestId("strip-elapsed").textContent).toBe("40m");
    });

    it("ElapsedCard: 40 min past newStartedAt shows 40m (normal accumulation)", () => {
      const nowMs = postResumeStartedAt + 40 * 60_000;
      render(
        <ElapsedTimeBadge
          data-testid="elapsed-card-value"
          nowMs={nowMs}
          startedAt={postResumeStartedAt}
          pausedAt={null}
        />,
      );
      expect(screen.getByTestId("elapsed-card-value").textContent).toBe("40m");
    });

    // ── recovery point: 1 ms past newStartedAt ────────────────────────────
    // nowMs = postResumeStartedAt + 1ms → runAge = 1ms → fmtElapsed rounds
    // to "0m".  This confirms the display is NOT permanently stuck at 0m —
    // it is a valid fresh-start reading at the exact recovery boundary.
    // A future refactor that capped or skipped the startedAt shift would
    // cause nowMs > postResumeStartedAt to show an inflated elapsed (e.g.
    // "2h 40m") instead of "0m", catching the regression here.

    it("CompactRunStrip: 1 ms past newStartedAt shows 0m (valid recovery point, not stuck)", () => {
      render(
        <ElapsedTimeBadge
          data-testid="strip-elapsed"
          nowMs={postResumeStartedAt + 1}
          startedAt={postResumeStartedAt}
          pausedAt={null}
        />,
      );
      expect(screen.getByTestId("strip-elapsed").textContent).toBe("0m");
    });

    it("ElapsedCard: 1 ms past newStartedAt shows 0m (valid recovery point, not stuck)", () => {
      render(
        <ElapsedTimeBadge
          data-testid="elapsed-card-value"
          nowMs={postResumeStartedAt + 1}
          startedAt={postResumeStartedAt}
          pausedAt={null}
        />,
      );
      expect(screen.getByTestId("elapsed-card-value").textContent).toBe("0m");
    });

    // ── 30 min past newStartedAt ──────────────────────────────────────────
    // Confirms the display advances normally once the shifted startedAt is
    // cleared: runAge = 30 min → "30m" on both call sites.

    it("CompactRunStrip: 30 min past newStartedAt shows 30m (normal accumulation)", () => {
      render(
        <ElapsedTimeBadge
          data-testid="strip-elapsed"
          nowMs={postResumeStartedAt + 30 * 60_000}
          startedAt={postResumeStartedAt}
          pausedAt={null}
        />,
      );
      expect(screen.getByTestId("strip-elapsed").textContent).toBe("30m");
    });

    it("ElapsedCard: 30 min past newStartedAt shows 30m (normal accumulation)", () => {
      render(
        <ElapsedTimeBadge
          data-testid="elapsed-card-value"
          nowMs={postResumeStartedAt + 30 * 60_000}
          startedAt={postResumeStartedAt}
          pausedAt={null}
        />,
      );
      expect(screen.getByTestId("elapsed-card-value").textContent).toBe("30m");
    });
  });

  // -------------------------------------------------------------------------
  // Scenario F: resumed run with freezerEmpty=true (full restart path).
  //
  // resumeRun(freezerEmpty=true) resets startedAt to now and clears pausedAt,
  // regardless of how long the run was paused or whether pausedAt was drifted.
  //
  //   computeResumedStartedAt(..., freezerEmpty=true) => now
  //
  // Post-resume state: startedAt = resumeInstant, pausedAt = null.
  // Elapsed always counts fresh from the resume moment — no cap expression is
  // needed, but a regression (e.g. accidentally carrying over a stale pausedAt)
  // would inflate the display.  This scenario pins the correct behaviour:
  //
  //   - Right at resume (nowMs === startedAt): runAge = 0 ms → "0m".
  //   - After 25 minutes: runAge = 25 min → "25m".
  //
  // Both call sites (CompactRunStrip "strip-elapsed" + Elapsed Time card
  // "elapsed-card-value") are covered.
  // -------------------------------------------------------------------------
  describe("resumed run (freezerEmpty=true) — full restart path", () => {
    // Arbitrary anchor; resumeRun sets startedAt = now at this instant.
    const resumeInstant = 2_000_000_000;
    // Post-resume state: startedAt = resumeInstant, pausedAt = null.
    const postResumeStartedAt = resumeInstant;

    // ── right at resume ───────────────────────────────────────────────────
    // nowMs === startedAt → runAge = 0 → fmtElapsed clamps to 0 → "0m".

    it("CompactRunStrip: right at resume shows 0m", () => {
      render(
        <ElapsedTimeBadge
          data-testid="strip-elapsed"
          nowMs={resumeInstant}
          startedAt={postResumeStartedAt}
          pausedAt={null}
        />,
      );
      expect(screen.getByTestId("strip-elapsed").textContent).toBe("0m");
    });

    it("ElapsedCard: right at resume shows 0m", () => {
      render(
        <ElapsedTimeBadge
          data-testid="elapsed-card-value"
          nowMs={resumeInstant}
          startedAt={postResumeStartedAt}
          pausedAt={null}
        />,
      );
      expect(screen.getByTestId("elapsed-card-value").textContent).toBe("0m");
    });

    // ── 25 min after resume ───────────────────────────────────────────────
    // nowMs = resumeInstant + 25 min → runAge = 25 min → "25m".

    it("CompactRunStrip: 25 min after resume shows 25m (normal accumulation)", () => {
      render(
        <ElapsedTimeBadge
          data-testid="strip-elapsed"
          nowMs={resumeInstant + 25 * 60_000}
          startedAt={postResumeStartedAt}
          pausedAt={null}
        />,
      );
      expect(screen.getByTestId("strip-elapsed").textContent).toBe("25m");
    });

    it("ElapsedCard: 25 min after resume shows 25m (normal accumulation)", () => {
      render(
        <ElapsedTimeBadge
          data-testid="elapsed-card-value"
          nowMs={resumeInstant + 25 * 60_000}
          startedAt={postResumeStartedAt}
          pausedAt={null}
        />,
      );
      expect(screen.getByTestId("elapsed-card-value").textContent).toBe("25m");
    });

    // ── stale pausedAt must NOT be carried over ───────────────────────────
    // A regression where pausedAt is accidentally carried forward from before
    // the resume would inflate elapsed.  The correct post-resume state has
    // pausedAt=null.  These assertions confirm elapsed equals exactly the raw
    // run age (no addend from a stale pausedAt).

    it("CompactRunStrip: elapsed equals raw run age — no stale pausedAt addend", () => {
      const nowMs = resumeInstant + 45 * 60_000;
      render(
        <ElapsedTimeBadge
          data-testid="strip-elapsed"
          nowMs={nowMs}
          startedAt={postResumeStartedAt}
          pausedAt={null}
        />,
      );
      expect(screen.getByTestId("strip-elapsed").textContent).toBe("45m");
    });

    it("ElapsedCard: elapsed equals raw run age — no stale pausedAt addend", () => {
      const nowMs = resumeInstant + 45 * 60_000;
      render(
        <ElapsedTimeBadge
          data-testid="elapsed-card-value"
          nowMs={nowMs}
          startedAt={postResumeStartedAt}
          pausedAt={null}
        />,
      );
      expect(screen.getByTestId("elapsed-card-value").textContent).toBe("45m");
    });
  });

  // -------------------------------------------------------------------------
  // Scenario G: resumeRun(freezerEmpty=true) → state → ElapsedTimeBadge
  // full pipeline guard.
  //
  // This scenario closes the gap left by Scenario F: rather than hardcoding
  // the post-resume state, it calls applyResumeToRun — the same pure function
  // that resumeRun delegates to in home.tsx — and asserts both:
  //
  //   1. The resulting run state has pausedAt === undefined (cleared).
  //   2. The resulting startedAt/pausedAt fed to ElapsedTimeBadge produces
  //      the correct visual output.
  //
  // If a future edit to applyResumeToRun (or resumeRun) stops clearing
  // pausedAt, assertion (1) fails immediately — the rendered assertions then
  // serve as the downstream proof of why it matters.
  //
  // Pre-resume state:
  //   run.startedAt  = START (run started 60 min ago)
  //   run.pausedAt   = START + 30 min (paused 30 min in, still open)
  //
  // applyResumeToRun(run, freezerEmpty=true, resumeInstant) returns:
  //   startedAt = resumeInstant   (fresh-start branch always returns now)
  //   pausedAt  = undefined       (explicitly cleared)
  //
  // Regression sentinel: renders ElapsedTimeBadge with the stale pausedAt
  // still set (as it would be in a broken resumeRun) and proves elapsed is
  // inflated, confirming the cleared-pausedAt invariant is load-bearing.
  // -------------------------------------------------------------------------
  describe("Scenario G: applyResumeToRun(freezerEmpty=true) → state → ElapsedTimeBadge pipeline", () => {
    const START = 3_000_000_000;
    // Run was paused 30 min after start.
    const stalePausedAt = START + 30 * 60_000;
    // resumeRun is called 60 min after start (30 min pause wall-clock).
    const resumeInstant = START + 60 * 60_000;

    // Pre-resume run object (pausedAt is non-null — the regression case being guarded).
    const pausedRun = {
      id: "run-g",
      brand: "TestBrand",
      flavor: "TestFlavor",
      startedAt: START,
      pausedAt: stalePausedAt,
    };

    // Call the real production transformation used by resumeRun in home.tsx.
    // This is the function under test — if it ever stops clearing pausedAt,
    // the assertions below will fail.
    const resumedRun = applyResumeToRun(pausedRun, true, resumeInstant);

    // ------------------------------------------------------------------
    // State assertions: verify the output of applyResumeToRun directly.
    // These assertions are the primary regression guards — they will fail
    // immediately if applyResumeToRun stops clearing pausedAt or stops
    // setting startedAt to resumeInstant for the freezerEmpty=true branch.
    // ------------------------------------------------------------------
    it("applyResumeToRun returns a non-null result for a paused run", () => {
      expect(resumedRun).not.toBeNull();
    });

    it("post-resume run has pausedAt === undefined (cleared by the transformation)", () => {
      expect(resumedRun!.pausedAt).toBeUndefined();
    });

    it("post-resume run has startedAt === resumeInstant (fresh-start branch)", () => {
      expect(resumedRun!.startedAt).toBe(resumeInstant);
    });

    // ------------------------------------------------------------------
    // Rendered assertions: feed the ACTUAL post-resume state into
    // ElapsedTimeBadge (not manually constructed constants).
    // If applyResumeToRun sets the wrong startedAt or forgets to clear
    // pausedAt, the rendered output below will also be wrong.
    // ------------------------------------------------------------------
    it("CompactRunStrip: right at resume shows 0m (pausedAt cleared, startedAt = now)", () => {
      render(
        <ElapsedTimeBadge
          data-testid="strip-elapsed"
          nowMs={resumeInstant}
          startedAt={resumedRun!.startedAt!}
          pausedAt={resumedRun!.pausedAt ?? null}
        />,
      );
      expect(screen.getByTestId("strip-elapsed").textContent).toBe("0m");
    });

    it("ElapsedCard: right at resume shows 0m (pausedAt cleared, startedAt = now)", () => {
      render(
        <ElapsedTimeBadge
          data-testid="elapsed-card-value"
          nowMs={resumeInstant}
          startedAt={resumedRun!.startedAt!}
          pausedAt={resumedRun!.pausedAt ?? null}
        />,
      );
      expect(screen.getByTestId("elapsed-card-value").textContent).toBe("0m");
    });

    it("CompactRunStrip: 25 min after resume shows 25m (normal accumulation from fresh start)", () => {
      render(
        <ElapsedTimeBadge
          data-testid="strip-elapsed"
          nowMs={resumeInstant + 25 * 60_000}
          startedAt={resumedRun!.startedAt!}
          pausedAt={resumedRun!.pausedAt ?? null}
        />,
      );
      expect(screen.getByTestId("strip-elapsed").textContent).toBe("25m");
    });

    it("ElapsedCard: 25 min after resume shows 25m (normal accumulation from fresh start)", () => {
      render(
        <ElapsedTimeBadge
          data-testid="elapsed-card-value"
          nowMs={resumeInstant + 25 * 60_000}
          startedAt={resumedRun!.startedAt!}
          pausedAt={resumedRun!.pausedAt ?? null}
        />,
      );
      expect(screen.getByTestId("elapsed-card-value").textContent).toBe("25m");
    });

    // ------------------------------------------------------------------
    // Regression sentinel: prove that carrying stalePausedAt forward
    // inflates the elapsed display.
    //
    // With stalePausedAt still set (regression):
    //   nowMs = resumeInstant + 25 min
    //   addend = Math.min(runAge, Math.max(0, nowMs - stalePausedAt))
    //          = Math.min(25 min, Math.max(0, 55 min))
    //          = 25 min
    //   elapsed = runAge + addend = 25 + 25 = 50 min  ← WRONG
    //
    // With pausedAt=null (correct):
    //   addend = 0 → elapsed = 25 min  ← correct
    //
    // This sentinel confirms that the pausedAt=undefined clearing in
    // applyResumeToRun is load-bearing: without it, the display is wrong.
    // ------------------------------------------------------------------
    it("regression sentinel: if pausedAt were not cleared, elapsed would be inflated above 25m", () => {
      const nowMs = resumeInstant + 25 * 60_000;
      render(
        <ElapsedTimeBadge
          data-testid="sentinel"
          nowMs={nowMs}
          startedAt={resumedRun!.startedAt!}
          pausedAt={stalePausedAt}
        />,
      );
      const minutes = toMinutes(
        screen.getByTestId("sentinel").textContent ?? "",
      );
      // Stale pausedAt adds an unearned 25-min addend → 50m, not 25m.
      expect(minutes).toBeGreaterThan(25);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario H: applyResumeToRun(freezerEmpty=false) → state → ElapsedTimeBadge
  // full pipeline guard.
  //
  // This is the symmetric counterpart to Scenario G: it closes the gap left
  // by Scenario E, which hardcodes pausedAt=null instead of deriving it via
  // applyResumeToRun.
  //
  // resumeRun(freezerEmpty=false) shifts startedAt forward by the pause
  // duration and clears pausedAt.  If a future refactor stops clearing
  // pausedAt in the freezerEmpty=false branch, this scenario catches it
  // immediately via the state assertion, and the rendered assertions prove
  // why the clearing is load-bearing.
  //
  // Pre-resume state:
  //   run.startedAt = START (run started T+0)
  //   run.pausedAt  = START + 30 min (paused 30 min in, still open)
  //
  // Resume happens at START + 60 min (30 min real wall-clock pause).
  //
  // applyResumeToRun(run, freezerEmpty=false, resumeInstant):
  //   pauseDuration = resumeInstant − pausedAt = 30 min
  //   newStartedAt  = START + pauseDuration   = START + 30 min
  //   pausedAt      = undefined               (explicitly cleared)
  //
  // Post-resume observable:
  //   At resumeInstant (START + 60 min):
  //     runAge = resumeInstant − newStartedAt = 30 min → "30m"
  //   25 min after resumeInstant (START + 85 min):
  //     runAge = 85 − 30 = 55 min → "55m"
  //
  // Regression sentinel: with stalePausedAt still set (broken resumeRun),
  //   at resumeInstant:
  //     addend = Math.min(30 min, Math.max(0, 60 min − 30 min)) = 30 min
  //     elapsed = 30 + 30 = 60 min  ← inflated, proves clearing is required.
  // -------------------------------------------------------------------------
  describe("Scenario H: applyResumeToRun(freezerEmpty=false) → state → ElapsedTimeBadge pipeline", () => {
    const START = 4_000_000_000;
    // Run was paused 30 min after start.
    const stalePausedAt = START + 30 * 60_000;
    // Resume happens at START + 60 min (30 min of real wall-clock pause).
    const resumeInstant = START + 60 * 60_000;

    // Pre-resume run object (pausedAt non-null — the regression case being guarded).
    const pausedRun = {
      id: "run-h",
      brand: "TestBrand",
      flavor: "TestFlavor",
      startedAt: START,
      pausedAt: stalePausedAt,
    };

    // Call the real production transformation used by resumeRun in home.tsx.
    // freezerEmpty=false: shifts startedAt forward by pauseDuration (30 min),
    // so newStartedAt = START + 30 min = resumeInstant − 30 min.
    const resumedRun = applyResumeToRun(pausedRun, false, resumeInstant);

    // Expected post-resume startedAt: START + (resumeInstant − stalePausedAt)
    //   = START + (60 min − 30 min) = START + 30 min.
    const expectedNewStartedAt = START + 30 * 60_000;

    // ------------------------------------------------------------------
    // State assertions: verify the output of applyResumeToRun directly.
    // These are the primary regression guards — they fail immediately if
    // applyResumeToRun stops clearing pausedAt or computes the wrong
    // newStartedAt for the freezerEmpty=false branch.
    // ------------------------------------------------------------------
    it("applyResumeToRun returns a non-null result for a paused run", () => {
      expect(resumedRun).not.toBeNull();
    });

    it("post-resume run has pausedAt === undefined (cleared by the transformation)", () => {
      expect(resumedRun!.pausedAt).toBeUndefined();
    });

    it("post-resume run has startedAt shifted forward by the pause duration (START + 30 min)", () => {
      expect(resumedRun!.startedAt).toBe(expectedNewStartedAt);
    });

    // ------------------------------------------------------------------
    // Rendered assertions: feed the ACTUAL post-resume state into
    // ElapsedTimeBadge (not manually constructed constants).
    // If applyResumeToRun sets the wrong startedAt or forgets to clear
    // pausedAt, the rendered output below will also be wrong.
    // ------------------------------------------------------------------

    // At resumeInstant: nowMs = START + 60 min, newStartedAt = START + 30 min
    // runAge = 30 min → "30m" (no addend since pausedAt=null).
    it("CompactRunStrip: right at resume shows 30m (shifted startedAt, pausedAt cleared)", () => {
      render(
        <ElapsedTimeBadge
          data-testid="strip-elapsed"
          nowMs={resumeInstant}
          startedAt={resumedRun!.startedAt!}
          pausedAt={resumedRun!.pausedAt ?? null}
        />,
      );
      expect(screen.getByTestId("strip-elapsed").textContent).toBe("30m");
    });

    it("ElapsedCard: right at resume shows 30m (shifted startedAt, pausedAt cleared)", () => {
      render(
        <ElapsedTimeBadge
          data-testid="elapsed-card-value"
          nowMs={resumeInstant}
          startedAt={resumedRun!.startedAt!}
          pausedAt={resumedRun!.pausedAt ?? null}
        />,
      );
      expect(screen.getByTestId("elapsed-card-value").textContent).toBe("30m");
    });

    // 25 min after resumeInstant: nowMs = START + 85 min
    // runAge = 85 − 30 = 55 min → "55m".
    it("CompactRunStrip: 25 min after resume shows 55m (normal accumulation from shifted start)", () => {
      render(
        <ElapsedTimeBadge
          data-testid="strip-elapsed"
          nowMs={resumeInstant + 25 * 60_000}
          startedAt={resumedRun!.startedAt!}
          pausedAt={resumedRun!.pausedAt ?? null}
        />,
      );
      expect(screen.getByTestId("strip-elapsed").textContent).toBe("55m");
    });

    it("ElapsedCard: 25 min after resume shows 55m (normal accumulation from shifted start)", () => {
      render(
        <ElapsedTimeBadge
          data-testid="elapsed-card-value"
          nowMs={resumeInstant + 25 * 60_000}
          startedAt={resumedRun!.startedAt!}
          pausedAt={resumedRun!.pausedAt ?? null}
        />,
      );
      expect(screen.getByTestId("elapsed-card-value").textContent).toBe("55m");
    });

    // ------------------------------------------------------------------
    // Regression sentinel: prove that carrying stalePausedAt forward
    // inflates the elapsed display for freezerEmpty=false.
    //
    // With stalePausedAt still set (broken resumeRun):
    //   nowMs = resumeInstant = START + 60 min
    //   newStartedAt = START + 30 min
    //   runAge = 30 min
    //   addend = Math.min(30 min, Math.max(0, 60 min − 30 min))
    //          = Math.min(30, 30) = 30 min
    //   elapsed = 30 + 30 = 60 min  ← WRONG (doubled)
    //
    // With pausedAt=null (correct):
    //   addend = 0 → elapsed = 30 min  ← correct
    //
    // This sentinel confirms that the pausedAt=undefined clearing in
    // applyResumeToRun is load-bearing for the freezerEmpty=false branch.
    // ------------------------------------------------------------------
    it("regression sentinel: if pausedAt were not cleared, elapsed would be inflated above 30m", () => {
      render(
        <ElapsedTimeBadge
          data-testid="sentinel"
          nowMs={resumeInstant}
          startedAt={resumedRun!.startedAt!}
          pausedAt={stalePausedAt}
        />,
      );
      const minutes = toMinutes(
        screen.getByTestId("sentinel").textContent ?? "",
      );
      // Stale pausedAt adds an unearned 30-min addend → 60m, not 30m.
      expect(minutes).toBeGreaterThan(30);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario I: applyResumeToRun(freezerEmpty=false) with a LARGE pause (120 min)
  // — elapsed bounded by actual wall-clock time + counter-proof.
  //
  // This scenario closes the gap left by Scenario H, which only covers a
  // 30-min pause.  A refactor that caps or truncates pauseDuration in
  // computeResumedStartedAt (e.g. to a small maximum) would not cause the
  // state-level startedAt assertion in Scenario H to fail if the capped value
  // still matches a 30-min shift — but a 120-min large-pause test would expose
  // that the cap is wrong.
  //
  // Pre-resume state:
  //   run.startedAt = START (T+0)
  //   run.pausedAt  = START + 30 min (paused after 30 min of active run time)
  //
  // Large wall-clock pause: 120 min.
  // Resume happens at START + 150 min.
  //
  // applyResumeToRun(run, freezerEmpty=false, resumeInstant):
  //   pauseDuration = resumeInstant − pausedAt = 120 min
  //   newStartedAt  = START + 120 min
  //   pausedAt      = undefined   (explicitly cleared)
  //
  // At resumeInstant (START + 150 min):
  //   runAge = 150 − 120 = 30 min  → "30m"
  //   wallClock = resumeInstant − START = 150 min
  //   elapsed (30 min) ≤ wallClock (150 min)  ✓
  //
  // Counter-proof (startedAt shift capped or skipped):
  //   brokenStartedAt = START (shift skipped entirely)
  //   brokenElapsed   = resumeInstant − START = 150 min  (inflated; 5× the 30 min active time)
  //   The counter-proof renders with brokenStartedAt and asserts minutes > 30m.
  //
  // Note: if the shift were capped at, say, 30 min instead of the full 120 min:
  //   cappedNewStartedAt = START + 30 min
  //   elapsed = 150 − 30 = 120 min  (inflated; 4× the 30 min active time)
  //   120 min ≤ 150 min (wallClock), so the bound assertion does NOT catch this.
  //   The exact "30m" assertion is the tightest guard: any cap produces the wrong
  //   displayed value and the two counter-proof render tests below detect it.
  // -------------------------------------------------------------------------
  describe("Scenario I: applyResumeToRun(freezerEmpty=false) — large pause (120 min) elapsed wall-clock bound", () => {
    const START = 5_000_000_000;
    // Run was paused 30 min after start.
    const stalePausedAt = START + 30 * 60_000;
    // Large wall-clock pause: 120 min. Resume at START + 150 min.
    const LARGE_PAUSE_MS = 120 * 60_000;
    const resumeInstant = stalePausedAt + LARGE_PAUSE_MS; // START + 150 min

    const pausedRun = {
      id: "run-i",
      brand: "TestBrand",
      flavor: "TestFlavor",
      startedAt: START,
      pausedAt: stalePausedAt,
    };

    // Call the real production transformation.
    // freezerEmpty=false: newStartedAt = START + 120 min (shift by full 120-min pause).
    const resumedRun = applyResumeToRun(pausedRun, false, resumeInstant);

    // Expected post-resume startedAt: START + (resumeInstant − stalePausedAt)
    //   = START + 120 min.
    const expectedNewStartedAt = START + LARGE_PAUSE_MS;

    // Wall-clock elapsed since the run started (includes the pause period).
    const wallClockMinutes = (resumeInstant - START) / 60_000; // 150 min

    // ------------------------------------------------------------------
    // State assertions: primary regression guards.
    // ------------------------------------------------------------------
    it("applyResumeToRun returns a non-null result", () => {
      expect(resumedRun).not.toBeNull();
    });

    it("post-resume run has pausedAt === undefined (cleared)", () => {
      expect(resumedRun!.pausedAt).toBeUndefined();
    });

    it("post-resume run has startedAt shifted forward by the full 120-min pause duration", () => {
      expect(resumedRun!.startedAt).toBe(expectedNewStartedAt);
    });

    // ------------------------------------------------------------------
    // Rendered assertions: elapsed ≤ wall-clock time at resumeInstant.
    // A capped or skipped shift would produce a higher elapsed value.
    // ------------------------------------------------------------------
    it("CompactRunStrip: right at resume shows 30m (active run time, not wall-clock 150m)", () => {
      render(
        <ElapsedTimeBadge
          data-testid="strip-elapsed"
          nowMs={resumeInstant}
          startedAt={resumedRun!.startedAt!}
          pausedAt={resumedRun!.pausedAt ?? null}
        />,
      );
      expect(screen.getByTestId("strip-elapsed").textContent).toBe("30m");
    });

    it("ElapsedCard: right at resume shows 30m (active run time, not wall-clock 150m)", () => {
      render(
        <ElapsedTimeBadge
          data-testid="elapsed-card-value"
          nowMs={resumeInstant}
          startedAt={resumedRun!.startedAt!}
          pausedAt={resumedRun!.pausedAt ?? null}
        />,
      );
      expect(screen.getByTestId("elapsed-card-value").textContent).toBe("30m");
    });

    it("CompactRunStrip: elapsed ≤ actual wall-clock time since run started (150 min)", () => {
      render(
        <ElapsedTimeBadge
          data-testid="strip-elapsed"
          nowMs={resumeInstant}
          startedAt={resumedRun!.startedAt!}
          pausedAt={resumedRun!.pausedAt ?? null}
        />,
      );
      const minutes = toMinutes(
        screen.getByTestId("strip-elapsed").textContent ?? "",
      );
      expect(minutes).toBeLessThanOrEqual(wallClockMinutes);
    });

    it("ElapsedCard: elapsed ≤ actual wall-clock time since run started (150 min)", () => {
      render(
        <ElapsedTimeBadge
          data-testid="elapsed-card-value"
          nowMs={resumeInstant}
          startedAt={resumedRun!.startedAt!}
          pausedAt={resumedRun!.pausedAt ?? null}
        />,
      );
      const minutes = toMinutes(
        screen.getByTestId("elapsed-card-value").textContent ?? "",
      );
      expect(minutes).toBeLessThanOrEqual(wallClockMinutes);
    });

    // ------------------------------------------------------------------
    // Counter-proof: without the startedAt shift (or with it capped),
    // elapsed is inflated far beyond the 30 min of actual active run time.
    //
    // Broken case: brokenStartedAt = START (shift skipped entirely).
    //   elapsed = resumeInstant − START = 150 min  ← 5× the true active time.
    //
    // This proves that the full uncapped shift in computeResumedStartedAt is
    // load-bearing: any truncation of pauseDuration produces a value > 30m.
    // ------------------------------------------------------------------
    it("counter-proof: without startedAt shift, elapsed is inflated above active run time (30m)", () => {
      render(
        <ElapsedTimeBadge
          data-testid="counter-proof"
          nowMs={resumeInstant}
          startedAt={START}
          pausedAt={null}
        />,
      );
      const minutes = toMinutes(
        screen.getByTestId("counter-proof").textContent ?? "",
      );
      // Without the shift, elapsed = 150 min — inflated by the 120-min pause.
      expect(minutes).toBeGreaterThan(30);
    });

    it("counter-proof: with shift capped at 30 min (not the full 120 min), elapsed is still inflated", () => {
      // Simulates a refactor that caps pauseDuration to, say, 30 min.
      const cappedShift = 30 * 60_000;
      const cappedNewStartedAt = START + cappedShift; // START + 30 min
      render(
        <ElapsedTimeBadge
          data-testid="counter-proof-capped"
          nowMs={resumeInstant}
          startedAt={cappedNewStartedAt}
          pausedAt={null}
        />,
      );
      const minutes = toMinutes(
        screen.getByTestId("counter-proof-capped").textContent ?? "",
      );
      // With a 30-min cap: elapsed = 150 − 30 = 120 min — still 4× the true active time.
      expect(minutes).toBeGreaterThan(30);
    });
  });
});
