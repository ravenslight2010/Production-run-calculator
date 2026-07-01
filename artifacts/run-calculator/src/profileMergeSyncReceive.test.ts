// @vitest-environment jsdom
//
// End-to-end sync-receive regression guard for brand/flavor profile deletion &
// merge. Brand+flavor profiles are keyed `${brandLc}__${flavorLc}` and pushed in
// the sync blob (`brandProfiles`/`crustProfiles`). When a brand (and its
// flavors) is deleted — or a brand/flavor name is merged away — a tombstone is
// recorded (deletion: `deletedItems["brands"]` + `flavor:<brandLc>`; merge: the
// flat `mergedAway` set). A stale peer that never saw the deletion/merge can
// still push a profile for that brand/flavor. The receive handler must DROP such
// profiles or the deleted/merged brand silently resurrects as ghost data.
//
// The web receive handler is inline in pages/home.tsx and not importable, so its
// profile-guard was extracted into an importable pure helper
// (`profileKeyIsTombstoned`, mirrors `acceptRemoteRunValueOnSync` /
// `dropTombstonedPresetKeys`). This test drives the REAL deletion/merge tombstone
// primitives + that extracted helper exactly as the receive handler wires them,
// so a future refactor that lets a tombstoned profile through fails here.

import { describe, it, expect, beforeEach } from "vitest";
import {
  tombstoneDeleted,
  flavorNamespace,
  loadDeletedItems,
  unionDeletedItems,
  loadMergedAway,
  saveMergedAway,
  profileKeyIsTombstoned,
} from "./storage";
import { PROFILE_KEY, CRUST_PROFILE_KEY } from "./types";

// Reproduce the profile receive loop of the home.tsx sync-receive handler, wired
// exactly as it wires it (see pages/home.tsx "Brand+flavor profiles" section).
// `payload` is a stale peer's incoming sync body.
function receiveSync(payload: {
  brandProfiles?: Record<string, Record<string, unknown>>;
  crustProfiles?: Record<string, Record<string, unknown>>;
  deletedItems?: Record<string, string[]>;
  mergedAway?: string[];
}) {
  // Merge tombstones (union remote + local): the local delete/merge tombstone
  // must survive even though the stale peer doesn't carry it.
  const mergedTomb = [...new Set([...loadMergedAway(), ...(payload.mergedAway ?? [])])];
  saveMergedAway(mergedTomb);
  const tombSet = new Set(mergedTomb.map((n) => n.trim().toLowerCase()));

  const deletedMap = unionDeletedItems(loadDeletedItems(), payload.deletedItems);

  if (payload.brandProfiles) {
    for (const [k, v] of Object.entries(payload.brandProfiles)) {
      if (profileKeyIsTombstoned(k, deletedMap, tombSet)) continue;
      try { localStorage.setItem(`run-calc-profile-${k}`, JSON.stringify(v)); } catch {}
    }
  }
  if (payload.crustProfiles) {
    for (const [k, v] of Object.entries(payload.crustProfiles)) {
      if (profileKeyIsTombstoned(k, deletedMap, tombSet)) continue;
      try { localStorage.setItem(`run-calc-crust-profile-${k}`, JSON.stringify(v)); } catch {}
    }
  }
}

const profileKey = (brand: string, flavor: string) =>
  `${brand.toLowerCase().trim()}__${flavor.toLowerCase().trim()}`;

beforeEach(() => {
  localStorage.clear();
});

