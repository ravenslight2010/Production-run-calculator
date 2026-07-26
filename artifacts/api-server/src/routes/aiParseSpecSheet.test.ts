import { describe, it, expect } from "vitest";
import {
  buildParseSpecSheetPrompt,
  sanitizeParseSpecSheet,
  validateParseSpecSheetBody,
  MAX_KNOWN_LIST,
  type ParseSpecSheetInput,
} from "./aiParseSpecSheet";
import { isStickPepOnlyCheeseRecipe } from "@workspace/spec-import";

function input(overrides: Partial<ParseSpecSheetInput> = {}): ParseSpecSheetInput {
  return {
    workbookText: "Brand\tFlavor\tSize\nLowes\tPepperoni\t7in\n",
    ...overrides,
  } as ParseSpecSheetInput;
}

// Regression guard for the spec-sheet importer BRAND rule. The primary
// differentiator is the product-line header (e.g. "Basha's Original" vs
// "Basha's Ultra Thin Crust"): those must stay separate brands and never
// collapse to a bare company name, or their identical flavor names overwrite
// each other. Folding SIZE into the brand ("Lowes 7in") is only the fallback
// when a sheet has no product-line qualifier. The instructions live in the
// system prompt; these tests pin them so they can't be silently dropped.
describe("buildParseSpecSheetPrompt brand rule", () => {
  it("keeps the full product-line brand and never collapses to a bare company name", () => {
    const { system } = buildParseSpecSheetPrompt(input());
    // Distinguishing product-line qualifiers are kept in the brand.
    expect(system).toContain("product-line");
    expect(system).toContain("Ultra Thin");
    // Worked example: two product lines from one company are distinct brands.
    expect(system).toContain("brand='Basha's Original'");
    expect(system).toContain("brand='Basha's Ultra Thin Crust'");
    // The explicit anti-pattern it must avoid.
    expect(system).toContain("never");
    expect(system).toContain("bare company name");
    // And it must not re-collapse via a shorter KNOWN brand match.
    expect(system).toContain("Do NOT match a qualified");
  });

  it("still folds SIZE into the brand as the fallback (never into the flavor)", () => {
    const { system } = buildParseSpecSheetPrompt(input());
    expect(system).toContain("size INTO THE BRAND");
    expect(system).toContain("brand='Lowes 7in'");
    expect(system).toContain("flavor='Pepperoni'");
    expect(system).toContain("NOT brand='Lowes', flavor='7in Pepperoni'");
  });

  it("applies the same brand rule to recipes and targets", () => {
    const { system } = buildParseSpecSheetPrompt(input());
    expect(system).toContain("recipe brand/flavor and `targets` the same way");
  });

  // Regression guard: blocks identified only by an item/product code (e.g.
  // "BRAND PIZZAS | MR12CH14") must keep the code VERBATIM as the flavor —
  // inventing a descriptive flavor ("Cheese") for every code block collapsed
  // distinct products into one profile so the second overwrote the first.
  it("keeps product-code block headers distinct via a verbatim code flavor", () => {
    const { system } = buildParseSpecSheetPrompt(input());
    expect(system).toContain("PRODUCT-CODE HEADERS");
    expect(system).toContain("use the code VERBATIM as the `flavor`");
    expect(system).toContain("do NOT append the code to the brand");
    expect(system).toContain("NEVER give two different code blocks the same invented flavor");
  });

  // Regression guard: the Lowe's sheet's "Pepperoni Stick - NATURAL
  // (Hormel - 24878)" rows were parsed to a bare "NATURAL" pep type, dropping
  // the product name factory-wide. The prompt must pin pep-type naming: full
  // product name kept, vendor/code parenthetical stripped, never a bare
  // qualifier.
  it("pins pep type naming to the full product name, never a bare qualifier", () => {
    const { system } = buildParseSpecSheetPrompt(input());
    expect(system).toContain("PEP TYPE NAMES");
    expect(system).toContain("FULL product name");
    expect(system).toContain("'Pepperoni Stick - NATURAL (Hormel - 24878)'");
    expect(system).toContain("type 'Pepperoni Stick - NATURAL'");
    expect(system).toContain("NEVER emit a bare qualifier");
  });

  // Regression guard: "Pepperoni Stick - NATURAL" was being snapped to the
  // shorter known name "Pepperoni Stick" because the known-name verbatim rule
  // was not explicitly carved out for qualifier differences. The prompt must
  // tell the model that product qualifiers (NATURAL, CURED, etc.) override the
  // snap-to-known-name rule.
  it("tells the model qualifier words override the snap-to-known-name rule", () => {
    const { system } = buildParseSpecSheetPrompt(input());
    expect(system).toContain("QUALIFIER EXCEPTION");
    // Size suffixes in brand names must not be stripped.
    expect(system).toContain("7 Inch");
    expect(system).toContain("7in");
    expect(system).toContain("Lowe");
    // Product qualifiers.
    expect(system).toContain("'Pepperoni Stick - NATURAL' does NOT collapse to known 'Pepperoni Stick'");
    expect(system).toContain("'Masa Dough Natural' does NOT collapse to known 'Masa Dough'");
    // The pep type rule itself must reinforce that it overrides the known-name rule.
    expect(system).toContain("This rule OVERRIDES the known-name verbatim rule");
  });

  // Regression guard: recipe names ("Masa Dough Natural", "Malted Barley
  // recipe") had "Natural" and distinguishing words dropped to match a shorter
  // known name. The prompt must explicitly require full recipe names including
  // qualifiers.
  it("tells the model to keep qualifiers in recipe names (Natural, Spicy, etc.)", () => {
    const { system } = buildParseSpecSheetPrompt(input());
    expect(system).toContain("RECIPE NAME QUALIFIERS");
    expect(system).toContain("'Masa Dough Natural' stays 'Masa Dough Natural'");
    expect(system).toContain("'Malted Barley recipe' stays 'Malted Barley recipe'");
  });
});

