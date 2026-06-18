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
  KnownLookup,
} from "@workspace/fill-missing";
import { SPEC_PROFILES } from "./specSeed";
import { loadProfile } from "./storage";
import { InventoryApiError, inventoryClientId, photoErrorMessage } from "./inventoryShared";

export * from "@workspace/fill-missing";

type Rec = Record<string, unknown>;

export async function requestFillMissing(input: FillMissingInput): Promise<FillMissingResult> {
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
  return (await res.json()) as FillMissingResult;
}

export const fillMissingErrorMessage = photoErrorMessage;

// ── Web known-source lookup ──────────────────────────────────────────────────
// Builds a KnownLookup from this run's saved profile + the spec seed. Mobile has
// its own equivalent reading brandProfiles + SPEC_PROFILES.
export function makeWebLookup(brand: string, flavor: string): KnownLookup {
  const profile = brand || flavor ? loadProfile(brand, flavor) : null;
  const specProfile = SPEC_PROFILES.find(
    (p) =>
      p.brand.toLowerCase() === brand.toLowerCase() &&
      p.flavor.toLowerCase() === flavor.toLowerCase(),
  );
  return (key) => {
    const profVal = profile ? (profile as unknown as Rec)[key] : undefined;
    const specVal = specProfile ? (specProfile.values as Rec)[key] : undefined;
    return {
      profile: profVal as string | number | undefined,
      spec: specVal as string | number | undefined,
    };
  };
}
