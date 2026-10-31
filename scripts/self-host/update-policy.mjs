// A fail-closed planning contract, NOT an updater or a signature verifier.
// No shell, Docker, network, DB, or filesystem writes occur here.
const imageRoles = ["api", "web"];
const sha = /^[a-f0-9]{40}$/;
export function validateRelease(release) {
  if (!release || release.version !== 1 || release.repository !== "ravenslight2010/Production-run-calculator" ||
      release.channel !== "main" || !sha.test(release.sourceCommit ?? "") ||
      typeof release.schema !== "string" || !release.schema.trim())
    throw new Error("Invalid release identity");
  for (const role of imageRoles) {
    const pattern = new RegExp(`^ghcr\\.io/ravenslight2010/production-run-calculator-${role}@sha256:[a-f0-9]{64}$`);
    if (!pattern.test(release.images?.[role] ?? "")) throw new Error(`Invalid immutable ${role} image`);
  }
  return release;
}

export function localClock(now, timeZone) {
  if (!timeZone) throw new Error("Facility timezone is required");
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid clock");
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date).map(part => [part.type, part.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, minute: Number(p.hour) * 60 + Number(p.minute) };
}

export function planUpdate({ now, timeZone, release, installed, evidence = {} }) {
  validateRelease(release);
  const clock = localClock(now, timeZone);
  const reasons = [];
  if (clock.minute < 30 || clock.minute >= 270) reasons.push("outside-post-reset-window");
  if (installed?.sourceCommit === release.sourceCommit) reasons.push("already-current");
  if (!installed?.schema || installed.schema !== release.schema) reasons.push("schema-change-needs-reviewed-migration");
  if (evidence.signatureVerified !== true) reasons.push("release-signature-not-verified");
  if (evidence.clockSynchronized !== true) reasons.push("host-clock-not-verified");
  if (evidence.maintenanceLockHeld !== true) reasons.push("maintenance-lock-not-held");
  if (evidence.inFlightRequests !== 0 || evidence.pendingClientWrites !== 0) reasons.push("clients-not-quiescent");
  if (evidence.coreHealthy !== true) reasons.push("core-not-healthy");
  if (evidence.imagesCached !== true || evidence.rollbackImagesCached !== true) reasons.push("images-not-cached");
  for (const kind of ["reset", "backup"]) {
    const receipt = evidence[kind];
    const age = new Date(now).getTime() - new Date(receipt?.completedAt).getTime();
    const valid = receipt?.success === true && receipt?.installationId === installed?.installationId &&
      typeof installed?.installationId === "string" && installed.installationId.length > 0 &&
      receipt?.sourceCommit === installed?.sourceCommit && sha.test(installed?.sourceCommit ?? "") &&
      Number.isFinite(age) && age >= 0 && age <= (kind === "reset" ? 5 : 1) * 3600000 &&
      localClock(receipt.completedAt, timeZone).day === clock.day;
    if (!valid) reasons.push(`${kind}-receipt-missing-or-stale`);
    if (kind === "backup" && (!/^[a-f0-9]{64}$/.test(receipt?.sha256 ?? "") || receipt?.restoreVerified !== true))
      reasons.push("backup-not-restore-verified");
  }
  return { eligible: reasons.length === 0, reasons, facilityDay: clock.day,
    // Eligibility is not authorization. Caller must verify real evidence again.
    action: reasons.length ? "skip-without-changing-running-app" : "candidate-for-rehearsed-updater" };
}
