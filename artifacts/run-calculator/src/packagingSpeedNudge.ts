export type PackagingSpeedCorrection = {
  /** Signed number of cases the operator corrected the packaging total by. */
  deltaCases: number;
};

export type PackagingSpeedNudge = {
  value: number;
  isCrust: boolean;
  direction: "faster" | "slower";
};

export type PackagingSpeedNudgeTracking = {
  runId: string;
  corrections: PackagingSpeedCorrection[];
  dismissed: boolean;
  lastAcceptedAt: number;
};

const MIN_OUTPUT_MINUTES = 1;
const MIN_DRIFT_RATIO = 0.1;
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

/**
 * Starts a new correction episode when the operator reverses direction. A mix
 * of adds and subtracts is an adjustment to the counters, not reliable speed
 * evidence, so it must not reuse stale corrections from the prior episode.
 */
export function recordPackagingSpeedCorrection(
  tracking: PackagingSpeedNudgeTracking,
  deltaCases: number,
): PackagingSpeedNudgeTracking {
  const direction = directionOf(deltaCases);
  if (direction === 0) return tracking;

  const priorDirection = directionOf(tracking.corrections.at(-1)?.deltaCases ?? 0);
  const corrections = (
    priorDirection !== 0 && priorDirection !== direction
      ? []
      : tracking.corrections
  ).concat({ deltaCases }).slice(-MAX_CORRECTIONS);

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
  /** Total shown by the packaging counters after this correction. */
  displayedCases: number;
  elapsedOutputMin: number;
  configuredPpm: number;
  pizzasPerCase: number;
  speedAdjustment: number;
  isCrust: boolean;
  corrections: PackagingSpeedCorrection[];
};

/**
 * Returns a speed nudge only when a manual correction episode demonstrates at
 * least 10% drift from the configured line rate.
 *
 * Auto-track starts from the configured rate, so manual case corrections are
 * best understood as signed movement away from that expected output. Anchoring
 * the correction-adjusted observation to expected cases means a subtract can
 * prove slower output even while an earlier auto-track overcount leaves the
 * displayed total on pace (or ahead). The display remains useful evidence: if
 * it already shows a larger drift in the same direction, retain that stronger
 * signal instead.
 */
export function evaluatePackagingSpeedNudge(
  input: EvaluatePackagingSpeedNudgeInput,
): PackagingSpeedNudge | null {
  const {
    displayedCases,
    elapsedOutputMin,
    configuredPpm,
    pizzasPerCase,
    speedAdjustment,
    isCrust,
    corrections,
  } = input;

  if (
    elapsedOutputMin < MIN_OUTPUT_MINUTES ||
    !Number.isFinite(elapsedOutputMin) ||
    !Number.isFinite(configuredPpm) ||
    !Number.isFinite(pizzasPerCase) ||
    configuredPpm <= 0 ||
    pizzasPerCase <= 0 ||
    corrections.length === 0
  ) {
    return null;
  }

  const direction = directionOf(corrections[0]?.deltaCases ?? 0);
  if (
    direction === 0 ||
    corrections.some((correction) => directionOf(correction.deltaCases) !== direction)
  ) {
    return null;
  }

  const expectedCases = (elapsedOutputMin * configuredPpm) / pizzasPerCase;
  if (!Number.isFinite(expectedCases) || expectedCases <= 0) return null;

  const cumulativeCorrectionCases = corrections.reduce(
    (total, correction) => total + correction.deltaCases,
    0,
  );
  const correctionDriftRatio = Math.abs(cumulativeCorrectionCases) / expectedCases;
  const hasRepeatedCorrection = corrections.length >= 2;

  // A single full-skid correction can itself be enough evidence of a 10% rate
  // error. Smaller edits need a repeated same-direction episode before they can
  // become a nudge, and every nudge still has to clear the 10% drift threshold.
  if (!hasRepeatedCorrection && correctionDriftRatio < MIN_DRIFT_RATIO) return null;

  const correctionAdjustedCases = Math.max(
    0,
    expectedCases + cumulativeCorrectionCases,
  );
  const safeDisplayedCases = Math.max(0, Number(displayedCases) || 0);
  const observedCases = direction > 0
    ? Math.max(safeDisplayedCases, correctionAdjustedCases)
    : Math.min(safeDisplayedCases, correctionAdjustedCases);
  const driftRatio = observedCases / expectedCases;

  if (
    !Number.isFinite(driftRatio) ||
    Math.abs(driftRatio - 1) + Number.EPSILON < MIN_DRIFT_RATIO ||
    (direction > 0 && driftRatio <= 1) ||
    (direction < 0 && driftRatio >= 1)
  ) {
    return null;
  }

  const observedPpm = (observedCases * pizzasPerCase) / elapsedOutputMin;
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
    value,
    isCrust,
    direction: direction > 0 ? "faster" : "slower",
  };
}