import {
  CRB_DOUGH_LUCIA_VARIANT_CUSTOMERS_V2_CONTRACT,
  CRB_DOUGH_LUCIA_VARIANT_CUSTOMERS_V2_REPAIR_ID,
} from "./mixDoughRepairs";
import {
  SEA_SALT_DOUGH_TARGETS,
  SEA_SALT_MIX_TARGETS,
  SEA_SALT_SAUCE_TARGETS,
} from "../seaSaltHeal";
import type { RepairFingerprintSource } from "../repairDefinitionFingerprint";

function freezeSource<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) freezeSource(nested);
  }
  return value;
}

/**
 * Immutable, serializable inputs embedded in released compatibility repairs.
 * Runtime functions, database-derived values, clocks, results, and the generated
 * source-library plan are intentionally absent.
 */
export const LEGACY_REPAIR_SOURCE_CONTRACTS: Readonly<
  Record<string, RepairFingerprintSource>
> = freezeSource({
  "data-heal-result-backfill-v1": {
    bufferMs: 600_000,
    predicate: "null-result-within-applied-at-buffer",
    countedTables: ["brand_profiles", "cheese_recipes", "mixes", "dough_recipes", "sauce_recipes", "daily_sync"],
  },
  "ingredient-active-name-dedupe-v1": {
    grouping: "scope-and-trimmed-case-insensitive-name",
    keeperRank: "enabled-first-then-oldest-id",
    mergedFields: ["categories"],
    duplicateWrites: { enabled: false, mergedInto: "keeper-id" },
  },
  "crb-dough-family-consolidation-v1": {
    scope: "live",
    fromDate: "2026-08-22",
    canonicalName: "crb dough",
    duplicateName: "crb recipe",
    componentsPredicate: "trim-lower-positive-lbs-sorted-nonempty",
  },
  "cheese-import-poison-cleanup-v1": {
    fromDate: "2026-07-01",
    predicate: "reviewed-cheese-alias-flavor-and-applicator-poison",
    fields: ["app1CheeseRecipeName", "app2CheeseRecipeName", "app3CheeseRecipeName", "app4CheeseRecipeName"],
  },
  "spec-alias-hygiene-purge-v1": {
    predicate: "sanitize-spec-aliases-per-scope",
    fields: ["kind", "externalName", "canonicalName", "context"],
  },
  "cheese-recipe-name-dedupe-v1": {
    grouping: "scope-and-trimmed-case-insensitive-name",
    keeperRank: "positive-lbs-then-component-count-then-oldest",
  },
  "generic-mix-poison-purge-v2": {
    predicate: "generic-slot-name-or-unbranded-empty-mix",
    genericNames: ["mix", "cheese"],
  },
  "cheese-named-mix-crossover-purge-v1": {
    predicate: "mix-pool-cheese-name-with-cheese-pool-counterpart",
    nameToken: "cheese",
  },
  "cheese-share-backfill-v1": {
    predicate: "missing-share-pct-with-positive-lbs",
    sourceField: "lbs",
    targetField: "sharePct",
  },
  "cheese-oz-depoison-v1": {
    predicate: "component-has-own-oz-per-pizza-property",
    removedField: "ozPerPizza",
  },
  "named-recipe-name-cleanup-v1": {
    fromDate: "2026-07-15",
    predicate: "clean-spec-name-without-same-scope-collision",
    fields: ["doughRecipeName", "frontlineRecipeName"],
  },
  "dough-batch-yield-depoison-v1": {
    predicate: "positive-yield-and-weight-with-positive-lbs-row",
    targetField: "doughBatchYield",
    replacement: 0,
  },
  "dough-family-weight-depoison-v1": {
    predicate: "multi-variant-family-unrepresented-root-weight-or-tray-count",
    toleranceOz: 0.005,
    fields: ["targetDoughballWeight", "doughballsPerTray"],
  },
  "smd-pep-cheese-mix-restore-v1": {
    recipeName: "smd pep cheese mix",
    lostRows: [
      { keyIncludes: "asiago", restored: { ingredient: "Asiago Cheese", lbs: 23.3 } },
      { keyIncludes: "romano", restored: { ingredient: "Romano Cheese", lbs: 23.3 } },
      { keyIncludes: "parmesan", restored: { ingredient: "Parmesan Cheese", lbs: 23.3 } },
    ],
    appendedRow: { ingredient: "Cellulose", lbs: 0.3 },
    blankDefaults: { cellulose: "0.83", shredderSetting: "#1" },
  },
  "sea-salt-alias-undo-v1": {
    alias: { externalName: "sea salt", canonicalName: "salt" },
    ingredientAliasKinds: ["ingredient", "doughIngredient", "sauceIngredient"],
    doughTargets: SEA_SALT_DOUGH_TARGETS,
    sauceTargets: SEA_SALT_SAUCE_TARGETS,
    mixTargets: SEA_SALT_MIX_TARGETS,
  },
  "mix-duplicate-name-purge-v1": {
    grouping: "scope-name-brand-flavor-case-insensitive",
    keeperRank: "positive-amounts-then-batch-size-then-components-then-oldest-id",
  },
  "purchased-crust-die-heal-v1": {
    predicate: "shared-purchased-crust-die-strip",
    fields: ["dieType", "doughRecipeName"],
  },
  "dough-variant-suffix-dedupe-v1": {
    predicate: "suffix-equivalent-noncontradictory-variants",
    targetField: "doughballVariants",
  },
  "dough-merge-vanish-restore-v1": {
    fromDate: "2026-07-16",
    lostNames: ["lowe's french fry", "lowes french fry"],
    restoredRecipe: {
      name: "Lowe's French Fry Dough",
      brand: "Lowe's",
      flavor: "French Fry",
    },
  },
  "bogus-merge-alias-purge-v1": {
    predicate: "reviewed-bogus-merge-alias-pairs",
    fields: ["kind", "externalName", "canonicalName", "context"],
  },
  "basha-hannaford-crosslink-parse-purge-v1": {
    sourceKeyPrefix: "basha",
    poisonedDataSubstring: "lowe's/hannaford",
  },
  "aldo-cheese-tolerance-oz-v1": {
    brand: "Aldo",
    field: "cheeseToleranceOz",
    value: 0.1,
  },
  "bobo-cross-family-alias-undo-v1": {
    poisonedCanonical: "bobo's breakfast cheese mix",
    verbatimExternal: "Bobo Breakfast Mix",
  },
  "lowes-natural-pep-name-v1": {
    canonicalName: "Pepperoni Stick - NATURAL",
    barePattern: { source: "^natural(\\s*\\(.*\\))?$", flags: "i" },
    fields: ["pep1Type", "pep2Type", "pep1TypeB", "pep2TypeB"],
    fromDate: "2026-07-20",
  },
  "brand-fan-dough-depoison-v1": {
    fromDate: "2026-07-23",
    predicate: "shared-brand-fan-target-and-family-formula-match",
  },
  "brand-drift-rename-v1": {
    predicate: "shared-brand-drift-rename-map",
    aliasKind: "brand",
  },
  [CRB_DOUGH_LUCIA_VARIANT_CUSTOMERS_V2_REPAIR_ID]:
    CRB_DOUGH_LUCIA_VARIANT_CUSTOMERS_V2_CONTRACT,
  "july-2026-profile-corrections-v1": {
    toleranceOz: 0.05,
    corrections: [
      ['11" hannaford', "chicken tikka masala", "Naan recipe", "Naan Dough"],
      ["brand", "mr07ch24", 14.2, 6.2],
      ["basha's ultra thin crust", "*", 5.7, 7.8],
      ["lowe's", "spinach & mushroom", 5.7, 13, "Lucia Pizza Sauce"],
      ["nob hill craft pizzas", "caribbean", 5.7, 12.1, "Sweet n Sour Sauce"],
      ["lowe's", "bacon cheeseburger", "Cheeseburger Sauce"],
      ["lowe's", "caribbean", "Sweet n Sour Sauce"],
      ["lowe's", "red hot chicken", "Four Hands Red Hot Recipe"],
      ["hannaford", "four cheese with sweet & spicy chili sauce", 5.7, 12],
      ["lucia's craft", "house dlux", 5.7, 12],
    ],
    aliasChanges: [
      ["delete", "Masa recipe", "Masa recipe natural"],
      ["ensure", "Naan recipe", "Naan Dough", "dough"],
    ],
  },
  "july-2026-audit-corrections-v2": {
    toleranceOz: 0.05,
    corrections: [
      ["brand", "mr07ch24", 5, 6.2],
      ["brand", "mr12ch14", 5, 14.2],
      ["hannaford", "chicken tikka masala", "nonpositive", 11.5],
      ["lowe's", "red hot chicken", "Four Hands Red Hot Recipe", "Four Hands Red Hot Pizza Sauce"],
      ["lowe's", "buffalo chicken", "", "Buffalo Sauce"],
      ["lowe's", "margherita", "", "Lucia Pizza Sauce"],
      ["lucia's pinsa (proof)", "chicken tikka masala", "masala sauce (rasoi)", "Tikka Masala Sauce"],
    ],
    deletedAlias: ["Al Pastor Sauce", "Tikka Masala Sauce"],
    insertedSauce: { id: "al-pastor-sauce", name: "Al Pastor Sauce", scope: "live" },
  },
  "july-2026-audit-corrections-v3": {
    corrections: [
      ["Thick Malted Barley recipe", "nonpositive-weight", 13.8],
      ["Lowe's", "Spinach & Mushroom", "blank-sauce", "Lucia's Sauce"],
    ],
  },
  "applicator-contamination-depoison-v1": {
    ownershipFields: ["app1CheeseRecipeName", "app2CheeseRecipeName"],
    clearedPairs: [
      ["app3CheeseRecipeName", "app3Type"],
      ["app4CheeseRecipeName", "app4Type"],
    ],
  },
  "sync-row-name-registry-restore-v1": {
    predicate: "sync-name-registry-row-with-missing-brand",
    fields: ["brand", "flavor", "name"],
  },
  "brand-duplicate-purge-v1": {
    grouping: "trimmed-case-insensitive-brand",
    outputOrder: "locale",
  },
  "tunnel-pre-post-default-v1": {
    predicate: "nonpositive-or-missing",
    fields: ["preTunnelMin", "postTunnelMin"],
    defaultMinutes: 2.5,
  },
  "aug2026-import-fix-cheese-recipes-v1": {
    predicate: "audited-august-2026-cheese-import-rows",
    noCelluloseValue: "NO Cellulose",
    boboBatchLbs: 121.6125,
    luciaBatchPizzas: 745.2,
    conversion: "round4(ozPerPizza*batchPizzas/16)",
  },
  "aug2026-import-fix-mixes-v1": {
    batchSizeFixes: [
      ["Nob Hill Red Hot Bacon Jalapeno Mix", 34.9312],
      ["Nob Hill Caribbean Pinapples Mix", 31.05],
      ["Corner Booth Spinach Mix", 72.45],
      ["Hot Giardiniera Mix", 144.9],
      ["Basha Hawaiian Mix", 82.8],
      ["Lucia Red Hot Bacon Mix", 34.9312],
      ["Lucia Caribbean Mix", 31.05],
      ["Lucia Alfredo Mix", 49.6125],
      ["Lowe's Red Hot Bacon Jalapeno Mix", 31.05],
    ],
    boboPerPizzaOz: 2.35,
    boboBatchLbs: 121.6125,
    luciaBatchPizzas: 745.2,
  },
  "aug2026-import-fix-profiles-v1": {
    brand: "Nob Hill Craft",
    corrections: [
      ["south of the border", "app2CheeseRecipeName", "prefix-brand"],
      ["club", "app1CheeseRecipeName", "clear-exact-poison"],
    ],
  },
  "aug2026-import-fix-sauce-recipes-v1": {
    scope: "live",
    insertedRows: [
      ["bbq-sauce-legacy", "BBQ Sauce (Legacy)"],
      ["ranch-sauce-legacy", "Ranch Sauce (Legacy)"],
      ["cheeseburger-sauce-legacy", "Cheeseburger Sauce (Legacy)"],
      ["sweet-n-sour-sauce-legacy", "Sweet n Sour Sauce (Legacy)"],
      ["al-pastor-sauce-legacy", "Al Pastor Sauce (Legacy)"],
      ["buffalo-ranch-sauce-legacy", "Buffalo Ranch Sauce (Legacy)"],
      ["legacy-buffalo-ranch", "Legacy Buffalo Ranch"],
      ["sauce-legacy-cheeseburger-recipe", "Sauce (Legacy Cheeseburger Recipe)"],
    ],
  },
  "aug2026-cheese-recipe-lbs-v1": {
    predicate: "audited-recipe-name-to-batch-pizzas-and-oz-mapping",
    conversion: "round4(ozPerPizza*batchPizzas/16)",
  },
  "aug2026-lowes-mix-stray-component-v1": {
    scope: "live",
    mixName: "Lowe's Red Hot Bacon Jalapeno Mix",
    predicate: "remove-zero-per-pizza-bacon-component",
  },
  "cheese-component-oz-strip-v1": {
    predicate: "component-has-own-oz-per-pizza-property",
    removedField: "ozPerPizza",
  },
  "cheese-component-oz-strip-v2": {
    supersededMarkerId: "cheese-component-oz-strip-v1",
    predicate: "component-has-own-oz-per-pizza-property",
    removedField: "ozPerPizza",
    clearField: "sharePct",
    shareRoundingDecimals: 2,
  },
  "hannaford-tikka-masala-fix-v1": {
    brand: "Hannaford",
    flavor: "Chicken Tikka Masala",
    canonicalSauce: "Tikka Masala Sauce",
  },
  "profile-name-link-stub-purge-v1": {
    scope: "live",
    predicate: "all-zero-name-linked-stub-with-no-profile-or-run-reference",
    referenceFields: ["doughRecipeName", "frontlineRecipeName", "app1CheeseRecipeName", "app2CheeseRecipeName", "app3CheeseRecipeName", "app4CheeseRecipeName"],
  },
  "workbook-import-stub-purge-v1": {
    scope: "live",
    slug: "lowercase-nonalphanumeric-to-hyphen-trim-hyphen",
    idTemplates: ["cheese:{brand}:{name}", "cheese:{name}", "premix-{brand}-{flavor}-{name}"],
    zeroFields: ["lbs", "ozPerPizza", "perPizza", "batchSize", "amountAlreadyMade"],
  },
  "aug19-saved-spec-profile-repair-v1": {
    window: ["2026-08-19T00:00:00.000Z", "2026-08-20T00:00:00.000Z"],
    runFromDate: "2026-08-19",
    sourceOrder: "created-at-desc-then-id-desc-newest-profile-wins",
    runPredicate: "unstarted-only",
  },
  "aug19-saved-spec-profile-repair-v2": {
    window: ["2026-08-19T00:00:00.000Z", "2026-08-20T00:00:00.000Z"],
    runFromDate: "2026-08-19",
    sourceOrder: "created-at-desc-then-id-desc-newest-profile-wins",
    recipeResolution: "alias-then-pool-formula-then-same-sheet-rows",
    runPredicate: "unstarted-only",
  },
  "fresh-device-run-contamination-v1": {
    fromDate: "2026-08-20",
    predicate: "one-unnamed-and-one-named-unstarted-run-with-identical-material-setup",
    materialFields: ["doughRecipeName", "frontlineRecipeName", "app1CheeseRecipeName", "app2CheeseRecipeName", "app3CheeseRecipeName", "app4CheeseRecipeName"],
  },
  "incident-resolved-workflow-reconciliation-v1": {
    predicate: { status: "resolved", workflowStateNot: "resolved" },
    writes: { workflowState: "resolved" },
    excludedFields: ["ownership", "notes", "priority", "timestamps"],
  },
});