// Client-side profile-write access contract.
//
// Profile writes (save/delete of brand+flavor setup profiles) are gated on the
// `manage-profiles` capability — NOT the `manage-staff`-derived `isManager`
// alias — so a custom role granted only `manage-profiles` can save profiles,
// and a role with `manage-staff` but without `manage-profiles` cannot. This
// mirrors the server's requireCapability("manage-profiles") gate on
// POST/DELETE /api/brand-profiles exactly.
//
import { describe, it, expect, afterEach } from "vitest";
import {
  CAPABILITIES as WEB_CAPABILITIES,
  CAPABILITY_LABELS as WEB_LABELS,
  type Capability,
} from "./inventoryShared";
import {
  saveProfile,
  deleteProfileEntry,
  relinkCheeseSlotsToMixInProfiles,
  rewriteDieTypeInProfiles,
  setProfileWritesAllowed,
  loadProfile,
  defaultValues,
} from "./storage";

// The predicate the client-side profile-write gate uses (home.tsx
// canManageProfiles): capability membership.
function canManageProfiles(capabilities: Capability[]): boolean {
  return capabilities.includes("manage-profiles");
}

describe("manage-profiles capability contract", () => {
  it("is a known web capability with a label", () => {
    expect(WEB_CAPABILITIES).toContain("manage-profiles");
    expect(WEB_LABELS["manage-profiles"]).toBeTruthy();
  });

  it("every web capability has a label", () => {
    expect(Object.keys(WEB_LABELS).sort()).toEqual([...WEB_CAPABILITIES].sort());
  });

  it("a custom role with manage-profiles but NOT manage-staff may write profiles", () => {
    expect(canManageProfiles(["manage-profiles"])).toBe(true);
  });

  it("a role with manage-staff but NOT manage-profiles may not write profiles", () => {
    // isManager (manage-staff) alone is NOT enough — the gate is the
    // capability, matching the server exactly.
    expect(canManageProfiles(["manage-staff"])).toBe(false);
    // A manage-inventory-only role (e.g. the seeded inventory role) can reach
    // Move-to-Mixes and rename flows but must NOT write profiles.
    expect(canManageProfiles(["manage-inventory"])).toBe(false);
    expect(canManageProfiles([])).toBe(false);
  });
});

describe("central profile-write gate (setProfileWritesAllowed)", () => {
  // Simulates a manage-inventory-only (non-manage-profiles) session: Home
  // flips the storage-level gate off, and EVERY profile-writing helper —
  // including ones reached from components that don't know about
  // capabilities (Move-to-Mixes relink, rename fan-outs) — must become a
  // no-op: no local blob mutation, no queued server write.

  const QUEUE_KEY = "run-calc-profilesync-queue-v1";

  function queueLen(): number {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as unknown[]).length : 0;
  }

  afterEach(() => {
    setProfileWritesAllowed(true);
    localStorage.clear();
  });

  it("blocks saveProfile / delete / relink / rename fan-out when off", () => {
    localStorage.clear();
    setProfileWritesAllowed(true);
    const vals = { ...defaultValues, dieType: "Round 12" };
    expect(saveProfile("Acme", "Pepperoni", vals)).toBe(true);
    const before = localStorage.getItem("run-calc-profile-acme__pepperoni");
    expect(before).toBeTruthy();
    localStorage.removeItem(QUEUE_KEY);

    setProfileWritesAllowed(false);
    // Direct save is a no-op.
    expect(saveProfile("Acme", "Pepperoni", { ...vals, dieType: "Square 9" })).toBe(false);
    expect(localStorage.getItem("run-calc-profile-acme__pepperoni")).toBe(before);
    // Rename fan-out is a no-op.
    rewriteDieTypeInProfiles("Round 12", "Renamed Die");
    expect(localStorage.getItem("run-calc-profile-acme__pepperoni")).toBe(before);
    // Move-to-Mixes relink is a no-op.
    expect(relinkCheeseSlotsToMixInProfiles("Some Mix")).toBe(0);
    // Delete is a no-op.
    deleteProfileEntry("Acme", "Pepperoni");
    expect(localStorage.getItem("run-calc-profile-acme__pepperoni")).toBe(before);
    // Nothing was queued for the server.
    expect(queueLen()).toBe(0);

    // Manager device: gate on again, writes work.
    setProfileWritesAllowed(true);
    expect(saveProfile("Acme", "Pepperoni", { ...vals, dieType: "Square 9" })).toBe(true);
    const loaded = loadProfile("Acme", "Pepperoni");
    expect(loaded?.dieType).toBe("Square 9");
  });
});
