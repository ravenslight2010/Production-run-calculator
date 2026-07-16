import { AiParseSpecSheetBody } from "@workspace/api-zod";
import {
  dropConflictingSpecAliases,
  sanitizeParsedSpecImport,
  type ParsedSpecImport,
  type SpecImportAlias,
} from "@workspace/spec-import";
import * as z from "zod";

// Bounds so a single request can't blow up cost/latency. Mirrors the photo /
// optimize / fill-missing / match-import endpoint guards.
export const MAX_WORKBOOK_CHARS = 60_000;
export const MAX_KNOWN_LIST = 4000;
export const MAX_ALIASES = 4000;

export type ParseSpecSheetInput = z.infer<typeof AiParseSpecSheetBody>;

export type ParseSpecSheetValidationResult =
  | { ok: true; data: ParseSpecSheetInput }
  | { ok: false; status: number; error: string };

// Validate and bound-check the request body for POST /ai/parse-spec-sheet.
export function validateParseSpecSheetBody(body: unknown): ParseSpecSheetValidationResult {
  const parsed = AiParseSpecSheetBody.safeParse(body);
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.message };
  }
  const data = parsed.data;
  const text = (data.workbookText ?? "").trim();
  if (!text) {
    return { ok: false, status: 400, error: "Empty workbook" };
  }
  if (text.length > MAX_WORKBOOK_CHARS) {
    return { ok: false, status: 400, error: `Workbook too large (max ${MAX_WORKBOOK_CHARS} chars)` };
  }
  const known = data.known ?? {};
  const knownTotal =
    (known.brands?.length ?? 0) +
    Object.values(known.flavorsByBrand ?? {}).reduce((a, l) => a + (l?.length ?? 0), 0) +
    (known.appTypes?.length ?? 0) +
    (known.pepTypes?.length ?? 0) +
    (known.cheeseIngredients?.length ?? 0) +
    (known.doughIngredients?.length ?? 0) +
    (known.sauceIngredients?.length ?? 0) +
    (known.sauceNames?.length ?? 0) +
    (known.dieTypes?.length ?? 0) +
    (known.doughRecipes?.length ?? 0) +
    (known.sauceRecipes?.length ?? 0) +
    (known.cheeseRecipes?.length ?? 0);
  if (knownTotal > MAX_KNOWN_LIST) {
    return { ok: false, status: 400, error: `Too many known names (max ${MAX_KNOWN_LIST})` };
  }
  if ((data.aliases?.length ?? 0) > MAX_ALIASES) {
    return { ok: false, status: 400, error: `Too many aliases (max ${MAX_ALIASES})` };
  }
  return { ok: true, data };
}

// The model returns structured JSON but is not trustworthy — the lib's
// sanitizer coerces/bounds/drops anything malformed and never throws. Passing the
// parsed input lets the sanitizer ground target flavors against the source
// workbook + known flavors and demote invented ones to whole-brand anchors.
export function sanitizeParseSpecSheet(raw: unknown, input?: ParseSpecSheetInput): ParsedSpecImport {
  const names = (list?: string[]) =>
    (list ?? []).filter((s): s is string => typeof s === "string" && s.length > 0);
  const grounding = input
    ? {
        sourceText: input.workbookText ?? "",
        knownFlavors: Object.values(input.known?.flavorsByBrand ?? {})
          .flat()
          .filter((f): f is string => typeof f === "string" && f.length > 0),
        knownBrands: names(input.known?.brands),
        // Existing recipe names per kind so a paraphrased recipe name snaps to
        // (or is flagged against) the factory's existing recipe instead of
        // silently importing as a near-duplicate.
        knownRecipeNames: {
          dough: names(input.known?.doughRecipes),
          sauce: names(input.known?.sauceRecipes),
          cheese: names(input.known?.cheeseRecipes),
        },
        // Existing sauce/frontline recipe names (incl. ready-made sauces the
        // factory already pulls, e.g. "Marinara"): a profile sauceName matching
        // one of these is legitimate even when it isn't written on this
        // particular sheet, so the sanitizer must not false-flag it.
        knownSauceNames: names(input.known?.sauceNames),
      }
    : {};
  // NOTE: embedded applicator blends are deliberately NOT unpacked here — this
  // sanitizer runs per chunk, and per-chunk extraction can collide same-named
  // variants across chunks. Clients run extractEmbeddedApplicatorBlends() once
  // over the MERGED workbook parse instead (see prepareSpecImport in each app).
  return sanitizeParsedSpecImport(raw, {}, grounding);
}

