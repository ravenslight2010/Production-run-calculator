import { AiSuggestMergesBody } from "@workspace/api-zod";
import { sanitizeMergeSuggestions, type MergeSuggestion } from "@workspace/merge-suggest";
import * as z from "zod";

// Bounds so a single request can't blow up cost/latency. Mirrors the photo /
// optimize / fill-missing / parse-spec-sheet endpoint guards.
export const MAX_MERGE_NAMES = 4000;
export const MAX_MERGE_ALIASES = 4000;
export const MAX_MERGE_NAME_LEN = 200;

export type SuggestMergesInput = z.infer<typeof AiSuggestMergesBody>;

export type SuggestMergesValidationResult =
  | { ok: true; data: SuggestMergesInput }
  | { ok: false; status: number; error: string };

// Validate and bound-check the request body for POST /ai/suggest-merges. The
// returned `data` is fully sanitized (trimmed, blanks dropped, deduped
// case-insensitively, per-name length capped) so the count guard can't be
// bypassed with blank padding — both the prompt builder and the sanitizer
// consume this cleaned list, never the raw body.
export function validateSuggestMergesBody(body: unknown): SuggestMergesValidationResult {
  const parsed = AiSuggestMergesBody.safeParse(body);
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.message };
  }
  const data = parsed.data;

  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of data.names ?? []) {
    if (typeof raw !== "string") continue;
    const name = raw.trim().slice(0, MAX_MERGE_NAME_LEN);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }

  if (names.length === 0) {
    return { ok: false, status: 400, error: "No names to analyze" };
  }
  if (names.length > MAX_MERGE_NAMES) {
    return { ok: false, status: 400, error: `Too many names (max ${MAX_MERGE_NAMES})` };
  }

  // Sanitize aliases the same way; cap against the same per-request bound.
  const aliases = (data.aliases ?? [])
    .map((a) => ({
      externalName: (a.externalName ?? "").trim().slice(0, MAX_MERGE_NAME_LEN),
      canonicalName: (a.canonicalName ?? "").trim().slice(0, MAX_MERGE_NAME_LEN),
    }))
    .filter((a) => a.externalName && a.canonicalName);
  if (aliases.length > MAX_MERGE_ALIASES) {
    return { ok: false, status: 400, error: `Too many aliases (max ${MAX_MERGE_ALIASES})` };
  }

  return { ok: true, data: { ...data, names, aliases } };
}

// The model returns structured JSON but is not trustworthy — the lib's
// sanitizer keeps only groups built from names that actually exist, drops
// degenerate groups, dedupes, and bounds counts. Never throws.
export function sanitizeSuggestMerges(raw: unknown, names: string[]): MergeSuggestion[] {
  return sanitizeMergeSuggestions(raw, names);
}

// Shape the validated input into a compact, model-friendly prompt. Heavy shaping
// lives server-side (contract-first design) so both clients stay thin/identical.
export function buildSuggestMergesPrompt(input: SuggestMergesInput): {
  system: string;
  user: string;
} {
  const system =
    "You help a frozen-pizza factory app de-duplicate its ingredient list. You " +
    "are given the app's full pool of ingredient and cutter-die NAMES (one flat, " +
    "already-deduplicated list). Find clusters of names that clearly refer to the " +
    "SAME real-world thing — typos, abbreviations, spacing/case/punctuation " +
    "variants, singular/plural, or obvious synonyms (e.g. \"Mozz\" / \"Mozzarella\", " +
    "\"Peperoni\" / \"Pepperoni\", \"Tomato Sauce\" / \"Tomato  sauce\"). For each " +
    "cluster pick the single best canonical name to KEEP — prefer the most " +
    "complete, correctly-spelled, conventional spelling that already appears in " +
    "the list — and list the OTHER names in that cluster as the ones to merge " +
    "away. Be conservative: only group names you are confident are the same " +
    "ingredient. Do NOT group genuinely different ingredients (e.g. different " +
    "cheeses, different pepperoni cuts) just because the words overlap. Every " +
    "name you output (target and sources) MUST be copied VERBATIM from the " +
    "provided list — never invent or alter a name. Omit a name entirely if it has " +
    "no duplicate. This is read-only; the user reviews every suggestion before " +
    "anything is merged.";

  const lines: string[] = [];

  if (input.aliases && input.aliases.length) {
    lines.push(
      "KNOWN MERGE ALIASES (the user previously merged the first name into the " +
        "second — re-propose these whenever both still appear in the list):",
    );
    lines.push(
      input.aliases
        .map((a) => `  - "${a.externalName}" => "${a.canonicalName}"`)
        .join("\n"),
    );
    lines.push("");
  }

  lines.push("NAMES:");
  lines.push(input.names.map((n) => `  - ${n}`).join("\n"));

  lines.push("");
  lines.push(
    "Return ONLY JSON of the exact shape: " +
      '{"suggestions":[{"target":string,"sources":[string],"reason":string}],' +
      '"note":string}. ' +
      "Each group needs a target (the name to keep) and at least one source (a " +
      "different name to merge into it), all copied verbatim from NAMES. Use " +
      '"reason" for a brief per-group rationale and "note" only for an overall ' +
      "comment. Return an empty suggestions array if you find no confident " +
      "duplicates.",
  );

  return { system, user: lines.join("\n") };
}