// Regression guard for the dough yield table row-type distinction. Customer/
// product rows in a yield table (e.g. "Lucia's Craft Bacon Burger Supreme")
// must NOT become the recipe name — the procedure title is the recipe name and
// the row label goes into targets. Only short variant descriptors (Heavy, Light)
// go into the recipe name.
describe("buildParseSpecSheetPrompt dough yield table row types", () => {
  it("distinguishes variant descriptor rows from customer/product target rows", () => {
    const { system } = buildParseSpecSheetPrompt(input());
    expect(system).toContain("TWO ROW TYPES");
    expect(system).toContain("VARIANT DESCRIPTOR ROWS");
    expect(system).toContain("CUSTOMER / PRODUCT TARGET ROWS");
  });

  it("tells the model customer/product row labels go into targets, not the recipe name", () => {
    const { system } = buildParseSpecSheetPrompt(input());
    // The recipe name comes from the procedure title, not the customer row label.
    expect(system).toContain("recipe name comes from the PROCEDURE TITLE");
    // Concrete anti-example: Lucia's Craft Bacon Burger Supreme is a target row.
    expect(system).toContain("Lucia");
    expect(system).toContain("Bacon Burger Supreme");
  });

  it("tells the model variant descriptor rows go into the recipe name", () => {
    const { system } = buildParseSpecSheetPrompt(input());
    expect(system).toContain("Heavy Plus");
    expect(system).toContain("Procedure Name");
  });

  // Regression guard: when a yield table row label matches the procedure name
  // itself (e.g. "Malted Barley Dough" row inside the "Malted Barley Dough"
  // procedure), the AI was emitting a second recipe with the same name instead
  // of setting the doughball weight directly on the existing recipe. The prompt
  // must identify this as a self-referential row (type C).
  it("tells the model self-referential rows set doughball weight on the recipe, not a new variant", () => {
    const { system } = buildParseSpecSheetPrompt(input());
    expect(system).toContain("SELF-REFERENTIAL ROWS");
    expect(system).toContain("Malted Barley Dough");
    expect(system).toContain("do NOT emit a second recipe with the same name");
  });

  // Regression guard: "Lucia's Morning Melts" target was pulling in the known
  // flavors of the different brand "Lucia's" (Americano, Italiano, etc.) via
  // the brand-expansion rule, creating non-existent variants. The prompt must
  // require exact brand name matching for flavor expansion.
  it("tells the model brand flavor expansion is exact-match only, never cross-brand", () => {
    const { system } = buildParseSpecSheetPrompt(input());
    expect(system).toContain("EXACT-MATCH ONLY");
    expect(system).toContain("Lucia");
    expect(system).toContain("Morning Melts");
    expect(system).toContain("Americano");
    expect(system).toContain("never borrow flavors from a brand that merely resembles it");
  });
});

