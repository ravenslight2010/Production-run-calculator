// ─── 3-phase line fill/drain timer utility ────────────────────────────────────
//
// Models the three physically distinct segments of the production line and their
// stop/start propagation delays:
//
//   Stage 1 — Press · Oven · Frontline  (preTunnelMin, default 2.5 min)
//   Stage 2 — Freeze tunnel             (freezerTime - preTunnelMin - postTunnelMin)
//   Stage 3 — Wrapper · Packaging       (postTunnelMin, default 2.5 min)
//
// The total line time (freezerTime) is unchanged — this function overlays the
// phase display on top of the existing timing model without altering case counts.
//
// Pause/resume propagation model
// ────────────────────────────────────
// The pause record stores the operator's stop-tunnel decision. With the safe
// stop-tunnel policy, frontline drains, the tunnel stops, then packaging drains.
// With keep-tunnel-running, the three stages drain in normal sequence. The saved
// policy, rather than elapsed wall time alone, also decides whether a resumed
// tunnel needs a restart propagation countdown.

export type PhaseState =
  | "filling"   // product entering this stage at run start
  | "active"    // stage in steady-state (all product flowing normally)
  | "paused"    // stage stopped (pause wave has arrived)
  | "draining"  // stage still flowing (product draining toward next stage)
  | "resuming"  // product arriving after resume (post-pause restart wave)
  | "empty";    // stage has no product (before fill completes or after full drain)

export interface PhaseInfo {
  label: string;
  state: PhaseState;
  /** How long until the next state transition, in ms. 0 for stable states. */
  remainMs: number;
}

export interface LinePhases {
  stage1: PhaseInfo;
  stage2: PhaseInfo;
  stage3: PhaseInfo;
}

/** True while any modeled line segment still contains product. */
export function lineHasProduct(phases: LinePhases): boolean {
  return [phases.stage1, phases.stage2, phases.stage3].some(
    (phase) => phase.state !== "empty",
  );
}

export interface ComputeLinePhasesArgs {
  /** Virtual elapsed time (pause-excluded), in seconds. */
  elapsedBatchSec: number;
  /** Wall-clock ms when the run was paused; null/undefined if not paused. */
  pausedAt: number | null | undefined;
  /** Wall-clock ms of the most recent resume (endedAt of last closed "pause" stoppage).
   *  0 if the run has never been paused/resumed. */
  lastResumeWallMs: number;
  /** Wall-clock ms when the most recent pause began (startedAt of last closed "pause" stoppage).
   *  0 if unknown. Used to compute pause duration so we know which stages were actually stopped. */
  lastPauseStartWallMs: number;
  /** Open pause policy. Missing legacy values default to the safe stop-tunnel policy. */
  pauseStopsTunnel?: boolean;
  /** Most recent closed pause policy. Missing legacy values default to stop tunnel. */
  lastPauseStopsTunnel?: boolean;
  runStatus: "running" | "paused" | "ended" | string;
  /** Duration of Stage 1 (press/oven/frontline), in minutes. */
  preTunnelMin: number;
  /** Duration of Stage 3 (wrapper/packaging), in minutes. */
  postTunnelMin: number;
  /** Total line time (all three stages combined), in minutes. */
  freezerTime: number;
  /** Current wall-clock, in ms. */
  nowMs: number;
  /** Run end wall-clock ms; used for ended-run wall-clock drain model. */
  endedAt?: number | null;
}

