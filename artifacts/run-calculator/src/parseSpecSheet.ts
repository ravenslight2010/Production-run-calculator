// AI spec-sheet parser for Excel imports — web platform glue.
//
// The read-only POST /ai/parse-spec-sheet endpoint takes the flattened workbook
// text plus the app's known canonical lists and learned aliases, and returns
// structured spec profiles + dough/sauce/cheese recipes (the model reuses a
// known name verbatim when the workbook clearly means it, so existing
// profiles/recipes are updated rather than duplicated). The server sanitizes the
// result; this client just forwards it. On any failure (AI unavailable, not a
// manager) the caller surfaces the error — there is no usable fallback for a
// free-form spreadsheet.
//
// This module NEVER writes anything. Mirrors the mobile glue in
// artifacts/run-calculator-mobile/context/parseSpecSheet.ts (replit.md parity).
//
// Rate-limit constants (server: 10 req / 60 s per user).  Exported so
// parseWorkbookCore and tests can share them.
/** Server rate-limit window in ms (slightly over 60 s for clock skew). */
export const PARSE_RATE_WINDOW_MS = 62_000;
/** Max parse calls to send within one window — keeps headroom for retries. */
export const PARSE_PACE_SAFE_MAX = 8;

/**
 * Thrown by requestParseSpecSheet when the server returns HTTP 429.
 * parseWorkbookCore catches this to pause and retry the affected chunk.
 */
export class ParseSpecRateLimitError extends Error {
  constructor(detail?: string) {
    super(detail || "Too many spec-parse requests — please wait a moment");
    this.name = "ParseSpecRateLimitError";
  }
}

/**
 * Creates a per-import sliding-window rate pacer.  Await `pace()` before
 * every requestParseSpecSheet call; it sleeps when PARSE_PACE_SAFE_MAX calls
 * have already been issued within the current PARSE_RATE_WINDOW_MS window.
 *
 * Injectable `now` is provided for deterministic testing with fake timers.
 */
export function makeParseCallPacer(opts?: {
  windowMs?: number;
  maxCalls?: number;
  now?: () => number;
}): () => Promise<void> {
  const windowMs = opts?.windowMs ?? PARSE_RATE_WINDOW_MS;
  const maxCalls = opts?.maxCalls ?? PARSE_PACE_SAFE_MAX;
  const getNow = opts?.now ?? (() => Date.now());
  const timestamps: number[] = [];

  return async function pace(): Promise<void> {
    const now = getNow();
    const cutoff = now - windowMs;
    while (timestamps.length && timestamps[0] < cutoff) timestamps.shift();
    if (timestamps.length >= maxCalls) {
      // Sleep until the oldest call exits the window (+ 100 ms buffer).
      const waitMs = timestamps[0] + windowMs - now + 100;
      if (waitMs > 0) await new Promise<void>((r) => setTimeout(r, waitMs));
      const newCutoff = getNow() - windowMs;
      while (timestamps.length && timestamps[0] < newCutoff) timestamps.shift();
    }
    timestamps.push(getNow());
  };
}

import type {
  ParsedSpecImport,
  ParsedProfile,
  ParsedRecipe,
  SpecImportAlias,
} from "@workspace/spec-import";
import type { ReviewVerdict } from "@workspace/ai-review";
import { inventoryClientId } from "./inventoryShared";
import { fetchWithTimeout } from "./fetchWithTimeout";

export type SpecSheetKnown = {
  brands?: string[];
  flavorsByBrand?: Record<string, string[]>;
  appTypes?: string[];
  pepTypes?: string[];
  cheeseIngredients?: string[];
  doughIngredients?: string[];
  sauceIngredients?: string[];
  /** Existing sauce/frontline recipe names (incl. ready-made sauces) to ground profile sauceName. */
  sauceNames?: string[];
  dieTypes?: string[];
  /** Existing recipe names per kind — grounds paraphrased recipe names so a
   * near-match snaps to (or is flagged against) the existing recipe instead of
   * importing as a silent near-duplicate. */
  doughRecipes?: string[];
  sauceRecipes?: string[];
  cheeseRecipes?: string[];
};

export type ParseSpecSheetInput = {
  workbookText: string;
  known?: SpecSheetKnown;
  aliases?: SpecImportAlias[];
};

export type ReviewedProfile = ParsedProfile & { review?: ReviewVerdict };
export type ReviewedRecipe = ParsedRecipe & { review?: ReviewVerdict };

export type ParseSpecSheetResult = Omit<ParsedSpecImport, "profiles" | "recipes"> & {
  profiles: ReviewedProfile[];
  recipes: ReviewedRecipe[];
  generatedAt: number;
};

export async function requestParseSpecSheet(
  input: ParseSpecSheetInput,
): Promise<ParseSpecSheetResult> {
  // Generous bound — the AI parse legitimately runs 30-60s — but finite, so a
  // request that hangs at the platform edge (cold-starting deployment) surfaces
  // a clear retryable error instead of freezing the loading dialog forever.
  const res = await fetchWithTimeout(
    "/api/ai/parse-spec-sheet",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-client-id": inventoryClientId(),
      },
      body: JSON.stringify(input),
    },
    180_000,
  );
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { error?: string }).error ?? "";
    } catch {}
    if (res.status === 429) throw new ParseSpecRateLimitError(detail);
    throw new Error(detail || `Parse-spec-sheet request failed (${res.status})`);
  }
  return (await res.json()) as ParseSpecSheetResult;
}