// Regression guard for the standalone-procedure rule. A sheet that is one whole
// sauce/dough/cheese procedure for a single product line (brand in the title,
// no per-flavor grid) must produce a brand-only recipe (flavor + targets EMPTY)
// so it attaches to every flavor of that brand — never a targetless recipe (which
// attaches to nothing) or an invented "Dough" flavor / size-suffixed brand.
describe("buildParseSpecSheetPrompt standalone procedure rule", () => {
  it("tells the model to take the brand from the title and leave flavor/targets empty", () => {
    const { system } = buildParseSpecSheetPrompt(input());
    expect(system).toContain("standalone PROCEDURE");
    expect(system).toContain("BRAND from the sheet title or tab name");
    expect(system).toContain("LEAVE `flavor` EMPTY and `targets` EMPTY");
    // Explicit anti-patterns it must avoid.
    expect(system).toContain("Do NOT " + "invent a placeholder flavor like 'Dough'");
    expect(system).toContain("do NOT fold the size into the");
    // But an explicit per-flavor cheese-tab mapping still populates targets.
    expect(system).toContain("EXPLICITLY maps a recipe to");
  });

  it("distinguishes a customer/product-line title from a sauce/dough TYPE title", () => {
    const { system } = buildParseSpecSheetPrompt(input());
    // A recipe-TYPE title (no customer) must not become a junk brand.
    expect(system).toContain("distinguish a CUSTOMER/product-line name from a SAUCE/DOUGH");
    expect(system).toContain("is NOT a brand");
    expect(system).toContain("LEAVE `brand` EMPTY");
    // A body note naming customers routes to targets, not a guessed brand.
    expect(system).toContain("This recipe used for Hannaford and Lucia");
  });

  it("forbids inventing a flavor for a shared procedure (whole-brand empty precedence)", () => {
    const { system } = buildParseSpecSheetPrompt(input());
    // Shared-procedure customer notes must never fabricate a specific flavor.
    expect(system).toContain("NEVER invent or guess a specific flavor");
    expect(system).toContain("do not turn 'Masa' into 'Masala'");
    // The older no-known-flavors fallback must also leave the flavor empty, not
    // guess a "best reading" flavor (older contradictory wording removed).
    expect(system).toContain("add ONE whole-brand target with the `flavor` LEFT EMPTY");
    expect(system).not.toContain("best reading of its brand and flavor");
  });

  it("splits a multi-customer brand cell but keeps a single '&' company name whole", () => {
    const { system } = buildParseSpecSheetPrompt(input());
    // "Lucia's Craft & 4Hands" must fan out into one target per customer...
    expect(system).toContain("SPLIT it into one target PER");
    // ...while a legitimate single '&' company name stays one brand.
    expect(system).toContain("Maria & Son");
  });

  it("reads a doughball/yield table as per-customer targets (parenthesized flavor optional)", () => {
    const { system } = buildParseSpecSheetPrompt(input());
    expect(system).toContain("Hannaford (Masala Pizza)");
    expect(system).toContain("flavor = the parenthesized");
  });

  it("keeps a standalone procedure's full title as the name (no junk first-word brand)", () => {
    const { system } = buildParseSpecSheetPrompt(input());
    // 'MYSTIC PIZZA SAUCE PROCEDURE' -> name 'Mystic Pizza Sauce', not brand 'Mystic'.
    expect(system).toContain("Mystic Pizza Sauce");
    expect(system).toContain("do NOT peel the first");
  });
});