export function computeLinePhases(args: ComputeLinePhasesArgs): LinePhases {
  const {
    elapsedBatchSec,
    pausedAt,
    lastResumeWallMs,
    lastPauseStartWallMs,
    pauseStopsTunnel = true,
    lastPauseStopsTunnel = true,
    runStatus,
    freezerTime,
    nowMs,
    endedAt,
  } = args;

  // Safe normalization: if the two outer stages claim more time than the total
  // line, scale them proportionally so they fit — the tunnel gets what remains
  // (possibly zero). This prevents phase-transition times extending past the
  // configured total and keeps operational timers physically consistent.
  let preTunnelMin = args.preTunnelMin;
  let postTunnelMin = args.postTunnelMin;
  if (freezerTime > 0 && preTunnelMin + postTunnelMin > freezerTime) {
    const total = preTunnelMin + postTunnelMin;
    preTunnelMin = (preTunnelMin / total) * freezerTime;
    postTunnelMin = (postTunnelMin / total) * freezerTime;
  }

  const tunnelMin = Math.max(0, freezerTime - preTunnelMin - postTunnelMin);
  const elapsedMin = elapsedBatchSec / 60;

  const S1 = "Press · Oven · Frontline";
  const S2 = "Freeze tunnel";
  const S3 = "Wrapper · Packaging";

  const mk = (label: string, state: PhaseState, remainMs = 0): PhaseInfo => ({
    label,
    state,
    remainMs,
  });
  const emptyPhases = (): LinePhases => ({
    stage1: mk(S1, "empty"),
    stage2: mk(S2, "empty"),
    stage3: mk(S3, "empty"),
  });

  // The line physically contains product in more than one stage during a drain,
  // but the operator-facing countdown is intentionally sequential: frontline,
  // then tunnel, then packaging. Showing the cumulative remaining time for each
  // stage made all three rows count down at once. Keep the same total drain
  // duration and only expose the stage whose own window is currently active.
  const sequentialDrain = (totalRemainingMin: number): LinePhases => {
    const remaining = Math.max(0, totalRemainingMin);
    const stage1Remaining = Math.max(0, remaining - tunnelMin - postTunnelMin);
    if (preTunnelMin > 0 && stage1Remaining > 0) {
      return {
        stage1: mk(S1, "draining", stage1Remaining * 60000),
        stage2: mk(S2, "empty"),
        stage3: mk(S3, "empty"),
      };
    }

    const stage2Remaining = Math.max(0, remaining - postTunnelMin);
    if (tunnelMin > 0 && stage2Remaining > 0) {
      return {
        stage1: mk(S1, "empty"),
        stage2: mk(S2, "draining", stage2Remaining * 60000),
        stage3: mk(S3, "empty"),
      };
    }

    if (postTunnelMin > 0 && remaining > 0) {
      return {
        stage1: mk(S1, "empty"),
        stage2: mk(S2, "empty"),
        stage3: mk(S3, "draining", remaining * 60000),
      };
    }

    return emptyPhases();
  };

  // ── Ended run: wall-clock drain from endedAt ─────────────────────────────
  if (runStatus === "ended" && endedAt && freezerTime > 0) {
    // Product in Stage 1 always propagates through ALL downstream stages —
    // even if Stage 2/3 were empty at run-end, Stage 1's contents drain into
    // them over time. The line is not clear until freezerTime has elapsed from
    // the press stopping, regardless of how early the run ended.
    // Only exception: no product was ever pressed (elapsedMin == 0).
    if (elapsedMin <= 0) {
      return emptyPhases();
    }
    const elapsed = nowMs - endedAt;
    return sequentialDrain(freezerTime - elapsed / 60000);
  }

  // ── Paused run: persisted-policy staged drain ─────────────────────────────
  if (runStatus === "paused" && pausedAt != null) {
    if (elapsedMin <= 0) {
      return emptyPhases();
    }

    const pauseElapsedMin = Math.max(0, nowMs - pausedAt) / 60000;
    if (!pauseStopsTunnel) {
      // Tunnel remains powered: the whole line clears in its normal, one-stage
      // at-a-time order (frontline → tunnel → wrapper).
      return sequentialDrain(freezerTime - pauseElapsedMin);
    }

    // Safe policy: frontline drains before the tunnel is stopped. Once stopped,
    // wrapper/packaging drains independently until clear; product held in the
    // stopped tunnel remains visible as a stable stopped stage.
    if (preTunnelMin > 0 && pauseElapsedMin < preTunnelMin) {
      return {
        stage1: mk(S1, "draining", (preTunnelMin - pauseElapsedMin) * 60000),
        stage2: mk(S2, "empty"),
        stage3: mk(S3, "empty"),
      };
    }
    const wrapperElapsedMin = Math.max(0, pauseElapsedMin - preTunnelMin);
    if (postTunnelMin > 0 && wrapperElapsedMin < postTunnelMin) {
      return {
        stage1: mk(S1, "empty"),
        stage2: mk(S2, "paused"),
        stage3: mk(S3, "draining", (postTunnelMin - wrapperElapsedMin) * 60000),
      };
    }
    return {
      stage1: mk(S1, "empty"),
      stage2: mk(S2, "paused"),
      stage3: mk(S3, "empty"),
    };
  }

  // ── Running, filling / steady state ──────────────────────────────────────
  if (runStatus === "running") {
    if (elapsedMin === 0) {
      return {
        stage1: mk(S1, "empty"),
        stage2: mk(S2, "empty"),
        stage3: mk(S3, "empty"),
      };
    }

    // A resume wave exists only for a pause that was configured to stop the
    // tunnel and lasted long enough for frontline to drain into it. This uses
    // the persisted policy as well as timing, so two devices never infer
    // different restart states from the same wall-clock duration.
    const lastPauseDurationMs =
      lastResumeWallMs > 0 && lastPauseStartWallMs > 0
        ? Math.max(0, lastResumeWallMs - lastPauseStartWallMs)
        : 0;

    const tunnelWasStopped =
      lastPauseStopsTunnel && lastPauseDurationMs >= preTunnelMin * 60000;
    const s2WasStopped = tunnelWasStopped;
    const s3WasStopped = tunnelWasStopped;

    const s2ResumeDeadlineMs =
      s2WasStopped && lastResumeWallMs > 0
        ? lastResumeWallMs + preTunnelMin * 60000
        : 0;
    const s3ResumeDeadlineMs =
      s3WasStopped && lastResumeWallMs > 0
        ? lastResumeWallMs + (preTunnelMin + tunnelMin) * 60000
        : 0;

    const s2ResumingRemMs =
      s2ResumeDeadlineMs > 0 ? Math.max(0, s2ResumeDeadlineMs - nowMs) : 0;
    const s3ResumingRemMs =
      s3ResumeDeadlineMs > 0 ? Math.max(0, s3ResumeDeadlineMs - nowMs) : 0;

    // Stage 1: fills over the first preTunnelMin of virtual (pause-excluded) time.
    let s1: PhaseInfo;
    if (elapsedMin < preTunnelMin) {
      s1 = mk(S1, "filling", (preTunnelMin - elapsedMin) * 60000);
    } else {
      s1 = mk(S1, "active");
    }

    // Stage 2: fills over the next tunnelMin of virtual time.
    // Resume-propagation takes precedence over the filling countdown: if Stage 2
    // was actually stopped during the pause (pause lasted >= preTunnelMin) and the
    // restart-wave has not yet arrived, show "resuming" regardless of whether the
    // stage was still in its initial fill or had reached steady state.
    let s2: PhaseInfo;
    if (elapsedMin < preTunnelMin) {
      s2 = mk(S2, "empty");
    } else if (s2ResumingRemMs > 0) {
      // Resume propagation: new product arrives after preTunnelMin wall-clock.
      s2 = mk(S2, "resuming", s2ResumingRemMs);
    } else if (elapsedMin < preTunnelMin + tunnelMin) {
      s2 = mk(S2, "filling", (preTunnelMin + tunnelMin - elapsedMin) * 60000);
    } else {
      s2 = mk(S2, "active");
    }

    // Stage 3: fills over the final postTunnelMin of virtual time.
    // Same precedence: resuming > filling > active.
    let s3: PhaseInfo;
    if (elapsedMin < preTunnelMin + tunnelMin) {
      s3 = mk(S3, "empty");
    } else if (s3ResumingRemMs > 0) {
      // Resume propagation: new product arrives after (preTunnelMin + tunnelMin)
      // wall-clock time from resume.
      s3 = mk(S3, "resuming", s3ResumingRemMs);
    } else if (elapsedMin < freezerTime) {
      s3 = mk(S3, "filling", (freezerTime - elapsedMin) * 60000);
    } else {
      s3 = mk(S3, "active");
    }

    return { stage1: s1, stage2: s2, stage3: s3 };
  }

  // Fallback (not-started, unknown status): all empty.
  return {
    stage1: mk(S1, "empty"),
    stage2: mk(S2, "empty"),
    stage3: mk(S3, "empty"),
  };
}

