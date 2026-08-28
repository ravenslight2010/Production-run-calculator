export type PackagingSpeedCorrection = {
  /** Signed number of cases the operator corrected the packaging total by. */
  deltaCases: number;
};

export type PackagingSpeedNudge = {
  value: number;
  isCrust: boolean;
  direction: "faster" | "slower";
};

export type PackagingSpeedNudgeIneligibility =
  | {
      kind: "output-time";
      elapsedOutputSec: number;
      requiredOutputSec: number;
    }
  | {
      kind: "correction-count";
      direction: "faster" | "slower";
      correctionCount: number;
      correctionsNeeded: number;
    }
  | {
      kind: "correction-size";
      direction: "faster" | "slower";
      correctionCases: number;
      correctionCasesNeeded: number;
    }
  | {
      kind: "missing-skid-size";
      direction: "faster" | "slower";
      correctionCount: number;
    }
  | {
      kind: "invalid-data";
    };

export type PackagingSpeedNudgeEvaluation = {
  nudge: PackagingSpeedNudge | null;
  reason: PackagingSpeedNudgeIneligibility | null;
};

export type PackagingSpeedNudgeFeedbackStatus =
  | PackagingSpeedNudgeIneligibility
  | "auto-disabled"
  | "run-not-running"
  | null;

export type PackagingSpeedNudgeTracking = {
  runId: string;
  corrections: PackagingSpeedCorrection[];
  dismissed: boolean;
  lastAcceptedAt: number;
};

const MIN_OUTPUT_SECONDS = 30;
const MIN_SKID_CORRECTION_RATIO = 0.05;
const ACCEPT_COOLDOWN_MS = 30_000;
const MAX_CORRECTIONS = 10;

function directionOf(deltaCases: number): -1 | 0 | 1 {
  if (!Number.isFinite(deltaCases) || deltaCases === 0) return 0;
  return deltaCases > 0 ? 1 : -1;
}

export function createPackagingSpeedNudgeTracking(runId: string): PackagingSpeedNudgeTracking {
  return {
    runId,
    corrections: [],
    dismissed: false,
    lastAcceptedAt: 0,
  };
}

export function recordPackagingSpeedCorrection(
  tracking: PackagingSpeedNudgeTracking,
  deltaCases: number,
): PackagingSpeedNudgeTracking {
  if (directionOf(deltaCases) === 0) return tracking;

  // Do not use Array.prototype.at here: this handler runs in older iOS Safari
  // versions where an unsupported array method can abort the click silently.
  const currentNetCorrection = tracking.corrections.reduce(
    (total, correction) => total + correction.deltaCases,
    0,
  );
  const nextNetCorrection = currentNetCorrection + deltaCases;

  // A reverse click cancels only as much prior evidence as it matches. Once
  // it crosses zero, keep only the residual in the new direction so a small
  // over-correction does not inherit the old episode's magnitude or count.
  const currentDirection = directionOf(currentNetCorrection);
  const deltaDirection = directionOf(deltaCases);
  const nextDirection = directionOf(nextNetCorrection);
  const corrections = nextDirection === 0
    ? []
    : currentDirection !== 0 && deltaDirection !== currentDirection
      ? [{ deltaCases: nextNetCorrection }]
      : tracking.corrections.concat({ deltaCases }).slice(-MAX_CORRECTIONS);

  return { ...tracking, corrections };
}

export function canDetectPackagingSpeedNudge(
  tracking: PackagingSpeedNudgeTracking,
  nowMs: number,
): boolean {
  return !tracking.dismissed && nowMs >= tracking.lastAcceptedAt + ACCEPT_COOLDOWN_MS;
}

export function acceptPackagingSpeedNudge(
  tracking: PackagingSpeedNudgeTracking,
  nowMs: number,
): PackagingSpeedNudgeTracking {
  return {
    ...tracking,
    corrections: [],
    lastAcceptedAt: nowMs,
  };
}

export function dismissPackagingSpeedNudge(
  tracking: PackagingSpeedNudgeTracking,
): PackagingSpeedNudgeTracking {
  return { ...tracking, dismissed: true };
}

type EvaluatePackagingSpeedNudgeInput = {
  /** @deprecated Kept for callers during rollout; never affects the result. */
  displayedCases?: number;
  elapsedOutputMin: number;
  configuredPpm: number;
  pizzasPerCase: number;
  /** Needed only for the one-correction shortcut. */
  casesPerSkid?: number;
  speedAdjustment: number;
  isCrust: boolean;
  corrections: PackagingSpeedCorrection[];
};