// Regression guard: the prompt must NOT hand the model incoherent (cyclic/
// chained) learned aliases. A polluted pool (e.g. CHICKEN TIKKA MASALA =>
// Red Hot Chicken alongside Red Hot Chicken => Red Hot, and a PEPPERONI <=>
// ULTIMATE PEPPERONI cycle) previously made the AI mis-rename and collide
// valid flavors so imports produced nothing. The de-confliction guard must
// strip those before they reach the model, while keeping coherent aliases.
describe("buildParseSpecSheetPrompt alias de-confliction", () => {
  it("drops cyclic/chained aliases but keeps coherent ones", () => {
    const { user } = buildParseSpecSheetPrompt(
      input({
        aliases: [
          { kind: "flavor", externalName: "CHICKEN TIKKA MASALA", canonicalName: "Red Hot Chicken", context: null },
          { kind: "flavor", externalName: "Red Hot Chicken", canonicalName: "Red Hot", context: null },
          { kind: "flavor", externalName: "PEPPERONI", canonicalName: "ULTIMATE PEPPERONI", context: null },
          { kind: "flavor", externalName: "ULTIMATE PEPPERONI", canonicalName: "PEPPERONI", context: null },
          { kind: "flavor", externalName: "Buffalo Chicken", canonicalName: "BBQ Chicken", context: null },
        ],
      } as Partial<ParseSpecSheetInput>),
    );
    expect(user).not.toContain("Red Hot Chicken");
    expect(user).not.toContain("ULTIMATE PEPPERONI");
    expect(user).not.toContain("CHICKEN TIKKA MASALA");
    // The coherent alias survives.
    expect(user).toContain('"Buffalo Chicken" => "BBQ Chicken"');
  });

  it("omits the alias block entirely when every alias is conflicting", () => {
    const { user } = buildParseSpecSheetPrompt(
      input({
        aliases: [
          { kind: "flavor", externalName: "PEPPERONI", canonicalName: "ULTIMATE PEPPERONI", context: null },
          { kind: "flavor", externalName: "ULTIMATE PEPPERONI", canonicalName: "PEPPERONI", context: null },
        ],
      } as Partial<ParseSpecSheetInput>),
    );
    expect(user).not.toContain("KNOWN ALIASES");
  });
});

// Regression guard for the numeric-accuracy rule: the model must copy numbers
// verbatim and never swap per-pizza ounces with recipe pounds. Pinned here so
// the instruction can't be silently dropped from the prompt.
describe("buildParseSpecSheetPrompt numeric accuracy", () => {
  it("tells the model to read numbers exactly and never swap oz/lbs units", () => {
    const { system } = buildParseSpecSheetPrompt(input());
    expect(system).toContain("READ NUMBERS EXACTLY");
    expect(system).toContain("never round");
    expect(system).toContain("NEVER swap fields");
    expect(system).toContain("per-pizza ounce");
  });
});

// Regression guard: the same topping/blend can run on TWO applicator stations
// at DIFFERENT per-pizza weights. Without this instruction the model tends to
// dedupe same-named applicators into one entry (or reuse one weight for both)
// — the "import doesn't get all the weights right" report. Pinned so it can't
// be silently dropped from the prompt.
describe("buildParseSpecSheetPrompt duplicate applicators", () => {
  it("tells the model to emit one applicators[] entry per station, never collapsing same-named ones", () => {
    const { system } = buildParseSpecSheetPrompt(input());
    expect(system).toContain("DUPLICATE APPLICATORS");
    expect(system).toContain("TWO separate entries");
    expect(system).toContain("NEVER collapse same-named applicators");
    expect(system).toContain("never copy one station's weight");
  });

  // The flip side: a second same-named entry must come from a genuinely
  // separate station on the sheet. Tolerance/range figures printed next to a
  // target weight (±0.2, min/max) must never become a phantom second
  // applicator — the observed failure was every flavor gaining a bogus
  // "Cheese Mix 0.2 oz" entry alongside the real target weight.
  it("forbids emitting tolerance/range values as a second same-named applicator", () => {
    const { system } = buildParseSpecSheetPrompt(input());
    expect(system).toContain("genuinely SEPARATE applicator row/column/station");
    expect(system).toContain("are NOT another applicator");
    expect(system).toContain("\u00b10.2 tolerance is ONE");
  });
});