// ── Ended-run elapsed helper ─────────────────────────────────────────────────
// Computes the pause-excluded virtual elapsed time (in seconds) for a run that
// has already ended. Handles the common auto-end-while-paused case: when a run
// is ended via starting another run (or a day rollover) it may still have an
// open pause stoppage (startedAt set, endedAt null). That open pause is capped
// at the run's endedAt so we don't count it as production time.
// Use this everywhere the ended-run drain display needs elapsedBatchSec.
export interface StoppageRecord {
  type: string;
  startedAt?: number | null;
  endedAt?: number | null;
}
export interface EndedRunRecord {
  startedAt?: number | null;
  endedAt: number;
  stoppages?: StoppageRecord[] | null;
}
export function computeEndedRunElapsedSec(run: EndedRunRecord): number {
  if (!run.startedAt) return 0;
  // `applyResumeToRun` shifts `startedAt` forward by each pause's duration on
  // every resume, so `endedAt - startedAt` already excludes all closed pauses.
  // We must NOT subtract closed stoppages again — that would double-count them.
  //
  // The only case we need to handle: a run auto-ended while still paused
  // (`applyResumeToRun` was never called, `startedAt` was not shifted).
  // Those stoppages have `startedAt` set but `endedAt` null. We subtract
  // the open pause duration (capped at `run.endedAt`) from the wall total.
  const totalMs = run.endedAt - run.startedAt;
  const openPausedMs = (run.stoppages ?? [])
    .filter((s) => s.type === "pause" && s.startedAt != null && s.endedAt == null)
    .reduce((sum, s) => {
      const pauseStart = Math.min(s.startedAt!, run.endedAt);
      return sum + Math.max(0, run.endedAt - pauseStart);
    }, 0);
  return Math.max(0, totalMs - openPausedMs) / 1000;
}

// ── Compact strip helper ─────────────────────────────────────────────────────
// Returns the single most-informative phase for the compact single-line badge.
// Priority: active transitions (filling/draining/resuming — nearest deadline)
// over paused stages (stopped — less urgent than a live countdown).
export function pickMostActivePhase(
  phases: LinePhases,
): PhaseInfo | undefined {
  const rows = [phases.stage1, phases.stage2, phases.stage3];

  // Active transitions with a live countdown first.
  const withCountdown = rows.filter(
    (r) =>
      (r.state === "filling" || r.state === "draining" || r.state === "resuming") &&
      r.remainMs > 0,
  );
  if (withCountdown.length > 0) {
    // Pick nearest deadline (smallest remainMs) as the most-urgent signal.
    return withCountdown.reduce((best, r) => (r.remainMs < best.remainMs ? r : best));
  }

  // Active transitions without a countdown (edge: draining with no speed data).
  const anyTransition = rows.find(
    (r) => r.state === "filling" || r.state === "draining" || r.state === "resuming",
  );
  if (anyTransition) return anyTransition;

  // Paused stages as a fallback — still worth showing.
  const anyPaused = rows.find((r) => r.state === "paused");
  return anyPaused;
}
