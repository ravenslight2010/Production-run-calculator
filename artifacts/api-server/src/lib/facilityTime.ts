export const DEFAULT_FACILITY_TIME_ZONE = "America/Chicago";

export function facilityTimeZone(): string {
  const configured = process.env.FACILITY_TIME_ZONE?.trim() || DEFAULT_FACILITY_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: configured }).format(new Date());
    return configured;
  } catch {
    return DEFAULT_FACILITY_TIME_ZONE;
  }
}

export function dateInTimeZone(nowMs: number, timeZone = facilityTimeZone()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(nowMs));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function facilityDate(nowMs = Date.now()): string {
  return dateInTimeZone(nowMs, facilityTimeZone());
}