// Pepperoni is a pep TYPE (captured on a profile's `pepperonis`), never a
// cheese/topping recipe. The prompt tells the model not to emit it as a recipe,
// and the sanitizer deterministically drops any that slip through — so the
// import review UI never flags a bogus "cheese recipe" for what is a pep type.
describe("pepperoni is a pep type, not a cheese recipe", () => {
  it("tells the model stick-applied peps (pepperoni + cheese sticks) are profile pepperonis, never a recipe", () => {
    const { system } = buildParseSpecSheetPrompt(input());
    expect(system).toContain("STICK-APPLIED TOPPINGS ARE NOT A RECIPE");
    expect(system).toContain("cheese sticks");
    expect(system).toContain("`pepperonis`");
    expect(system).toContain("EXCEPTION IS DICED PEPPERONI");
  });

  it("drops a cheese recipe whose ingredients are purely pepperoni", () => {
    const raw = {
      profiles: [],
      recipes: [
        {
          kind: "cheese",
          name: "Pepperoni Stick",
          rows: [{ ingredient: "Pepperoni Stick", lbs: 5 }],
        },
      ],
    };
    const out = sanitizeParseSpecSheet(raw);
    expect(out.recipes).toHaveLength(0);
  });

  it("drops a cheese recipe whose ingredients are purely cheese sticks (a pep type)", () => {
    const raw = {
      profiles: [],
      recipes: [
        {
          kind: "cheese",
          name: "Cheese Stick",
          rows: [{ ingredient: "Cheese Stick", lbs: 5 }],
        },
      ],
    };
    const out = sanitizeParseSpecSheet(raw);
    expect(out.recipes).toHaveLength(0);
  });

  it("keeps a real cheese blend that merely lists pepperoni among cheeses", () => {
    const raw = {
      profiles: [],
      recipes: [
        {
          kind: "cheese",
          name: "Topping Blend",
          rows: [
            { ingredient: "Mozzarella", lbs: 40 },
            { ingredient: "Pepperoni", lbs: 5 },
          ],
        },
      ],
    };
    const out = sanitizeParseSpecSheet(raw);
    expect(out.recipes).toHaveLength(1);
    expect(out.recipes[0].name).toBe("Topping Blend");
  });

  it("keeps a DICED pepperoni cheese recipe (diced is a topping, the exception)", () => {
    const raw = {
      profiles: [],
      recipes: [
        {
          kind: "cheese",
          name: "Diced Pepperoni",
          rows: [{ ingredient: "Diced Pepperoni", lbs: 6 }],
        },
      ],
    };
    const out = sanitizeParseSpecSheet(raw);
    expect(out.recipes).toHaveLength(1);
    expect(out.recipes[0].name).toBe("Diced Pepperoni");
  });

  it("isStickPepOnlyCheeseRecipe: true only when every row is a non-diced stick pep", () => {
    expect(isStickPepOnlyCheeseRecipe([{ ingredient: "Pep Stick", lbs: 3 }])).toBe(true);
    // Cheese sticks are stick-applied pep types too, not a cheese recipe.
    expect(isStickPepOnlyCheeseRecipe([{ ingredient: "Cheese Stick", lbs: 3 }])).toBe(true);
    expect(isStickPepOnlyCheeseRecipe([{ ingredient: "Mozzarella Stick", lbs: 3 }])).toBe(
      true,
    );
    expect(
      isStickPepOnlyCheeseRecipe([
        { ingredient: "Pepperoni", lbs: 3 },
        { ingredient: "Provolone", lbs: 10 },
      ]),
    ).toBe(false);
    // A real cheese blend that merely lists a cheese among its rows is kept.
    expect(
      isStickPepOnlyCheeseRecipe([
        { ingredient: "Cheese Stick", lbs: 3 },
        { ingredient: "Provolone", lbs: 10 },
      ]),
    ).toBe(false);
    // Diced pepperoni is a topping, not a stick pep type -> keep the recipe.
    expect(isStickPepOnlyCheeseRecipe([{ ingredient: "Diced Pepperoni", lbs: 6 }])).toBe(
      false,
    );
    expect(
      isStickPepOnlyCheeseRecipe([
        { ingredient: "Pepperoni Stick", lbs: 3 },
        { ingredient: "Diced Pepperoni", lbs: 6 },
      ]),
    ).toBe(false);
    expect(isStickPepOnlyCheeseRecipe([])).toBe(false);
  });
});