describe("brand/flavor profile survives a stale incoming sync (receive path)", () => {
  it("does NOT resurrect a profile for a whole-brand deletion", () => {
    // Local device deleted the brand "Ghost" (real primitive: removeBrand
    // tombstones the brand name and each of its flavors).
    tombstoneDeleted("brands", "Ghost");
    tombstoneDeleted(flavorNamespace("Ghost"), "Original");

    // A stale peer that never saw the delete pushes the brand's profile back.
    receiveSync({
      brandProfiles: {
        [profileKey("Ghost", "Original")]: { doughRecipeName: "Ghost Dough" },
        [profileKey("Keep", "Classic")]: { doughRecipeName: "Keep Dough" },
      },
      crustProfiles: {
        [profileKey("Ghost", "Original")]: { crustRecipeName: "Ghost Crust" },
      },
      deletedItems: {},
    });

    // The deleted brand's dough + crust profiles are NOT written back.
    expect(localStorage.getItem(PROFILE_KEY("Ghost", "Original"))).toBeNull();
    expect(localStorage.getItem(CRUST_PROFILE_KEY("Ghost", "Original"))).toBeNull();
    // A non-tombstoned profile still comes through.
    expect(localStorage.getItem(PROFILE_KEY("Keep", "Classic"))).not.toBeNull();
  });

  it("does NOT resurrect a profile for a single deleted flavor (other flavors of the same brand survive)", () => {
    // Local device deleted only the "Spicy" flavor of "Brand" (removeFlavor
    // tombstones just that flavor under the brand's namespace).
    tombstoneDeleted(flavorNamespace("Brand"), "Spicy");

    receiveSync({
      brandProfiles: {
        [profileKey("Brand", "Spicy")]: { doughRecipeName: "Spicy Dough" },
        [profileKey("Brand", "Mild")]: { doughRecipeName: "Mild Dough" },
      },
      deletedItems: {},
    });

    // The deleted flavor's profile is dropped; the sibling flavor survives.
    expect(localStorage.getItem(PROFILE_KEY("Brand", "Spicy"))).toBeNull();
    expect(localStorage.getItem(PROFILE_KEY("Brand", "Mild"))).not.toBeNull();
  });

  it("does NOT resurrect a profile whose brand or flavor was merged away", () => {
    // A brand/flavor merge folds a name away and records it in the flat
    // mergedAway set. A stale peer pushes a profile keyed to the merged-away
    // brand and, separately, one keyed to a merged-away flavor.
    saveMergedAway(["oldbrand", "oldflavor"]);

    receiveSync({
      brandProfiles: {
        [profileKey("OldBrand", "AnyFlavor")]: { doughRecipeName: "X" },
        [profileKey("AnyBrand", "OldFlavor")]: { doughRecipeName: "Y" },
        [profileKey("LiveBrand", "LiveFlavor")]: { doughRecipeName: "Z" },
      },
      mergedAway: [],
    });

    expect(localStorage.getItem(PROFILE_KEY("OldBrand", "AnyFlavor"))).toBeNull();
    expect(localStorage.getItem(PROFILE_KEY("AnyBrand", "OldFlavor"))).toBeNull();
    expect(localStorage.getItem(PROFILE_KEY("LiveBrand", "LiveFlavor"))).not.toBeNull();
  });

  it("honors a tombstone the stale peer never carried (local tombstone survives the union)", () => {
    // Local delete, but the incoming payload carries NO tombstones at all — the
    // union of local + remote deletion tombstones must still block the profile.
    tombstoneDeleted("brands", "Gone");

    receiveSync({
      brandProfiles: { [profileKey("Gone", "Flavor")]: { doughRecipeName: "Nope" } },
      // deletedItems + mergedAway intentionally omitted (stale peer).
    });

    expect(localStorage.getItem(PROFILE_KEY("Gone", "Flavor"))).toBeNull();
    // The local tombstone is still present after the union.
    expect((loadDeletedItems()["brands"] ?? [])).toContain("gone");
  });

  it("still accepts a normal profile for a live brand/flavor (guard didn't over-restrict)", () => {
    // Sanity: with no relevant tombstones a normal profile push is written.
    receiveSync({
      brandProfiles: { [profileKey("Fresh", "New")]: { doughRecipeName: "Fresh Dough" } },
      crustProfiles: { [profileKey("Fresh", "New")]: { crustRecipeName: "Fresh Crust" } },
    });

    expect(localStorage.getItem(PROFILE_KEY("Fresh", "New"))).not.toBeNull();
    expect(localStorage.getItem(CRUST_PROFILE_KEY("Fresh", "New"))).not.toBeNull();
  });
});