/**
 * Returns a speed nudge when a manual correction episode either repeats in the
 * same direction or a single correction reaches the rounded 5%-of-skid
 * threshold. The reason is returned separately when the episode is not ready
 * so the Packaging controls can explain what the operator should do next.
 *
 * Auto-track starts from the configured rate, so manual case corrections are
 * best understood as signed movement away from that expected output. Anchoring
 * the observation to expected cases means the recommendation reflects the
 * operator's net correction rather than an unrelated displayed counter.
 */
export function evaluatePackagingSpeedNudge(
  input: EvaluatePackagingSpeedNudgeInput,
): PackagingSpeedNudgeEvaluation {
  const {
    elapsedOutputMin,
    configuredPpm,
    pizzasPerCase,
    speedAdjustment,
    isCrust,
    corrections,
    casesPerSkid,
  } = input;

  if (
    !Number.isFinite(elapsedOutputMin) ||
    !Number.isFinite(configuredPpm) ||
    !Number.isFinite(pizzasPerCase) ||
    configuredPpm <= 0 ||
    pizzasPerCase <= 0 ||
    corrections.length === 0
  ) {
    return { nudge: null, reason: { kind: "invalid-data" } };
  }

  const elapsedOutputSec = Math.max(0, elapsedOutputMin * 60);
  if (elapsedOutputSec < MIN_OUTPUT_SECONDS) {
    return {
      nudge: null,
      reason: {
        kind: "output-time",
        elapsedOutputSec,
        requiredOutputSec: MIN_OUTPUT_SECONDS,
      },
    };
  }

  const direction = directionOf(corrections[0]?.deltaCases ?? 0);
  const cumulativeCorrectionCases = corrections.reduce(
    (total, correction) => total + correction.deltaCases,
    0,
  );
  const netDirection = directionOf(cumulativeCorrectionCases);
  if (
    direction === 0 ||
    netDirection === 0 ||
    corrections.some((correction) => directionOf(correction.deltaCases) !== direction)
  ) {
    return { nudge: null, reason: { kind: "invalid-data" } };
  }

  const nudgeDirection = netDirection > 0 ? "faster" : "slower";
  const hasRepeatedCorrection = corrections.length >= 2;
  const netCorrectionCases = Math.abs(cumulativeCorrectionCases);
  const skidSize = Number(casesPerSkid);
  const correctionCasesNeeded =
    Number.isFinite(skidSize) && skidSize > 0
      ? Math.max(1, Math.ceil(skidSize * MIN_SKID_CORRECTION_RATIO))
      : null;

  if (!hasRepeatedCorrection) {
    if (correctionCasesNeeded === null) {
      return {
        nudge: null,
        reason: {
          kind: "missing-skid-size",
          direction: nudgeDirection,
          correctionCount: corrections.length,
        },
      };
    }
    if (netCorrectionCases < correctionCasesNeeded) {
      return {
        nudge: null,
        reason: {
          kind: "correction-size",
          direction: nudgeDirection,
          correctionCases: netCorrectionCases,
          correctionCasesNeeded,
        },
      };
    }
  }

  const expectedCases = (elapsedOutputMin * configuredPpm) / pizzasPerCase;
  if (!Number.isFinite(expectedCases) || expectedCases <= 0) {
    return { nudge: null, reason: { kind: "invalid-data" } };
  }

  const correctionAdjustedCases = Math.max(
    0,
    expectedCases + cumulativeCorrectionCases,
  );
  const driftRatio = correctionAdjustedCases / expectedCases;

  if (
    !Number.isFinite(driftRatio) ||
    (netDirection > 0 && driftRatio <= 1) ||
    (netDirection < 0 && driftRatio >= 1)
  ) {
    return {
      nudge: null,
      reason: {
        kind: "correction-count",
        direction: nudgeDirection,
        correctionCount: corrections.length,
        correctionsNeeded: 2,
      },
    };
  }

  const observedPpm = (correctionAdjustedCases * pizzasPerCase) / elapsedOutputMin;
  const value = isCrust
    ? Math.round(observedPpm * 100) / 100
    : Math.max(
      0.01,
      Math.min(
        9.99,
        Math.round(Math.max(0.01, Number(speedAdjustment) || 0.01) * driftRatio * 100) / 100,
      ),
    );

  return {
    nudge: {
      value,
      isCrust,
      direction: nudgeDirection,
    },
    reason: null,
  };
}