// Regression guard for RECIPE-NAME grounding wiring: known recipe names from
// ParseSpecSheetKnown must (1) reach the prompt so the model reuses existing
// names verbatim, and (2) reach the sanitizer grounding so a paraphrased name
// snaps to (or is flagged against) the existing recipe instead of importing as
// a silent near-duplicate.
describe("known recipe names — prompt + grounding wiring", () => {
  const known = {
    doughRecipes: ["Ultra Thin Dough"],
    sauceRecipes: ["Marinara Sauce"],
    cheeseRecipes: ["Standard Cheese Blend"],
  };

  it("embeds the per-kind recipe-name lists in the prompt", () => {
    const { user } = buildParseSpecSheetPrompt(input({ known }));
    expect(user).toContain("Dough recipe names: Ultra Thin Dough");
    expect(user).toContain("Sauce recipe names: Marinara Sauce");
    expect(user).toContain("Cheese recipe names: Standard Cheese Blend");
  });

  it("forwards known recipe names into sanitizer grounding (snap + flag)", () => {
    const raw = {
      profiles: [],
      recipes: [
        // Filler-only variant of an existing dough recipe -> snaps.
        {
          kind: "dough",
          name: "Ultra Thin Dough Recipe",
          rows: [{ ingredient: "Flour", lbs: 50 }],
        },
        // Plausible near-duplicate -> kept, but flagged with a warning.
        {
          kind: "dough",
          name: "Thin Crust Dough",
          rows: [{ ingredient: "Flour", lbs: 40 }],
        },
      ],
    };
    const out = sanitizeParseSpecSheet(raw, input({ known }));
    expect(out.recipes[0].name).toBe("Ultra Thin Dough");
    expect(out.recipes[1].name).toBe("Thin Crust Dough");
    const messages = (out.warnings ?? []).map((w) => w.message);
    expect(messages).toContain(
      'Matched dough recipe "Ultra Thin Dough Recipe" to existing "Ultra Thin Dough".',
    );
    expect(
      messages.some((m) =>
        m.includes('New dough recipe "Thin Crust Dough" closely matches existing'),
      ),
    ).toBe(true);
  });

  it("makes no recipe-name change without known recipe names (back-compat)", () => {
    const raw = {
      profiles: [],
      recipes: [
        {
          kind: "dough",
          name: "Ultra Thin Dough Recipe",
          rows: [{ ingredient: "Flour", lbs: 50 }],
        },
      ],
    };
    const out = sanitizeParseSpecSheet(raw, input());
    expect(out.recipes[0].name).toBe("Ultra Thin Dough Recipe");
    expect(out.warnings).toBeUndefined();
  });
});

