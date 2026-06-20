// "Fill in missing data" assistant — web platform glue.
//
// The pure detection + proposal logic lives in the shared @workspace/fill-missing
// lib (one source of truth for web + mobile, replit.md parity rule). This module
// re-exports that logic and adds the only web-specific parts: how the known
// sources are read (loadProfile + SPEC_PROFILES) and how the read-only
// /ai/fill-missing fetch is authenticated.
//
// This module NEVER writes anything. The UI commits confirmed values through the
// existing update paths; there is no auto-apply.

import type {
  FillMissingInput,
  FillMissingResult,
  FillMissingSuggestion,
  KnownLookup,
  LearnedValueRow,
} from "@workspace/fill-missing";
import { pickLearnedForProduct } from "@workspace/fill-missing";
import type { ReviewVerdict } from "@workspace/ai-review";
import { SPEC_PROFILES } from "./specSeed";
import { loadProfile } from "./storage";
import { InventoryApiError, inventoryClientId, photoErrorMessage } from "./inventoryShared";

export * from "@workspace/fill-missing";

type Rec = Record<string, unknown>;

// ── Learned values (server-persisted, factory-wide) ──────────────────────────
// When a user confirms a value for a blank field, it is saved here so future
// scans of the same product propose it as a top-priority "learned" source — the
// same pattern as learned import aliases. Best-effort: any failure silently
// proceeds without learned values. Mirrors the mobile glue (replit.md parity).

export async function fetchFillMissingValues(): Promise<LearnedValueRow[]> {
  const res = await fetch("/api/fill-missing-values", {
    headers: { "x-client-id": inventoryClientId() },
  });
  if (!res.ok) throw new Error(`List fill-missing values failed (${res.status})`);
  const data = (await res.json()) as { values: LearnedValueRow[] };
  return data.values ?? [];
}

export async function saveFillMissingValues(values: LearnedValueRow[]): Promise<void> {
  if (values.length === 0) return;
  const res = await fetch("/api/fill-missing-values", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": inventoryClientId(),
    },
    body: JSON.stringify({ values }),
  });
  if (!res.ok) throw new Error(`Save fill-missing values failed (${res.status})`);
}

// The server attaches a reviewer-AI verdict to each suggestion (advisory). The
// shared lib type doesn't carry it, so widen the result here for the UI.
export type ReviewedFillMissingSuggestion = FillMissingSuggestion & { review?: ReviewVerdict };
export type ReviewedFillMissingResult = Omit<FillMissingResult, "suggestions"> & {
  suggestions: ReviewedFillMissingSuggestion[];
};

export async function requestFillMissing(
  input: FillMissingInput,
): Promise<ReviewedFillMissingResult> {
  const res = await fetch("/api/ai/fill-missing", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": inventoryClientId(),
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const retryAfterRaw = res.headers.get("Retry-After");
    const retryAfterSec =
      retryAfterRaw != null && Number.isFinite(Number(retryAfterRaw)) ? Number(retryAfterRaw) : null;
    let serverMessage: string | null = null;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (body && typeof body.error === "string") serverMessage = body.error;
    } catch {
      // non-JSON error body; ignore
    }
    throw new InventoryApiError(
      res.status,
      `Fill-missing request failed (${res.status})`,
      retryAfterSec,
      serverMessage,
    );
  }
  return (await res.json()) as ReviewedFillMissingResult;
}

export const fillMissingErrorMessage = photoErrorMessage;

// ── Web known-source lookup ──────────────────────────────────────────────────
// Builds a KnownLookup from this run's learned values (server-persisted) + saved
// profile + the spec seed. Mobile has its own equivalent reading the same learned
// list + brandProfiles + SPEC_PROFILES.
export function makeWebLookup(
  brand: string,
  flavor: string,
  learnedValues: ReadonlyArray<LearnedValueRow> = [],
): KnownLookup {
  const profile = brand || flavor ? loadProfile(brand, flavor) : null;
  const specProfile = SPEC_PROFILES.find(
    (p) =>
      p.brand.toLowerCase() === brand.toLowerCase() &&
      p.flavor.toLowerCase() === flavor.toLowerCase(),
  );
  const learned = pickLearnedForProduct(learnedValues, brand, flavor);
  return (key) => {
    const profVal = profile ? (profile as unknown as Rec)[key] : undefined;
    const specVal = specProfile ? (specProfile.values as Rec)[key] : undefined;
    return {
      learned: learned[key],
      profile: profVal as string | number | undefined,
      spec: specVal as string | number | undefined,
    };
  };
}
