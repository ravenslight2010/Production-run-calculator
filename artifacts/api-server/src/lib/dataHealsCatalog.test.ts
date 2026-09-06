import { describe, expect, it } from "vitest";
import { registeredAutomaticDataHeals } from "./dataHeals";

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
      "aug2026-lowes-mix-stray-component-v1", "cheese-component-oz-strip-v2", "hannaford-tikka-masala-fix-v1",
      "profile-name-link-stub-purge-v1", "workbook-import-stub-purge-v1", "aug19-saved-spec-profile-repair-v1",
      "aug19-saved-spec-profile-repair-v2",
      "fresh-device-run-contamination-v1",
      "incident-resolved-workflow-reconciliation-v1",
      "source-library-reconciliation-2026-08-26-v1",
    ]);
    expect(repairs.every((repair) => repair.mode === "automatic" && !repair.managerAllowed)).toBe(true);
    expect(repairs.every((repair) => Object.isFrozen(repair))).toBe(true);
    repairs.forEach((repair, index) => expect(repair.dependencies).toEqual(index === 0 || index === 2 || index === 3
      ? [] : [ids[index - 1]]));
  });
});