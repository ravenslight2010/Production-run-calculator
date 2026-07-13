import { describe, it, expect, beforeEach } from "vitest";
import { saveProfile, loadProfile } from "./storage";
import { DEFAULT_VALUES, PROFILE_KEY, CRUST_PROFILE_KEY } from "./types";
import type { FormValues } from "./types";

// The stale-form guard in saveProfile: a nav-save of a form that is UNCHANGED
// since some loadProfile call must never republish old values over a newer
// copy adopted from the server pool — even when ANOTHER reader called
// loadProfile again (and refreshed the snapshot) after the adoption. A single
// latest-only snapshot failed exactly that case.

const BRAND = "Snapshot Brand";
const FLAVOR = "Guard Flavor";

function form(over: Partial<FormValues>): FormValues {
  return { ...DEFAULT_VALUES, ...over } as FormValues;
}

// What the server-pool reconcile does when it adopts a newer copy: write the
// raw blobs straight into localStorage (bypassing saveProfile).
function adoptFromServer(doughBlob: Record<string, unknown>): void {
  localStorage.setItem(PROFILE_KEY(BRAND, FLAVOR), JSON.stringify(doughBlob));
  localStorage.setItem(CRUST_PROFILE_KEY(BRAND, FLAVOR), JSON.stringify({}));
}

function storedDoughName(): string | undefined {
  const raw = localStorage.getItem(PROFILE_KEY(BRAND, FLAVOR));
  if (!raw) return undefined;
  return (JSON.parse(raw) as Record<string, unknown>).doughRecipeName as string | undefined;
}

describe("saveProfile stale-form snapshot guard", () => {
  beforeEach(() => localStorage.clear());

  it("an unchanged form does not republish over a server-adopted newer copy, even after another loadProfile refreshed the snapshot", () => {
    saveProfile(BRAND, FLAVOR, form({ dieType: "12 inch", doughRecipeName: "V1" }));
    // The open form loads V1 (snapshot recorded).
    const staleForm = loadProfile(BRAND, FLAVOR)!;
    expect(staleForm.doughRecipeName).toBe("V1");

    // A newer copy arrives from the server pool…
    adoptFromServer({ dieType: "12 inch", doughRecipeName: "V2" });
    // …and some OTHER reader (editor open, backfill, heal) loads it, which
    // refreshes the in-memory snapshot for this key.
    const fresh = loadProfile(BRAND, FLAVOR)!;
    expect(fresh.doughRecipeName).toBe("V2");

    // Nav-save of the untouched stale form must be a no-op.
    saveProfile(BRAND, FLAVOR, staleForm);
    expect(storedDoughName()).toBe("V2");
  });

  it("a genuine user edit still saves after a server-adopted copy", () => {
    saveProfile(BRAND, FLAVOR, form({ dieType: "12 inch", doughRecipeName: "V1" }));
    const openForm = loadProfile(BRAND, FLAVOR)!;
    adoptFromServer({ dieType: "12 inch", doughRecipeName: "V2" });
    loadProfile(BRAND, FLAVOR);

    const edited = { ...openForm, doughRecipeName: "User Edit" } as FormValues;
    saveProfile(BRAND, FLAVOR, edited);
    expect(storedDoughName()).toBe("User Edit");
  });

  it("still saves when the stored blob was wiped even though the form matches an old snapshot", () => {
    saveProfile(BRAND, FLAVOR, form({ dieType: "12 inch", doughRecipeName: "V1" }));
    const openForm = loadProfile(BRAND, FLAVOR)!;

    // Factory reset / deletion wiped the local copy; the unchanged form must
    // be allowed to persist again or the profile silently never re-saves.
    localStorage.removeItem(PROFILE_KEY(BRAND, FLAVOR));
    localStorage.removeItem(CRUST_PROFILE_KEY(BRAND, FLAVOR));
    saveProfile(BRAND, FLAVOR, openForm);
    expect(storedDoughName()).toBe("V1");
  });
});
