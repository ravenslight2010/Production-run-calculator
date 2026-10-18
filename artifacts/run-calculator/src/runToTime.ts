export const DEFAULT_RUN_TO_TIME = "19:15";

/** Convert a user-entered 24-hour or AM/PM time to the synced HH:MM value. */
export function parseRunToTimeInput(input: string): string | null {
  const value = input.trim();
  const twentyFourHour = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (twentyFourHour) return `${twentyFourHour[1]}:${twentyFourHour[2]}`;

  const twelveHour = /^(0?[1-9]|1[0-2]):([0-5]\d)\s*(AM|PM)$/i.exec(value);
  if (!twelveHour) return null;

  const hour = Number(twelveHour[1]) % 12 + (twelveHour[3].toUpperCase() === "PM" ? 12 : 0);
  return `${String(hour).padStart(2, "0")}:${twelveHour[2]}`;
}

/** Display synced HH:MM values in the familiar local 12-hour form. */
export function formatRunToTimeInput(value: string): string {
  const normalized = parseRunToTimeInput(value);
  if (!normalized) return value;

  const [rawHour, minute] = normalized.split(":");
  const hour = Number(rawHour);
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? "PM" : "AM"}`;
}

/** Minutes until today's target; an elapsed target is already reached, not tomorrow. */
export function minutesUntilRunToTime(value: string, now: Date): number {
  const normalized = parseRunToTimeInput(value);
  if (!normalized || Number.isNaN(now.getTime())) return 0;

  const [hour, minute] = normalized.split(":").map(Number);
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  return Math.max(0, (target.getTime() - now.getTime()) / 60_000);
}
