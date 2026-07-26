/**
 * Static dough customer assignments derived from customer pizza spec sheets.
 *
 * These cover dough workbooks that contain NO customer-assignment section of
 * their own (or need supplemental entries not in the workbook section). They
 * are applied additively at spec-import commit time so that matchDoughballVariant
 * can auto-select the right dough weight from brand+flavor alone — without
 * requiring the user to type a die on every profile.
 *
 * Keys: lowercase recipe family name as returned by the AI
 * (identical to specImportDoughFamilyHintFromFileName lowercased).
 *
 * Values: DoughCustomerAssignment[] — same shape as parseDoughCustomerSection
 * output; applied via applyDoughCustomerAssignmentsToVariants.
 *
 * HOW qualifierKey is chosen:
 *   Run doughVariantQualifierKey(variantLabel) on each variant label to find
 *   its tier. Set qualifierKey to match. Use "" for base (no-qualifier) tier.
 *   flavors: [""] means "all flavors of this brand" (catch-all).
 */

import type { DoughCustomerAssignment } from "./index.js";

/**
 * Static customer→dough assignments for spec-import commit. Keyed by the
 * lowercase dough family recipe name (AI hint, lowercased).
 * Applied unconditionally and additively alongside workbook-parsed assignments.
 */
export const SPEC_STATIC_CUSTOMER_ASSIGNMENTS: ReadonlyMap<
  string,
  DoughCustomerAssignment[]
> = new Map([
  // ─── Aldo's Dough ────────────────────────────────────────────────────────
  // One base variant ("12'' Aldo" 7.7oz/24). No customer section in workbook.
  // All Aldo's brand flavors use this dough.
  [
    "aldo's dough",
    [{ brand: "Aldo's", qualifierKey: "", flavors: [""] }],
  ],

  // ─── Brand Dough ─────────────────────────────────────────────────────────
  // Three variants from the yield table:
  //   "BRAND 12\" DOUGH" (14.2oz/16)  → base tier (qualifierKey="")
  //   "BRAND 7\" DOUGH"  (6.2oz/24)   → 7-inch tier (qualifierKey="seveninch")
  //   "CORKY'S 7\" DOUGH" (5oz/24)    → 7-inch tier (qualifierKey="seveninch")
  // No customer section in workbook.
  [
    "brand dough",
    [
      { brand: "Brand", qualifierKey: "", flavors: [""] },
      { brand: "Brand", qualifierKey: "seveninch", flavors: [""] },
      { brand: "Corky's", qualifierKey: "seveninch", flavors: [""] },
    ],
  ],

  // ─── Margherita Dough ────────────────────────────────────────────────────
  // Two brand-named base variants ("LOWE'S MARGHERITA DOUGH" 11oz/16 and
  // "HANNAFORD MARGHERITA DOUGH" 11oz/16). The label-key dedup keeps them
  // separate. No customer section in workbook.
  [
    "margherita dough",
    [
      { brand: "Lowe's", qualifierKey: "", flavors: ["Margherita"] },
      { brand: "Hannaford", qualifierKey: "", flavors: ["Margherita"] },
    ],
  ],

  // ─── Naan Dough ──────────────────────────────────────────────────────────
  // Workbook customer section covers Lucia's Craft & 4Hands Naan (confirmed).
  // Hannaford / Tikka Masala assignment from spec — not in workbook section.
  // "Hannaford (Masala Pizza)" variant label contains "Hannaford" → strict match.
  [
    "naan dough",
    [{ brand: "Hannaford", qualifierKey: "", flavors: ["Tikka Masala"] }],
  ],

  // ─── Masa Dough ──────────────────────────────────────────────────────────
  // Nob Hill Craft / South of the Border confirmed from spec sheets.
  // No customer section in workbook.
  [
    "masa dough",
    [{ brand: "Nob Hill Craft", qualifierKey: "", flavors: ["South of the Border"] }],
  ],

  // ─── Masa Dough, Natural, (Lowe's) ───────────────────────────────────────
  // Lowe's South-of-Border-style flavors — exact flavor list TBD from spec.
  // Catch-all (flavors=[""]) until spec confirms flavor names.
  [
    "masa dough, natural, (lowe's)",
    [{ brand: "Lowe's", qualifierKey: "", flavors: [""] }],
  ],

  // ─── Lowe's French Fry Dough ─────────────────────────────────────────────
  // Single variant. "Lowe's" appears in the recipe name/label → strict match.
  // No customer section in workbook; exact flavors TBD, catch-all for now.
  [
    "lowe's french fry dough",
    [{ brand: "Lowe's", qualifierKey: "", flavors: [""] }],
  ],

  // ─── Lucia's French Fry Dough ────────────────────────────────────────────
  // Single generic-labeled variant. Neither brand name appears in the label
  // → base-pool-is-NOT-branded → both base assignments apply as catch-all.
  // No customer section in workbook.
  [
    "lucia's french fry dough",
    [
      { brand: "Lucia's Craft", qualifierKey: "", flavors: ["Bacon Burger Supreme"] },
      { brand: "Nob Hill Craft", qualifierKey: "", flavors: ["Bacon Cheeseburger"] },
    ],
  ],

  // ─── Malted Barley Dough ─────────────────────────────────────────────────
  // Workbook customer section covers Lowe's, Hannaford, Lucia's Craft, Nob
  // Hill Craft (compound "thick" variant). SUPPLEMENTAL: Price Chopper is NOT
  // in the workbook section but uses this dough per the Price Chopper spec.
  // qualifierKey="thick" targets the "… Thick (Argus)" compound variant.
  [
    "malted barley dough",
    [
      {
        brand: "Price Chopper",
        qualifierKey: "thick",
        flavors: [
          "BBQ Chicken",
          "Spicy 4 Cheese",
          "Spinach Goat Cheese",
          "Chicken Bacon Club",
        ],
      },
    ],
  ],

  // ─── Microwavable Lucia's Dough ──────────────────────────────────────────
  // Two 7-inch variants (qualifierKey="seveninch"):
  //   "Lucia's 7'' Morning Melts" (5.5oz/24) — contains "Lucia's"
  //   "7'' FSD"                   (5.5oz/24) — contains "FSD"
  // Each gets its own brand+flavor assignments via strict label match.
  // No customer section in workbook.
  [
    "microwavable lucia's dough",
    [
      {
        brand: "Lucia's",
        qualifierKey: "seveninch",
        flavors: ["Americano", "Italiano", "Mexicano", "Parisian"],
      },
      { brand: "FSD", qualifierKey: "seveninch", flavors: ["Breakfast"] },
    ],
  ],
]);
