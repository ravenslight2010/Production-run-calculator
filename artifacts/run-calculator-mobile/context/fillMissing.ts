// "Fill in missing data" assistant — mobile platform glue.
//
// The pure detection + proposal logic lives in the shared @workspace/fill-missing
// lib (one source of truth for web + mobile, replit.md parity rule). This module
// re-exports that logic and adds the only mobile-specific parts: how the known
// sources are read (brandProfiles + SPEC_PROFILES) and how the read-only
// /ai/fill-missing fetch is authenticated.
//
// This module NEVER writes anything. The UI commits confirmed values through the
// existing update paths (updateRunSettingsById / saveRecipePreset); there is no
// auto-apply.

import type {
  FillMissingInput,
  FillMissingResult,
  KnownLookup,
  LearnedValueRow,
} from "@workspace/fill-missing";
import { pickLearnedForProduct } from "@workspace/fill-missing";
import { getAuthToken } from "@workspace/api-client-react";
import { SPEC_PROFILES } from "@/data/specSeed";
import { profileKey, type RunProfile } from "./RunContext";
import { getApiBaseUrl, getOrCreateClientId } from "./sync/client";
import { InventoryApiError, photoErrorMessage } from "./inventoryShared";

export * from "@workspace/fill-missing";

type Rec = Record<string, unknown>;

// ── Learned values (server-persisted, factory-wide) ──────────────────────────
// When a user confirms a value for a blank field, it is saved here so future
// scans of the same product propose it as a top-priority "learned" source — the
// same pattern as learned import aliases. Best-effort: any failure silently
// proceeds without learned values. Mirrors the web glue (replit.md parity).

export async function fetchFillMissingValues(): Promise<LearnedValueRow[]> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("No API base URL (sync disabled)");
  const clientId = await getOrCreateClientId();
  const token = await getAuthToken();
  const res = await fetch(`${base}/api/fill-missing-values`, {
    headers: {
      "x-client-id": clientId,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`List fill-missing values failed (${res.status})`);
  const data = (await res.json()) as { values: LearnedValueRow[] };
  return data.values ?? [];
}

export async function saveFillMissingValues(values: LearnedValueRow[]): Promise<void> {
  if (values.length === 0) return;
  const base = getApiBaseUrl();
  if (!base) throw new Error("No API base URL (sync disabled)");
  const clientId = await getOrCreateClientId();
  const token = await getAuthToken();
  const res = await fetch(`${base}/api/fill-missing-values`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": clientId,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ values }),
  });
  if (!res.ok) throw new Error(`Save fill-missing values failed (${res.status})`);
}

export async function requestFillMissing(input: FillMissingInput): Promise<FillMissingResult> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("No API base URL (sync disabled)");
  const clientId = await getOrCreateClientId();
  const token = await getAuthToken();
  const res = await fetch(`${base}/api/ai/fill-missing`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": clientId,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

// ── Mobile known-source lookup ───────────────────────────────────────────────
// Builds a KnownLookup from this run's saved profile (brandProfiles) + the spec
// seed. Web has its own equivalent reading loadProfile + SPEC_PROFILES.
export function makeMobileLookup(
  brandProfiles: Record<string, RunProfile>,
  brand: string,
  flavor: string,
  learnedValues: ReadonlyArray<LearnedValueRow> = [],
): KnownLookup {
  const key = profileKey(brand, flavor);
  const profile = brandProfiles[key];
  const specProfile = SPEC_PROFILES[key];
  const learned = pickLearnedForProduct(learnedValues, brand, flavor);
  return (fieldKey) => {
    const profVal = profile ? (profile as unknown as Rec)[fieldKey] : undefined;
    const specVal = specProfile ? (specProfile as unknown as Rec)[fieldKey] : undefined;
    return {
      learned: learned[fieldKey],
      profile: profVal as string | number | undefined,
      spec: specVal as string | number | undefined,
    };
  };
}