// Shape the validated input into a compact, model-friendly prompt. Heavy shaping
// lives server-side (contract-first design) so both clients stay thin/identical.
export function buildParseSpecSheetPrompt(input: ParseSpecSheetInput): {
  system: string;
  user: string;
} {
  const system =
    "You read a frozen-pizza factory's uploaded Excel workbook (flattened to " +
    "tab-separated text) and extract two things: (1) SPEC PROFILES — one per " +
    "brand+flavor — with the cheese/topping applicators (type + oz per pizza, up " +
    "to 4), pepperonis (type + sticks + oz per pizza, up to 2), the die type, and " +
    "the sauce oz per pizza; and (2) RECIPES — dough, sauce, and cheese ingredient " +
    "lists (each row an ingredient name + pounds). The BRAND is the product-line " +
    "name from the block header, kept IN FULL including any distinguishing qualifier " +
    "such as 'Original', 'Ultra Thin', 'Thin Crust', 'Deep Dish', or 'Gluten Free' — " +
    "drop only generic trailing words like 'Pizzas', 'Pizza', 'Recipe', or 'Specs'. " +
    "Two sheets from the same company but different product lines are DIFFERENT " +
    "brands: a header 'Basha's Original Pizzas' is brand='Basha's Original' and " +
    "'Basha's Ultra Thin Crust Pizzas' is brand='Basha's Ultra Thin Crust' — never " +
    "collapse them to a bare company name like 'Basha', or their identical flavor " +
    "names (Cheese, Pepperoni) will overwrite each other. Do NOT match a qualified " +
    "product-line brand to a shorter KNOWN brand that merely lacks the qualifier. " +
    "ONLY when a sheet has no product-line qualifier and instead distinguishes " +
    "purely by SIZE (e.g. a 7in vs an 11in version of the same line) do you fold the " +
    "size INTO THE BRAND name (e.g. brand 'Lowes 7in' and brand 'Lowes 11in'); never " +
    "put the size or the product line in the flavor. So a 7in pepperoni Lowes pizza " +
    "is brand='Lowes 7in', flavor='Pepperoni', NOT brand='Lowes', flavor='7in " +
    "Pepperoni'. Apply this same brand rule to recipe brand/flavor and `targets` the " +
    "same way. Spreadsheets are messy: merged " +
    "headers, abbreviations, varied layouts, blanks. Infer the structure. When a " +
    "name closely matches one of the provided KNOWN canonical names, RETURN THE " +
    "KNOWN NAME VERBATIM (so existing profiles/recipes are updated, not " +
    "duplicated); otherwise return the workbook's name as-is (a new one will be " +
    "created). Use the provided ALIASES as authoritative label→canonical mappings. " +
    "A SINGLE recipe often applies to MANY brand+flavor profiles — typically a " +
    "list of 'Brand: flavors' header rows sitting above ONE shared ingredient " +
    "table (very common for dough mixing procedures). In that case return ONE " +
    "recipe whose `targets` array lists every {brand, flavor} it covers; do NOT " +
    "emit a separate duplicate recipe per brand/flavor. Expand a 'Brand: All' (or " +
    "flavor-less) header to each KNOWN flavor of that brand from the flavors-by-" +
    "brand list; if that brand has no known flavors, add ONE whole-brand target with " +
    "the `flavor` LEFT EMPTY (never invent a specific flavor) and mention the " +
    "uncertainty in `note`. Use the " +
    "singular `brand`/`flavor` fields only when a recipe ties to exactly one profile. " +
    "Be AGGRESSIVE about populating `targets`: whenever a recipe could reasonably " +
    "serve more than one brand+flavor (any header listing several names, a shared " +
    "mixing table, a 'standard dough' used line-wide), list EVERY {brand, flavor} it " +
    "covers rather than leaving `targets` empty or splitting it into duplicate " +
    "recipes. A shared recipe with an empty `targets` array is almost always a " +
    "mistake — link it to the profiles it belongs to. " +
    "SOME workbooks are ONE standalone PROCEDURE for a single product line rather " +
    "than a per-flavor spec grid — e.g. a sheet titled 'ALDO PIZZA SAUCE " +
    "PROCEDURE', 'ALDO'S DOUGH MIXING PROCEDURE', or a per-customer cheese tab. " +
    "For these, take the product-line BRAND from the sheet title or tab name " +
    "(apply the brand rule above: drop generic words like 'Procedure', 'Mixing', " +
    "'Pizza Sauce', 'Recipe', and drop a trailing SIZE such as 12\" when it is only " +
    "a doughball/measurement spec, not a distinct product line), set the recipe's " +
    "`brand` to it, and LEAVE `flavor` EMPTY and `targets` EMPTY — a recipe with a " +
    "brand and no flavor already applies to EVERY flavor of that brand, which is " +
    "exactly what a shared sauce, dough, or standard-cheese procedure means. Do NOT " +
    "invent a placeholder flavor like 'Dough' and do NOT fold the size into the " +
    "brand here. BUT distinguish a CUSTOMER/product-line name from a SAUCE/DOUGH " +
    "TYPE name: a title like 'Lucia', 'Medulla', 'Aldo', \"Lowe's\", \"Member's " +
    "Selection\" is a customer -> use it as `brand`; a title that is only a recipe " +
    "TYPE with no customer -- e.g. 'Garlic Alfredo Sauce', 'Gravy Sauce', 'Masa " +
    "Dough', 'Malted Barley Dough', 'Margherita Dough' -- is NOT a brand: set the " +
    "recipe `name` to that type and LEAVE `brand` EMPTY so it imports as a shared " +
    "library recipe for manual assignment. If the sheet BODY names the customers it " +
    "is used for (e.g. a note 'This recipe used for Hannaford and Lucia'), put EACH " +
    "of those in `targets` — one entry per brand with the `flavor` LEFT EMPTY " +
    "(whole-brand). NEVER invent or guess a specific flavor for such a shared " +
    "procedure (do not turn 'Masa' into 'Masala', etc.); an empty flavor already " +
    "means every flavor of that brand. A doughball/yield table near the bottom " +
    "often lists the customers this recipe feeds, one row per customer, sometimes " +
    "with the product in parentheses like 'Hannaford (Masala Pizza)' — treat each " +
    "such row as a target (brand = the customer, flavor = the parenthesized " +
    "product ONLY if one is written; otherwise leave flavor EMPTY). If ONE cell " +
    "lists SEVERAL customers joined by '&', 'and', '/', or '+' (e.g. \"Lucia's " +
    "Craft & 4Hands\", \"Hannaford / Lowe's\"), SPLIT it into one target PER " +
    "customer, each carrying the SAME flavor — do NOT emit a combined brand like " +
    "\"Lucia's Craft & 4Hands\". BUT do NOT split a single company name that " +
    "legitimately contains '&' (e.g. 'Maria & Son', 'Ben & Jerry's', 'M&M') — " +
    "those stay ONE brand. " +
    "For a standalone procedure sheet, the recipe `name` is the FULL product " +
    "title on the sheet minus generic process words (e.g. a 'MYSTIC PIZZA SAUCE " +
    "PROCEDURE' sheet becomes name 'Mystic Pizza Sauce'); do NOT peel the first " +
    "word off the title into `brand` (never name 'Pizza Sauce' with brand " +
    "'Mystic') — if it is a recipe TYPE with no customer, leave `brand` EMPTY. " +
    "ONLY populate `targets` when the sheet EXPLICITLY maps a recipe to " +
    "specific flavors (e.g. a cheese tab listing 'Pepperoni: X Mix', 'Hawaiian: Y " +
    "Mix' — then target those brand+flavor pairs); an 'All Varieties' or 'Standard' " +
    "mix stays brand-level with an empty flavor. " +
    "EVERY recipe MUST have a non-empty `name`. A recipe's name is usually the " +
    "label directly above or beside its ingredient table (e.g. 'Standard Dough', " +
    "'Pizza Sauce', 'Cheese Blend'); if the table itself is unlabeled, name it " +
    "from its section/brand plus its kind (e.g. \"<Brand> Dough\", \"<Brand> " +
    "Sauce\", \"<Brand> Cheese Blend\"). Never return a recipe with a blank name; " +
    "if you truly cannot find one, synthesize a short descriptive one from context. " +
    "CLASSIFY each recipe's `kind` carefully — dough vs sauce vs cheese: a DOUGH " +
    "recipe is the crust/mixing formula (flour, water, yeast, oil, salt, sugar, " +
    "dough conditioner); a SAUCE recipe is the tomato/pizza-sauce blend (tomato " +
    "paste or puree, water, spices, oil, sugar, salt); a CHEESE recipe is the " +
    "cheese-and-topping blend applied on top (mozzarella, provolone, blends, cheese " +
    "substitute). When a table lists cheeses/toppings by the pound it is CHEESE, not " +
    "SAUCE, even if it sits near the sauce section; only a tomato-based blend is " +
    "SAUCE. Use the section heading and the ingredient names together — do not " +
    "assume position alone. STICK-APPLIED TOPPINGS ARE NOT A RECIPE: a topping " +
    "applied as whole sticks through the stick applicator — pepperoni (including " +
    "'pepperoni sticks') AND cheese sticks (e.g. 'Cheese Stick', 'Mozzarella " +
    "Stick') — is a profile PEPPERONI (that is the stick-type slot): capture it " +
    "in that profile's `pepperonis` list (type + sticks + oz per pizza) and NEVER " +
    "emit it as a cheese or topping recipe; do not create a recipe whose " +
    "ingredients are only such sticks. THE ONE EXCEPTION IS DICED PEPPERONI: " +
    "diced pepperoni is a topping and stays part of a CHEESE/topping recipe, NOT " +
    "a profile pepperoni. " +
    "APPLICATOR STATIONS: the physical line runs Applicator 1, Applicator 2, then " +
    "the pep/stick applicators, then Applicator 3, Applicator 4 — the pep " +
    "applicators sit BETWEEN stations 2 and 3. The sheet's layout IS the line " +
    "layout and must be preserved exactly: whenever a profile has pepperoni/stick " +
    "entries, every applicator's position relative to those pep rows determines " +
    "its station — applicators listed BEFORE the pep entries are stations 1 then " +
    "2 (in listed order), applicators listed AFTER the pep entries are stations 3 " +
    "then 4 (in listed order). Example: a sheet showing one applicator, then the " +
    "pep rows, then one more applicator means slot 1 and slot 3 — NOT 1 and 2. " +
    "Set `slot` (1-4) accordingly on every such applicator. An explicit " +
    "station/applicator number on the sheet also sets `slot`. Only omit `slot` " +
    "when the profile has no pep entries and no station labels, so the position " +
    "truly is not discernible — never guess. " +
    "DUPLICATE APPLICATORS: a pizza can run the SAME topping or blend on TWO " +
    "different applicator stations at DIFFERENT per-pizza weights (e.g. the same " +
    "cheese mix applied under and over the toppings). When a profile's sheet lists " +
    "the same ingredient/blend name on two applicator rows or columns, emit TWO " +
    "separate entries in that profile's `applicators` — one per station, each with " +
    "its OWN `ozPerPizza` exactly as written (and its own `slot` when discernible). " +
    "NEVER collapse same-named applicators into one entry, never add their weights " +
    "together, and never copy one station's weight onto the other. A second entry " +
    "requires a genuinely SEPARATE applicator row/column/station on the sheet: " +
    "tolerance or range numbers attached to a single station — a \u00b1 value, a " +
    "min/max pair, an over/under allowance, or any small check-weight figure printed " +
    "next to the target weight — are NOT another applicator; never emit them as a " +
    "second same-named entry (a target of 3.65 with a \u00b10.2 tolerance is ONE " +
    "applicator at 3.65, not two). " +
    "EMBEDDED BLENDS: some spec grids pack a full blend recipe into ONE applicator " +
    "cell — a mix name followed by number+ingredient pairs, e.g. \"Aldo's Cheese " +
    "Mix 1.75 Pizella, 1.0 Part Skim Mozzarella, 0.1 Grated Parmesan\" or 'White " +
    "Fajita Mix 0.563 Blanched White Onion Strips, 0.563 Blanched Green Pepper " +
    "Strips'. When an applicator cell embeds a composition like this: set that " +
    "applicator's `type` to the CLEAN mix name ONLY (the text before the first " +
    "number, e.g. \"Aldo's Cheese Mix\") and ALSO emit ONE CHEESE-kind RECIPE " +
    "named that clean mix name whose rows are the number+ingredient pairs (each " +
    "number is that ingredient's `lbs`). Many profiles often share the same " +
    "embedded blend — emit the recipe ONCE and reuse the clean name in each " +
    "profile's applicator `type`. The SAME mix name is ONE recipe even when it " +
    "appears at different per-pizza amounts or on different flavors: the per-pizza " +
    "weight belongs on the applicator (`ozPerPizza`), NOT in the recipe name, so " +
    "give the recipe the BASE blend name only — never append a weight, a number, a " +
    "flavor, or any other suffix to distinguish copies, and never emit two recipes " +
    "for one blend. NEVER leave the raw composition text inside an applicator " +
    "`type` — the type must be that same short reusable base name. " +
    "NAMED BLENDS ON APPLICATORS: an applicator `type` of just a generic word " +
    "like 'Mix', 'Blend', 'Cheese Mix', or 'Topping' is almost always WRONG — " +
    "the workbook nearly always names the specific blend somewhere: in the " +
    "applicator cell itself, in a nearby row/column or legend, or as the heading " +
    "of the matching blend recipe table elsewhere in the workbook (match by the " +
    "listed ingredients/amounts when several tables exist). Hunt for that name " +
    "and use it as the applicator `type` VERBATIM, spelled exactly like the " +
    "recipe's `name`, so the app can link the applicator to its recipe. Only " +
    "fall back to a generic type when the workbook truly never names the blend " +
    "anywhere. " +
    "NAMED DOUGH VARIANTS: a dough sheet's doughball/yield table sometimes lists " +
    "NAMED dough variants (e.g. rows or columns labeled 'Heavy', 'Heavy Plus', " +
    "'Light') with their own doughball weights or per-tray counts, all sharing " +
    "ONE mixing table. Emit ONE dough recipe PER NAMED VARIANT: each named for " +
    "the variant (e.g. \"<Brand> Heavy Plus\"), each carrying the SAME ingredient " +
    "rows, and each with its OWN `doughballOz`/`doughballsPerTray`/" +
    "`doughBatchYield` and its own `targets` (the customers/products that yield " +
    "row serves). Never collapse named variants into one recipe or drop a " +
    "variant name — a profile's `doughName` may reference the variant (e.g. " +
    "'CRB Heavy Plus') and must find a recipe with that exact name. " +
    "READ NUMBERS EXACTLY as written — copy the digits verbatim (e.g. 3.5 stays " +
    "3.5, 12 stays 12); never round, rescale, or guess a number. Keep each number " +
    "in its correct field and NEVER swap fields: `ozPerPizza`/`sauceOzPerPizza` are " +
    "ounces PER PIZZA, while a recipe row's `lbs` is a RAW numeric field holding the " +
    "amount exactly as written on the sheet (the sheet may label it pounds OR ounces " +
    "— see RECIPE ROW UNITS). Do not put a per-pizza ounce figure into a recipe row " +
    "or vice-versa, and never convert any number between units. " +
    "RECIPE ROW UNITS: this factory's sheets normally write recipe ingredient " +
    "amounts in OUNCES. Copy each amount verbatim into that row's `lbs`, and " +
    "REPORT the unit on the recipe via `rowsUnit`: \"oz\" when the sheet marks " +
    "those amounts as ounces (an oz/ozs/ounces column header or label), \"lbs\" " +
    "ONLY when the sheet explicitly marks them as pounds. Omit `rowsUnit` when " +
    "the sheet states no unit — the app then assumes ounces. NEVER convert the " +
    "numbers yourself — the app converts ounces to pounds after reading. " +
    "`sticks` is a whole-pepperoni-stick count, separate from its oz/pizza. Match " +
    "each value to the correct brand/flavor/ingredient row it sits on; if a cell is " +
    "blank or unreadable, omit that field rather than borrowing a neighbor's number. " +
    "Never invent data that is not in the workbook. Omit fields you cannot find. " +
    "When a spec sheet NAMES a specific sauce on its sauce row (e.g. 'BBQ Sauce', " +
    "'Ranch'), capture that name as the profile's `sauceName` — purchased/ready-made " +
    "sauces come as-is and have no mixing recipe in the workbook, so the name is the " +
    "only way the app can identify what to pull. Omit `sauceName` when the sheet just " +
    "says a generic 'sauce' without naming one. " +
    "Likewise, when a spec sheet NAMES a specific dough or crust for a product (e.g. " +
    "'Ultra Thin Dough', a 'Dough'/'Crust' row or column naming one), capture that name " +
    "as the profile's `doughName` — even when this workbook carries no dough mixing " +
    "recipe, the name lets the app link the product to its dough recipe imported later. " +
    "Omit `doughName` when the sheet just says a generic 'dough'/'crust' without naming one. " +
    "This is read-only; the user reviews and can edit a summary before anything is saved.";

  const known = input.known ?? {};
  const lines: string[] = [];
  const list = (label: string, items?: string[]) => {
    lines.push(`${label}: ${items && items.length ? items.join(", ") : "(none)"}`);
  };
  lines.push("KNOWN CANONICAL NAMES (reuse verbatim when the workbook clearly means one):");
  list("Brands", known.brands);
  const flavorLines = Object.entries(known.flavorsByBrand ?? {})
    .filter(([, f]) => (f?.length ?? 0) > 0)
    .map(([brand, f]) => `  - ${brand}: ${f.join(", ")}`);
  lines.push("Flavors by brand:");
  lines.push(flavorLines.length ? flavorLines.join("\n") : "  (none)");
  list("Applicator types", known.appTypes);
  list("Pepperoni types", known.pepTypes);
  list("Cheese ingredients", known.cheeseIngredients);
  list("Dough ingredients", known.doughIngredients);
  list("Sauce ingredients", known.sauceIngredients);
  list("Sauce names (existing mixed or ready-made sauces)", known.sauceNames);
  list("Die types", known.dieTypes);
  list("Dough recipe names", known.doughRecipes);
  list("Sauce recipe names", known.sauceRecipes);
  list("Cheese recipe names", known.cheeseRecipes);

  // Drop incoherent (cyclic/chained) learned aliases before handing them to the
  // model, so polluted/contradictory mappings can't make the AI mis-rename and
  // collide otherwise-valid names. Mirrors the client's canonicalize() guard.
  const safeAliases = dropConflictingSpecAliases(
    (input.aliases ?? []) as ReadonlyArray<SpecImportAlias>,
  );
  if (safeAliases.length) {
    lines.push("");
    lines.push("KNOWN ALIASES (apply these label→canonical mappings):");
    lines.push(
      safeAliases
        .map(
          (a) =>
            `  - [${a.kind}] "${a.externalName}" => "${a.canonicalName}"` +
            (a.context ? ` (within ${a.context})` : ""),
        )
        .join("\n"),
    );
  }

  lines.push("");
  lines.push("WORKBOOK:");
  lines.push(input.workbookText);

  lines.push("");
  lines.push(
    "Return ONLY JSON of the exact shape: " +
      '{"profiles":[{"brand":string,"flavor":string,"dieType":string,' +
      '"sauceOzPerPizza":number,"sauceName":string,"doughName":string,"allergen":string,' +
      '"pizzasPerCase":number,"sauceBarrelLbs":number,' +
      '"applicators":[{"type":string,"ozPerPizza":number,"batchLbs":number,"slot":number}],' +
      '"pepperonis":[{"type":string,"sticks":number,"ozPerPizza":number,"batchLbs":number}]}],' +
      '"recipes":[{"kind":"dough"|"sauce"|"cheese","name":string,"brand":string,' +
      '"flavor":string,"targets":[{"brand":string,"flavor":string}],' +
      '"doughballOz":number,"doughBatchYield":number,"doughballsPerTray":number,' +
      '"app":number,"rowsUnit":"lbs"|"oz",' +
      '"rows":[{"ingredient":string,"lbs":number}]}],"note":string}. ' +
      "Omit any field or row you cannot determine. Prefer `targets` for a recipe that " +
      "serves multiple brand/flavor profiles (one recipe, many targets); use the singular " +
      "brand/flavor only when it ties to exactly one. For cheese recipes, set \"app\" to the " +
      "applicator slot number (1-4) it belongs to when discernible. Set \"allergen\" to the food " +
      "allergen the sheet designates for a product (e.g. \"egg\", \"soy\", or another named " +
      "allergen); use \"none\" or omit it when the sheet lists no allergen. Set " +
      "\"pizzasPerCase\" to the case pack (how many pizzas per case) when the sheet states it. " +
      "Set batch/yield sizes ONLY when the sheet explicitly states a made-batch size — never " +
      "compute or guess them from ingredient rows: \"batchLbs\" is the pounds one made batch of a " +
      "topping or pepperoni weighs, \"sauceBarrelLbs\" the pounds one sauce barrel weighs, and " +
      "\"doughBatchYield\" the number of crusts one dough batch yields. Set " +
      "\"doughballsPerTray\" to the number of doughballs per tray when a dough sheet states it. " +
      "Use \"note\" only for a brief overall comment (e.g. what you could not parse).",
  );

  return { system, user: lines.join("\n") };
}
