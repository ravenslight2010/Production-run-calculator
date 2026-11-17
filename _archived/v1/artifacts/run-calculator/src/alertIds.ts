/** Matches the server's opaque stable alert ID format without exposing run text. */
export async function stableAlertId(
  runId: string,
  generation: number,
  suffix: string,
  day: string | Date = new Date(),
): Promise<string> {
  const date = typeof day === "string" ? day : day.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid alert day.");
  // A scheduled run ID can be reused after reset. Include the canonical start
  // timestamp so the replacement run does not inherit the prior run's receipts.
  const bytes = new TextEncoder().encode(`${runId}:${generation}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("").slice(0, 24);
  return `${date}:${hash}:${suffix}`;
}