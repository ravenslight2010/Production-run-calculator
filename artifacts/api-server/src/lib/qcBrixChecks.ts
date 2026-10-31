export type QcBrixOutcome = "pass" | "fail" | "not-evaluated";

export function evaluateQcBrixCheck({
  actualBrix,
  targetBrix,
  toleranceBrix,
}: {
  actualBrix: number;
  targetBrix: number | null;
  toleranceBrix: number | null;
}): QcBrixOutcome {
  if (
    !Number.isFinite(actualBrix)
    || actualBrix < 0
    || actualBrix > 100
    || targetBrix === null
    || !Number.isFinite(targetBrix)
    || targetBrix < 0
    || targetBrix > 100
    || toleranceBrix === null
    || !Number.isFinite(toleranceBrix)
    || toleranceBrix < 0
    || toleranceBrix > 100
  ) {
    return "not-evaluated";
  }

  const difference = Math.abs(actualBrix - targetBrix);
  // Decimals such as 7.3 - 7.5 can land a few binary ULPs beyond an
  // otherwise exact inclusive boundary. This is machine-rounding allowance,
  // not an additional measurement tolerance.
  const roundingAllowance =
    Number.EPSILON * Math.max(1, Math.abs(actualBrix), Math.abs(targetBrix), toleranceBrix) * 2;
  return difference <= toleranceBrix + roundingAllowance ? "pass" : "fail";
}