// The factory's existing sauce/frontline recipe names (known.sauceNames) ground
// a parsed profile's sauceName: a sauce the app already knows (e.g. ready-made
// "Marinara") is legitimate even when this particular sheet never spells it
// out, so it must NOT get a "not found on the sheet" warning — while an unknown
// paraphrase still snaps/flags as before.
describe("known sauceNames ground profile sauceName", () => {
  const workbookText =
    "Brand\tFlavor\tSauce\nLowes\tPepperoni\tsee sauce spec\n";
  const rawWithSauce = (sauceName: string) => ({
    profiles: [
      {
        brand: "Lowes",
        flavor: "Pepperoni",
        sauceName,
        applicators: [],
        pepperonis: [],
      },
    ],
    recipes: [],
  });

  it("does not warn for a known sauce name absent from the sheet", () => {
    const out = sanitizeParseSpecSheet(
      rawWithSauce("Marinara"),
      input({ known: { sauceNames: ["Marinara"] }, workbookText }),
    );
    expect(out.profiles[0]?.sauceName).toBe("Marinara");
    expect(out.warnings ?? []).toHaveLength(0);
  });

  it("still flags the same sauce name when it is not a known name", () => {
    const out = sanitizeParseSpecSheet(
      rawWithSauce("Marinara"),
      input({ known: {}, workbookText }),
    );
    expect(out.profiles[0]?.sauceName).toBe("Marinara");
    expect(
      (out.warnings ?? []).map((w) => (typeof w === "string" ? w : w.message)).join(" "),
    ).toContain("Marinara");
  });

  it("snaps an unknown paraphrase to the nearest known sauce name", () => {
    const out = sanitizeParseSpecSheet(
      rawWithSauce("Buffalo Wing Sauce"),
      input({
        known: { sauceNames: ["Hot Buffalo Sauce"] },
        workbookText: "Brand\tFlavor\tSauce\nLowes\tPepperoni\tHot Buffalo Sauce\n",
      }),
    );
    expect(out.profiles[0]?.sauceName).toBe("Hot Buffalo Sauce");
  });

  it("lists the known sauce names in the prompt", () => {
    const { user } = buildParseSpecSheetPrompt(
      input({ known: { sauceNames: ["Marinara", "BBQ Sauce"] } }),
    );
    expect(user).toContain("Sauce names (existing mixed or ready-made sauces): Marinara, BBQ Sauce");
  });
});

// A profile's doughName (the dough/crust the sheet names for the product) gets
// the same grounding treatment as sauceName: known dough recipe names are
// legitimate even off-sheet, unknown paraphrases snap to the nearest real name,
// and generic placeholders ("Dough"/"Pizza Dough"/"Crust") are dropped.
describe("profile doughName capture + grounding", () => {
  const workbookText =
    "Brand\tFlavor\tDough\nLowes\tPepperoni\tUltra Thin Dough\n";
  const rawWithDough = (doughName: string) => ({
    profiles: [
      {
        brand: "Lowes",
        flavor: "Pepperoni",
        doughName,
        applicators: [],
        pepperonis: [],
      },
    ],
    recipes: [],
  });

  it("keeps a dough name written on the sheet, without warning", () => {
    const out = sanitizeParseSpecSheet(
      rawWithDough("Ultra Thin Dough"),
      input({ known: {}, workbookText }),
    );
    expect(out.profiles[0]?.doughName).toBe("Ultra Thin Dough");
    expect(out.warnings ?? []).toHaveLength(0);
  });

  it("does not warn for a known dough recipe name absent from the sheet", () => {
    const out = sanitizeParseSpecSheet(
      rawWithDough("Sourdough Base"),
      input({
        known: { doughRecipes: ["Sourdough Base"] },
        workbookText: "Brand\tFlavor\tDough\nLowes\tPepperoni\tsee dough spec\n",
      }),
    );
    expect(out.profiles[0]?.doughName).toBe("Sourdough Base");
    expect(out.warnings ?? []).toHaveLength(0);
  });

  it("snaps an unknown paraphrase to the nearest known dough recipe name", () => {
    const out = sanitizeParseSpecSheet(
      rawWithDough("Skinny Thin Dough"),
      input({
        known: { doughRecipes: ["Ultra Thin Dough"] },
        workbookText,
      }),
    );
    expect(out.profiles[0]?.doughName).toBe("Ultra Thin Dough");
  });

  it("drops a generic placeholder dough name", () => {
    for (const generic of ["Dough", "Pizza Dough", "Crust"]) {
      const out = sanitizeParseSpecSheet(
        rawWithDough(generic),
        input({ known: {}, workbookText }),
      );
      expect(out.profiles[0]?.doughName).toBeUndefined();
    }
  });

  it("asks the model for doughName in the prompt + JSON shape", () => {
    const { system, user } = buildParseSpecSheetPrompt(input({}));
    expect(system).toContain("doughName");
    expect(user).toContain('"doughName":string');
  });
});

describe("known list bounds", () => {
  it("counts sauceNames toward the MAX_KNOWN_LIST bound", () => {
    const res = validateParseSpecSheetBody({
      workbookText: "x",
      known: { sauceNames: Array.from({ length: MAX_KNOWN_LIST + 1 }, (_, i) => `S${i}`) },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(400);
  });
});
