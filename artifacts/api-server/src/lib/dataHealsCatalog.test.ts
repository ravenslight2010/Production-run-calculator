import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { registeredAutomaticDataHeals } from "./dataHeals";
import {
  REPAIR_FINGERPRINT_SOURCE_CONTRACTS,
  repairDefinitionFingerprint,
} from "./repairDefinitionFingerprint";
import {
  releasedRepairFingerprints,
  renderReleasedRepairFingerprintManifest,
} from "./repairDefinitionFingerprintManifest";
import { RELEASED_AUTOMATIC_REPAIR_FINGERPRINTS } from "./repairDefinitionFingerprints.manifest";
import { liveProfileRecipeLinkRepairContract } from "./repairs/liveProfileRecipeLinkRepair";
import {
  CRB_DOUGH_LUCIA_VARIANT_CUSTOMERS_V2_REPAIR_ID,
  healCrbLuciaVariantCustomers,
} from "./repairs/mixDoughRepairs";
import {
  SOURCE_LIBRARY_RECONCILIATION_HEAL_ID,
  SOURCE_LIBRARY_RECONCILIATION_RERUN_HEAL_ID,
} from "./sourceLibraryReconciliationHeal";

describe("historical automatic repair registration", () => {
  it("preserves the released order and excludes manager commands from startup", () => {
    const repairs = registeredAutomaticDataHeals().list();
    const ids = repairs.map((repair) => repair.id);
    expect(ids).toEqual([
      "data-heal-result-backfill-v1",
      "ingredient-active-name-dedupe-v1",
      "live-profile-recipe-link-repair-v1",
      "crb-ingredient-conversion-v1",
      "crb-dough-family-consolidation-v1",
      "cheese-import-poison-cleanup-v1",
      "spec-alias-hygiene-purge-v1", "cheese-recipe-name-dedupe-v1", "generic-mix-poison-purge-v2",
      "cheese-named-mix-crossover-purge-v1", "cheese-share-backfill-v1", "cheese-oz-depoison-v1",
      "named-recipe-name-cleanup-v1", "dough-batch-yield-depoison-v1", "dough-family-weight-depoison-v1",
      "smd-pep-cheese-mix-restore-v1", "sea-salt-alias-undo-v1", "mix-duplicate-name-purge-v1",
      "purchased-crust-die-heal-v1", "dough-variant-suffix-dedupe-v1", "dough-merge-vanish-restore-v1",
      "bogus-merge-alias-purge-v1", "basha-hannaford-crosslink-parse-purge-v1", "aldo-cheese-tolerance-oz-v1",
      "bobo-cross-family-alias-undo-v1", "lowes-natural-pep-name-v1", "brand-fan-dough-depoison-v1",
      "brand-drift-rename-v1", "crb-dough-lucia-variant-customers-v2", "july-2026-profile-corrections-v1",
      "july-2026-audit-corrections-v2", "july-2026-audit-corrections-v3", "applicator-contamination-depoison-v1",
      "sync-row-name-registry-restore-v1", "brand-duplicate-purge-v1", "tunnel-pre-post-default-v1",
      "aug2026-import-fix-cheese-recipes-v1", "aug2026-import-fix-mixes-v1", "aug2026-import-fix-profiles-v1",
      "aug2026-import-fix-sauce-recipes-v1", "aug2026-cheese-recipe-lbs-v1",
      "aug2026-lowes-mix-stray-component-v1", "cheese-component-oz-strip-v1", "cheese-component-oz-strip-v2",
      "hannaford-tikka-masala-fix-v1",
      "profile-name-link-stub-purge-v1", "workbook-import-stub-purge-v1", "aug19-saved-spec-profile-repair-v1",
      "aug19-saved-spec-profile-repair-v2",
      "fresh-device-run-contamination-v1",
      "incident-resolved-workflow-reconciliation-v1",
      "source-library-reconciliation-2026-08-26-v1",
      "source-library-reconciliation-2026-08-26-v2",
    ]);
    expect(repairs.every((repair) => repair.mode === "automatic" && !repair.managerAllowed)).toBe(true);
    expect(repairs.every((repair) =>
      repair.executionMode === "runner-transactional" &&
      repair.resultOwnership === "runner-marker",
    )).toBe(true);
    expect(repairs.every((repair) => Object.isFrozen(repair))).toBe(true);
    repairs.forEach((repair, index) => expect(repair.dependencies).toEqual(index === 0 || index === 2 || index === 3
      ? [] : [ids[index - 1]]));
  });

  it("matches the reviewed released-definition fingerprint manifest", async () => {
    const repairs = registeredAutomaticDataHeals().list();
    const actual = releasedRepairFingerprints(repairs);

    const checkedIn = await readFile(
      new URL("./repairDefinitionFingerprints.manifest.ts", import.meta.url),
      "utf8",
    );
    expect(checkedIn).toBe(renderReleasedRepairFingerprintManifest(repairs));
    expect(REPAIR_FINGERPRINT_SOURCE_CONTRACTS[SOURCE_LIBRARY_RECONCILIATION_HEAL_ID])
      .toBeUndefined();
    expect(REPAIR_FINGERPRINT_SOURCE_CONTRACTS[SOURCE_LIBRARY_RECONCILIATION_RERUN_HEAL_ID])
      .toBeUndefined();
    expect(repairs
      .filter((candidate) =>
        candidate.id !== SOURCE_LIBRARY_RECONCILIATION_HEAL_ID &&
        candidate.id !== SOURCE_LIBRARY_RECONCILIATION_RERUN_HEAL_ID)
      .every((candidate) => REPAIR_FINGERPRINT_SOURCE_CONTRACTS[candidate.id] !== undefined))
      .toBe(true);

    const repair = registeredAutomaticDataHeals().list()
      .find((candidate) => candidate.id === liveProfileRecipeLinkRepairContract.id)!;
    const source = REPAIR_FINGERPRINT_SOURCE_CONTRACTS[repair.id];
    const baseline = repairDefinitionFingerprint(repair, source);

    expect(repairDefinitionFingerprint({
      ...repair,
      execute: async () => ({ changed: true }),
      validateResult: () => false,
    }, source)).toBe(baseline);
    expect(repairDefinitionFingerprint({
      ...repair,
      owner: `${repair.owner}-changed`,
    }, source)).not.toBe(baseline);
    expect(repairDefinitionFingerprint(repair, {
      ...source,
      repairs: [...liveProfileRecipeLinkRepairContract.repairs, {
        brand: "test", flavor: "test", field: "doughRecipeName", from: "old", to: "new",
      }],
    })).not.toBe(baseline);
  });

  it("drives every CRB Lucia assignment from its fingerprinted source contract", () => {
    const result = healCrbLuciaVariantCustomers([
      { label: "Basha's Ultra Thin", weightOz: 7.8, customers: [] },
      { label: "Lucia's Craft CRB Heavy Plus", weightOz: 12, customers: [] },
      {
        label: "Lucia's Craft CRB Thick",
        weightOz: 13.8,
        customers: [{ brand: "Lucia's Craft", flavor: "Wrong Flavor" }],
      },
    ]);
    expect(result.variants.map((variant) => variant.customers)).toEqual([
      [
        { brand: "Lucia's Craft", flavor: "Backyard BBQ Chicken" },
        { brand: "Lucia's Craft", flavor: "Sweet Chili Garden" },
      ],
      [{ brand: "Lucia's Craft", flavor: "Four Cheese Meltdown" }],
      [],
    ]);

    const repair = registeredAutomaticDataHeals().list()
      .find((candidate) => candidate.id === CRB_DOUGH_LUCIA_VARIANT_CUSTOMERS_V2_REPAIR_ID)!;
    const source = REPAIR_FINGERPRINT_SOURCE_CONTRACTS[repair.id];
    const baseline = repairDefinitionFingerprint(repair, source);
    for (const changedSource of [
      { ...source, recipeName: "Changed" },
      { ...source, customerBrand: "Changed" },
      { ...source, weightToleranceOz: 0.2 },
      { ...source, variants: [] },
    ]) {
      expect(repairDefinitionFingerprint(repair, changedSource)).not.toBe(baseline);
    }
  });
});
