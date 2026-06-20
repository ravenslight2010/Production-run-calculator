// Shared cross-feature "corrections memory" logic. Pure and dependency-free so
// both clients, the server, and tests use exactly the same rules.
//
// A correction is a confirmed mapping "this messy name really means that
// canonical name", tagged by `domain` (ingredient / brand / flavor / die /
// item). The whole pool is fed into every name-resolving AI prompt so a fix
// staff make in one helper is honored by all of them.

export const MAX_CORRECTION_TEXT_LEN = 200;
export const DEFAULT_PROMPT_CORRECTION_LIMIT = 200;

export interface AiCorrection {
  domain: string;
  fromText: string;
  toText: string;
}

// Case-insensitive identity for a correction: same domain + same source name.
export function correctionKey(domain: string, fromText: string): string {
  return `${domain.trim().toLowerCase()}::${fromText.trim().toLowerCase()}`;
}

// Clean an untrusted/raw batch of corrections: trim, cap length, drop blanks,
// drop self-references (a mapping that restates the same name carries no info),
// and dedupe by identity key (last write wins). Optionally bound the count.
export function normalizeCorrections(
  raw: ReadonlyArray<Partial<AiCorrection> | null | undefined> | null | undefined,
  opts: { maxLen?: number; limit?: number } = {},
): AiCorrection[] {
  const maxLen = opts.maxLen ?? MAX_CORRECTION_TEXT_LEN;
  const byKey = new Map<string, AiCorrection>();
  for (const c of raw ?? []) {
    if (!c || typeof c !== "object") continue;
    const domain = (typeof c.domain === "string" ? c.domain : "").trim().slice(0, maxLen);
    const fromText = (typeof c.fromText === "string" ? c.fromText : "").trim().slice(0, maxLen);
    const toText = (typeof c.toText === "string" ? c.toText : "").trim().slice(0, maxLen);
    if (!domain || !fromText || !toText) continue;
    if (fromText.toLowerCase() === toText.toLowerCase()) continue;
    byKey.set(correctionKey(domain, fromText), { domain, fromText, toText });
  }
  let out = [...byKey.values()];
  if (typeof opts.limit === "number" && opts.limit >= 0 && out.length > opts.limit) {
    out = out.slice(0, opts.limit);
  }
  return out;
}

// Keep only corrections whose domain is in the allow-list (case-insensitive).
export function filterCorrectionsByDomain(
  corrections: ReadonlyArray<AiCorrection>,
  domains: ReadonlyArray<string>,
): AiCorrection[] {
  const set = new Set(domains.map((d) => d.trim().toLowerCase()));
  return corrections.filter((c) => set.has(c.domain.trim().toLowerCase()));
}

// Render a compact prompt block from the shared pool. Returns "" when empty so
// callers can append unconditionally. `corrections` should already be in
// priority order (most useful first); only the first `limit` are included.
export function buildCorrectionsBlock(
  corrections: ReadonlyArray<AiCorrection>,
  opts: { limit?: number; heading?: string } = {},
): string {
  const limit = opts.limit ?? DEFAULT_PROMPT_CORRECTION_LIMIT;
  const list = limit >= 0 ? corrections.slice(0, limit) : [...corrections];
  if (list.length === 0) return "";
  const heading =
    opts.heading ??
    "GLOBAL KNOWN CORRECTIONS (confirmed by staff across the whole app — read " +
      "the first name as the second whenever the first appears; honor these):";
  const lines = list.map((c) => `  - [${c.domain}] "${c.fromText}" => "${c.toText}"`);
  return [heading, ...lines].join("\n");
}
