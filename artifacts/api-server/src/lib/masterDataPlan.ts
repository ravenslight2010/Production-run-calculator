import { createHash } from "node:crypto";
import type { MasterDataEntity, MasterDataReferenceFact } from "@workspace/db/schema";

type Row = Record<string, any>;
export type MasterDataWorld = Record<MasterDataEntity, Row[]>;
export type MasterDataCommand = {
  action: "add" | "remove" | "rename" | "merge" | "move";
  category: "brand" | "flavor" | "applicator" | "pep" | "die" | "ingredient"
    | "doughIngredient" | "sauceIngredient" | "cheeseIngredient" | "mixIngredient"
    | "dough" | "sauce" | "cheese" | "mix";
  sources: string[];
  target?: string;
  brand?: string;
  destination?: "dough" | "sauce" | "cheese" | "mix";
};

export class MasterDataPlanError extends Error {}
export const masterNameKey = (value: unknown) => String(value ?? "").trim().toLowerCase();
export function canonicalMasterJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalMasterJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalMasterJson(child)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export const masterHash = (value: unknown) => createHash("sha256").update(canonicalMasterJson(value)).digest("hex");
export const masterJsonClone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const categories = new Set([
  "brand", "flavor", "applicator", "pep", "die", "ingredient", "doughIngredient",
  "sauceIngredient", "cheeseIngredient", "mixIngredient", "dough", "sauce", "cheese", "mix",
]);
const actions = new Set(["add", "remove", "rename", "merge", "move"]);
const recipeEntities: Partial<Record<MasterDataCommand["category"], MasterDataEntity>> = {
  dough: "doughRecipes", sauce: "sauceRecipes", cheese: "cheeseRecipes", mix: "mixes",
};
const ingredientCategories: Partial<Record<MasterDataCommand["category"], string>> = {
  ingredient: "general", doughIngredient: "dough", sauceIngredient: "frontline",
  cheeseIngredient: "cheese", mixIngredient: "mix", pep: "pep", applicator: "general",
};
const directoryKeys: Partial<Record<MasterDataCommand["category"], string>> = {
  brand: "run-calc-brands", applicator: "run-calc-ingredient-types", pep: "run-calc-pep-types",
  die: "run-calc-die-types", doughIngredient: "run-calc-dough-ingredients",
  sauceIngredient: "run-calc-frontline-ingredients", cheeseIngredient: "run-calc-cheese-ingredients",
  mixIngredient: "run-calc-mix-ingredients", dough: "run-calc-dough-recipe-names",
  sauce: "run-calc-frontline-recipe-names", cheese: "run-calc-cheese-recipe-names", mix: "run-calc-mix-recipe-names",
};
const recipeFields: Record<string, string[]> = {
  dough: ["doughRecipeName"], sauce: ["frontlineRecipeName"],
  cheese: ["app1CheeseRecipeName", "app2CheeseRecipeName", "app3CheeseRecipeName", "app4CheeseRecipeName"],
  mix: ["app1CheeseRecipeName", "app2CheeseRecipeName", "app3CheeseRecipeName", "app4CheeseRecipeName"],
  applicator: ["app1Type", "app2Type", "app3Type", "app4Type"],
  pep: ["pep1Type", "pep1TypeB", "pep2Type", "pep2TypeB"],
  die: ["dieType"],
};
const recipeRowFields = ["doughRecipe", "frontlineRecipe", "app1CheeseRecipe", "app2CheeseRecipe", "app3CheeseRecipe", "app4CheeseRecipe"];

export function parseMasterDataCommand(input: unknown): MasterDataCommand {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new MasterDataPlanError("Invalid shared-data command.");
  const value = input as Row;
  if (Object.keys(value).some((key) => !["action", "category", "sources", "target", "brand", "destination"].includes(key))
    || !actions.has(value.action) || !categories.has(value.category)
    || !Array.isArray(value.sources) || value.sources.length < 1 || value.sources.length > 50) {
    throw new MasterDataPlanError("Invalid shared-data command.");
  }
  const name = (item: unknown): string => {
    if (typeof item !== "string" || !item.trim() || item.trim().length > 200 || /[\u0000-\u001f\u007f]/u.test(item)
      || ["__proto__", "constructor", "prototype"].includes(item.trim().toLowerCase())) {
      throw new MasterDataPlanError("Names must be non-empty, at most 200 characters, with no control characters.");
    }
    return item.trim();
  };
  const command: MasterDataCommand = {
    action: value.action, category: value.category,
    sources: [...new Map(value.sources.map((item: unknown) => { const n = name(item); return [masterNameKey(n), n]; })).values()] as string[],
    ...(value.target === undefined ? {} : { target: name(value.target) }),
    ...(value.brand === undefined ? {} : { brand: name(value.brand) }),
    ...(value.destination === undefined ? {} : { destination: value.destination }),
  };
  if (command.action !== "merge" && command.sources.length !== 1) throw new MasterDataPlanError("This action requires one source name.");
  if (value.destination !== undefined && command.action !== "move") throw new MasterDataPlanError("Only a recipe move can specify a destination.");
  if (value.brand !== undefined && command.category !== "flavor") throw new MasterDataPlanError("Only a scoped flavor action can specify a brand.");
  if (value.target !== undefined && !["rename", "merge"].includes(command.action)) throw new MasterDataPlanError("Only a rename or merge can specify a target.");
  if (["rename", "merge"].includes(command.action) && !command.target) throw new MasterDataPlanError("Choose a target name.");
  if (command.category === "flavor" && !command.brand) throw new MasterDataPlanError("Choose the flavor's brand.");
  if (command.action === "move" && (!recipeEntities[command.category] || !recipeEntities[command.destination ?? "brand"]
    || command.category === command.destination)) throw new MasterDataPlanError("Choose a different recipe category.");
  return command;
}

/** Names and facts are server-derived; intent never contains rows or browser keys. */
export function buildMasterDataPlan(
  before: MasterDataWorld,
  command: MasterDataCommand,
  operationId: string,
): { after: MasterDataWorld; rewriteValues(value: Row): Row; rewriteMeta(value: Row): Row; description: string } {
  const after = masterJsonClone(before);
  const sourceKeys = new Set(command.sources.map(masterNameKey));
  const matches = (value: unknown) => sourceKeys.has(masterNameKey(value));
  const target = command.action === "remove" || command.action === "move" ? "" : command.target ?? command.sources[0]!;
  const replace = (value: unknown) => matches(value) ? target : value;
  const category = command.category;
  const recipeEntity = recipeEntities[category];
  const ingCategory = ingredientCategories[category];
  const stableId = (suffix: string) => `master-${operationId}-${suffix}`;
  if (category === "flavor" && !before.directories.some((row) => row.key === "run-calc-brands" && Array.isArray(row.value)
    && row.value.some((name: unknown) => masterNameKey(name) === masterNameKey(command.brand)))
    && !before.profiles.some((row) => masterNameKey(row.brand) === masterNameKey(command.brand))) {
    throw new MasterDataPlanError("Choose an existing canonical brand before changing its flavors.");
  }
  const objectDirectory = (key: string): Row => {
    let row = after.directories.find((entry) => entry.key === key);
    if (!row) { row = { key, value: {} }; after.directories.push(row); }
    if (!row.value || typeof row.value !== "object" || Array.isArray(row.value)) throw new MasterDataPlanError("Canonical directory metadata needs review.");
    return row.value;
  };
  const list = (key: string, mutate: (items: string[]) => string[]) => {
    let row = after.directories.find((entry) => entry.key === key);
    if (!row) { row = { key, value: [] }; after.directories.push(row); }
    if (!Array.isArray(row.value) || !row.value.every((item: unknown) => typeof item === "string")) {
      throw new MasterDataPlanError("A canonical name list needs manager review before this action.");
    }
    row.value = [...new Map(mutate(row.value).filter(Boolean).map((name) => [masterNameKey(name), name])).values()];
  };
  const directory = directoryKeys[category];
  if (directory) list(directory, (items) => command.action === "add" ? [...items, ...command.sources]
    : [...items.filter((name) => !matches(name)), ...(target ? [target] : [])]);
  if (ingCategory && ["rename", "merge"].includes(command.action)) {
    for (const key of ["run-calc-ingredient-types", "run-calc-pep-types", "run-calc-dough-ingredients", "run-calc-frontline-ingredients",
      "run-calc-cheese-ingredients", "run-calc-mix-ingredients"]) {
      if (key !== directory && before.directories.some((row) => row.key === key && Array.isArray(row.value) && row.value.some(matches))) {
        list(key, (items) => items.map((name) => matches(name) ? target : name));
      }
    }
  }
  if (category === "flavor" || category === "brand") {
    let row = after.directories.find((entry) => entry.key === "run-calc-brand-flavors");
    if (!row) { row = { key: "run-calc-brand-flavors", value: {} }; after.directories.push(row); }
    if (!row.value || typeof row.value !== "object" || Array.isArray(row.value)) throw new MasterDataPlanError("Brand/flavor assignments need manager review.");
    if (category === "flavor") {
      const key = Object.keys(row.value).find((brand) => masterNameKey(brand) === masterNameKey(command.brand)) ?? command.brand!;
      const current = row.value[key] ?? [];
      if (!Array.isArray(current)) throw new MasterDataPlanError("Flavor assignments need manager review.");
      row.value[key] = [...new Set(command.action === "add" ? [...current, ...command.sources]
        : [...current.filter((name: string) => !matches(name)), ...(target ? [target] : [])])];
    } else if (command.action !== "add") {
      const destinationKey = Object.keys(row.value).find((brand) => masterNameKey(brand) === masterNameKey(target)) ?? target;
      for (const key of Object.keys(row.value)) {
        if (!matches(key) || key === destinationKey) continue;
        if (target) row.value[destinationKey] = [...new Set([...(row.value[destinationKey] ?? []), ...row.value[key]])];
        delete row.value[key];
      }
    }
  }
  // Reserved generic classifications are not renameable master records.
  if (["applicator", "pep", "die"].includes(category)
    && command.sources.some((name) => ["none", "n/a", "cheese", "mix"].includes(masterNameKey(name)))) {
    throw new MasterDataPlanError("This reserved classification cannot be removed, renamed, or merged.");
  }
  let targetIngredientId: string | undefined;
  if (ingCategory) {
    const sources = after.ingredients.filter((row) => matches(row.name) && row.enabled && !row.mergedInto);
    let survivor = after.ingredients.find((row) => masterNameKey(row.name) === masterNameKey(target) && row.enabled && !row.mergedInto);
    if (command.action === "add") {
      if (survivor) survivor.categories = [...new Set([...(survivor.categories ?? []), ingCategory])];
      else {
        const dormant = after.ingredients.find((row) => masterNameKey(row.name) === masterNameKey(target) && !row.enabled && !row.mergedInto);
        if (dormant) { dormant.enabled = true; dormant.name = target; dormant.categories = [...new Set([...(dormant.categories ?? []), ingCategory])]; }
        else after.ingredients.push({ id: stableId("ingredient"), name: target, categories: [ingCategory], enabled: true, mergedInto: null });
      }
    } else if (command.action === "remove") {
      for (const row of sources) {
        if (category === "ingredient") row.enabled = false;
        else { row.categories = (row.categories ?? []).filter((item: string) => item !== ingCategory); if (!row.categories.length) row.enabled = false; }
      }
    } else {
      if (!sources.length && !survivor) {
        const knownDirectoryName = before.directories.some((row) => /^run-calc-(?:ingredient-types|pep-types|(?:dough|frontline|cheese|mix)-ingredients)$/u.test(row.key)
          && Array.isArray(row.value) && row.value.some(matches));
        if (!knownDirectoryName) throw new MasterDataPlanError("The source ingredient no longer exists. Refresh the canonical list.");
        survivor = { id: stableId("ingredient"), name: target, categories: [ingCategory], enabled: true, mergedInto: null };
        after.ingredients.push(survivor);
      }
      if (!survivor) { survivor = sources[0]!; survivor.name = target; }
      survivor.name = target;
      survivor.categories = [...new Set([...(survivor.categories ?? []), ...sources.flatMap((row) => row.categories ?? [])])];
      targetIngredientId = survivor.id;
      for (const row of sources) if (row.id !== survivor.id) { row.enabled = false; row.mergedInto = survivor.id; }
    }
  }
  if (recipeEntity) {
    const sources = after[recipeEntity].filter((row) => matches(row.name) && row.enabled);
    const identities = new Set<string>();
    for (const row of sources) {
      const key = JSON.stringify([masterNameKey(row.brand), masterNameKey(row.name)]);
      if (identities.has(key) && command.action === "merge") throw new MasterDataPlanError("Several active recipes share this name and brand. Review their identities before merging them.");
      identities.add(key);
    }
    if (command.action === "add") {
      if (sources.length) throw new MasterDataPlanError("This recipe already exists. Refresh its canonical record instead of adding it again.");
      after[recipeEntity].push({ id: stableId(category), name: target, components: [], enabled: true });
    } else if (command.action === "remove" || command.action === "move") {
      if (!sources.length && command.action === "move") throw new MasterDataPlanError("The source recipe no longer exists. Refresh and review the action.");
      if (command.action === "move") {
        const dest = recipeEntities[command.destination!]!;
        if (after[dest].some((row) => row.enabled && sources.some((source) =>
          masterNameKey(row.name) === masterNameKey(source.name) && masterNameKey(row.brand) === masterNameKey(source.brand)))) {
          throw new MasterDataPlanError("The destination already has this recipe. Review a merge instead; no recipe was overwritten.");
        }
        // Mix components are per-pizza; other pools are batch weights. Never
        // invent a batch yield or silently reinterpret the source unit.
        if ((category === "mix") !== (command.destination === "mix") && sources.some((source) => source.components?.length)) {
          throw new MasterDataPlanError("This move changes recipe units. Review and save the recipe in its destination category explicitly.");
        }
        if (command.destination === "mix" && sources.some((source) => source.flavors?.length > 1)) {
          throw new MasterDataPlanError("The destination has one flavor assignment but this recipe has several. Review its destination assignments explicitly.");
        }
        sources.forEach((source, index) => after[dest].push({ id: stableId(`${command.destination}-${index}`),
          name: source.name, components: source.components, enabled: true, brand: source.brand ?? "", notes: source.notes ?? "",
          ...(command.destination === "mix" ? { flavor: source.flavor ?? source.flavors?.[0] ?? "" } : { flavors: source.flavors ?? (source.flavor ? [source.flavor] : []) }) }));
        const destList = directoryKeys[command.destination!];
        if (destList) list(destList, (items) => [...items, sources[0]!.name]);
      }
      for (const row of sources) row.enabled = false;
    } else if (command.action === "rename") {
      if (!sources.length) throw new MasterDataPlanError("The source recipe no longer exists. Refresh before renaming it.");
      if (after[recipeEntity].some((row) => row.enabled && !sources.includes(row) && masterNameKey(row.name) === masterNameKey(target))) {
        throw new MasterDataPlanError("That recipe name already exists. Choose an explicit merge instead; no row was replaced.");
      }
      for (const source of sources) source.name = target;
    } else {
      const brands = new Set(sources.map((row) => masterNameKey(row.brand)));
      if (!sources.length && !after[recipeEntity].some((row) => row.enabled && masterNameKey(row.name) === masterNameKey(target))) {
        throw new MasterDataPlanError("Neither a source recipe nor a canonical merge target exists. Review the recipe before changing references.");
      }
      for (const brand of brands) {
        const group = sources.filter((row) => masterNameKey(row.brand) === brand);
        const targets = after[recipeEntity].filter((row) => row.enabled && masterNameKey(row.brand) === brand && masterNameKey(row.name) === masterNameKey(target));
        if (targets.length > 1) throw new MasterDataPlanError("The target recipe identity is ambiguous within its brand. Review it before merging.");
        const survivor = targets[0] ?? group[0]!;
        survivor.name = target;
        if (!survivor.components?.length) survivor.components = group.find((row) => row.components?.length)?.components ?? [];
        for (const row of group) if (row.id !== survivor.id) row.enabled = false;
      }
    }
  }
  if (category === "die") {
    const sources = after.dies.filter((row) => matches(row.name));
    if (command.action === "add") {
      if (!after.dies.some((row) => masterNameKey(row.name) === masterNameKey(target))) after.dies.push({ id: masterNameKey(target), name: target });
    } else {
      after.dies = after.dies.filter((row) => !sources.includes(row));
      if (target && !after.dies.some((row) => masterNameKey(row.name) === masterNameKey(target))) after.dies.push({ id: masterNameKey(target), name: target });
    }
  }
  const flavorScoped = (brand: unknown) => category !== "flavor" || masterNameKey(brand) === masterNameKey(command.brand);
  const sourceIngredientIds = new Set(before.ingredients.filter((row) => matches(row.name) && row.enabled && !row.mergedInto).map((row) => row.id));
  const rewriteRows = (rows: unknown): unknown => !Array.isArray(rows) || !ingCategory ? rows : rows.map((row) => {
    if (!row || typeof row !== "object") return row;
    const linked = typeof row.ingredientId === "string" && row.ingredientId.length > 0;
    if (linked && matches(row.ingredient) && !sourceIngredientIds.has(row.ingredientId)) {
      throw new MasterDataPlanError("An ingredient label and its catalog identity disagree. Review that recipe row before changing shared references.");
    }
    if (linked ? !sourceIngredientIds.has(row.ingredientId) : !matches(row.ingredient)) return row;
    return { ...row, ingredient: target, ...(targetIngredientId ? { ingredientId: targetIngredientId } : {}) };
  });
  const rewriteValues = (input: Row): Row => {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new MasterDataPlanError("A setup reference is malformed and needs manager review.");
    if (command.action === "add") return input;
    const value = { ...input };
    for (const field of recipeFields[category] ?? []) {
      if (category === "cheese" || category === "mix") {
        const type = masterNameKey(value[field.replace("CheeseRecipeName", "Type")]);
        if (!["cheese", "mix"].includes(type) && matches(value[field])) throw new MasterDataPlanError("This recipe reference has no unambiguous Cheese/Mix station type. Review the setup before changing it.");
        if ((category === "cheese" && type !== "cheese") || (category === "mix" && type !== "mix")) continue;
      }
      if (matches(value[field])) value[field] = target;
    }
    for (const field of recipeRowFields) {
      if (ingCategory && command.action !== "remove") value[field] = rewriteRows(value[field]);
    }
    return value;
  };
  const rewriteMeta = (input: Row): Row => {
    if (command.action === "add") return input;
    if (category === "brand" && matches(input.brand)) return { ...input, brand: target, ...(!target ? { flavor: "" } : {}) };
    if (category === "flavor" && flavorScoped(input.brand) && matches(input.flavor)) return { ...input, flavor: target };
    return input;
  };
  for (const entity of ["doughRecipes", "sauceRecipes", "cheeseRecipes", "mixes"] as const) {
    for (const row of after[entity]) {
      if (command.action !== "add") {
        if (category === "brand" && matches(row.brand)) row.brand = target;
        if (category === "flavor" && flavorScoped(row.brand)) {
          if (matches(row.flavor)) row.flavor = target;
          if (Array.isArray(row.flavors)) row.flavors = [...new Set(row.flavors.map(replace).filter(Boolean))];
        }
        if (ingCategory && command.action !== "remove") row.components = rewriteRows(row.components);
      }
    }
  }
  if (command.action !== "add") {
    const profiles: Row[] = [];
    for (const row of after.profiles) {
      if (command.action === "remove" && ((category === "brand" && matches(row.brand))
        || (category === "flavor" && flavorScoped(row.brand) && matches(row.flavor)))) continue;
      const next = rewriteMeta({ ...row, values: rewriteValues(row.values ?? {}), crustValues: rewriteValues(row.crustValues ?? {}) });
      if (next.brand !== row.brand || next.flavor !== row.flavor) next.key = `${masterNameKey(next.brand)}__${masterNameKey(next.flavor)}`;
      const existing = profiles.find((item) => item.key === next.key);
      if (existing) {
        // Preserve the explicit destination's values when folding two profiles.
        const targetOwned = masterNameKey(category === "brand" ? row.brand : row.flavor) === masterNameKey(target);
        existing.values = targetOwned ? { ...existing.values, ...next.values } : { ...next.values, ...existing.values };
        existing.crustValues = targetOwned ? { ...existing.crustValues, ...next.crustValues } : { ...next.crustValues, ...existing.crustValues };
      } else profiles.push(next);
    }
    after.profiles = profiles;
    after.templates = after.templates.map((row) => row.deleted ? row : rewriteMeta({ ...row, values: rewriteValues(row.values ?? {}) }));
    if (ingCategory && target) {
      const candidates = after.ingredientWeights.filter((row) => matches(row.name));
      const winner = after.ingredientWeights.find((row) => masterNameKey(row.name) === masterNameKey(target)) ?? candidates[0];
      if (winner) {
        winner.name = target;
        after.ingredientWeights = after.ingredientWeights.filter((row) => !candidates.includes(row) || row === winner);
      }
    }
  }
  // Preserve explicit namespace tombstones. These contain names and server
  // stamps only; no arbitrary factory key is admitted to the ledger.
  const namespaces: Partial<Record<MasterDataCommand["category"], string>> = {
    brand: "brands", flavor: `flavors:${command.brand ?? ""}`, applicator: "ingredientTypes", pep: "pepTypes", die: "dieTypes",
    dough: "doughRecipeNames", sauce: "frontlineRecipeNames", cheese: "cheeseRecipeNames", mix: "mixRecipeNames",
    doughIngredient: "doughIngredients", sauceIngredient: "frontlineIngredients", cheeseIngredient: "cheeseIngredients", mixIngredient: "mixIngredients",
  };
  const namespace = namespaces[category];
  if (namespace) {
    const deleted = objectDirectory("run-calc-deleted-items");
    const deletionStamps = objectDirectory("run-calc-deleted-stamps");
    const undeletionStamps = objectDirectory("run-calc-undeleted-stamps");
    deletionStamps[namespace] ??= {};
    undeletionStamps[namespace] ??= {};
    const current = Array.isArray(deleted[namespace]) ? deleted[namespace] as string[] : [];
    const time = Math.max(Date.now(), ...Object.values(deletionStamps[namespace]).map(Number), ...Object.values(undeletionStamps[namespace]).map(Number)) + 1;
    if (!Number.isSafeInteger(time)) throw new MasterDataPlanError("Directory stamps need manager review before changing these names.");
    if (command.action !== "add") {
      deleted[namespace] = [...new Set([...current, ...command.sources.map(masterNameKey).filter((name) => name !== masterNameKey(target))])];
      for (const name of command.sources) if (masterNameKey(name) !== masterNameKey(target)) deletionStamps[namespace][masterNameKey(name)] = time;
    }
    if (target) {
      deleted[namespace] = (deleted[namespace] ?? current).filter((name: string) => masterNameKey(name) !== masterNameKey(target));
      undeletionStamps[namespace][masterNameKey(target)] = time;
    }
  }
  // Fold the browser-era preset representation too, while it still exists as
  // a canonical, allowlisted factory directory. It is never a browser snapshot.
  const presetKeys = ["run-calc-dough-recipe-presets", "run-calc-frontline-recipe-presets", "run-calc-cheese-recipe-presets"];
  const ownPresetKey = category === "dough" ? presetKeys[0] : category === "sauce" ? presetKeys[1] : ["cheese", "mix"].includes(category) ? presetKeys[2] : undefined;
  for (const key of presetKeys) {
    const row = after.directories.find((item) => item.key === key);
    if (!row) continue;
    const presets = objectDirectory(key);
    if (ingCategory && command.action !== "add" && command.action !== "remove") {
      for (const [name, value] of Object.entries(presets)) {
        presets[name] = Array.isArray(value) ? rewriteRows(value) : value && typeof value === "object"
          ? { ...value, rows: rewriteRows((value as Row).rows) } : value;
      }
    }
    if (key === ownPresetKey && command.action !== "add") {
      for (const name of Object.keys(presets)) {
        if (!matches(name) || name === target) continue;
        if (target && !presets[target]) presets[target] = presets[name];
        delete presets[name];
      }
    }
  }
  const aliasCategory = recipeEntity ? category === "mix" ? "mixes" : category : ["brand", "flavor"].includes(category) ? category : "ingredient";
  const aliasKind: Partial<Record<MasterDataCommand["category"], string>> = {
    brand: "brand", flavor: "flavor", applicator: "appType", pep: "pepType", die: "dieType",
    doughIngredient: "doughIngredient", sauceIngredient: "sauceIngredient", cheeseIngredient: "cheeseIngredient",
    dough: "recipeName", sauce: "recipeName",
  };
  const aliasContext = category === "flavor" ? command.brand : category === "dough" || category === "sauce" ? category : null;
  if (target && command.action !== "add" && command.action !== "move") {
    for (const row of after.mergeAliases) {
      if (row.category === aliasCategory && (category !== "flavor" || masterNameKey(row.brand) === masterNameKey(command.brand))
        && matches(row.canonicalName)) row.canonicalName = target;
    }
    for (const row of after.specAliases) {
      if (row.kind === aliasKind[category] && masterNameKey(row.context) === masterNameKey(aliasContext)
        && matches(row.canonicalName)) row.canonicalName = target;
      if (category === "brand" && row.kind === "flavor" && matches(row.context)) row.context = target;
    }
    for (const source of command.sources) {
      if (masterNameKey(source) === masterNameKey(target)) continue;
      const prior = after.mergeAliases.find((row) => row.category === aliasCategory && masterNameKey(row.externalName) === masterNameKey(source)
        && masterNameKey(row.brand) === masterNameKey(category === "flavor" ? command.brand : null));
      if (prior) prior.canonicalName = target;
      else after.mergeAliases.push({ category: aliasCategory, brand: category === "flavor" ? command.brand : null, externalName: source, canonicalName: target });
      if (aliasKind[category]) {
        const alias = after.specAliases.find((row) => row.kind === aliasKind[category] && masterNameKey(row.externalName) === masterNameKey(source)
          && masterNameKey(row.context) === masterNameKey(aliasContext));
        if (alias) alias.canonicalName = target;
        else after.specAliases.push({ kind: aliasKind[category], externalName: source, canonicalName: target, context: aliasContext });
      }
    }
  }
  if (command.action === "add") after.mergedAway = after.mergedAway.filter((row) => !matches(row.name));
  else if (ingCategory || category === "die") {
    for (const source of command.sources) if (masterNameKey(source) !== masterNameKey(target)
      && !(ingCategory && command.action === "remove" && after.ingredients.some((row) => row.enabled && !row.mergedInto && masterNameKey(row.name) === masterNameKey(source)))
      && !after.mergedAway.some((row) => masterNameKey(row.name) === masterNameKey(source))) after.mergedAway.push({ name: masterNameKey(source) });
  }
  return {
    after, rewriteValues, rewriteMeta,
    description: `${command.action} ${category}: ${command.sources.join(", ")}${command.target ? ` → ${command.target}` : ""}${command.destination ? ` → ${command.destination}` : ""}`,
  };
}

export function planPendingReferences(
  days: Array<{ date: string; data: unknown }>,
  plan: ReturnType<typeof buildMasterDataPlan>,
): { references: MasterDataReferenceFact[]; protectedDependency: boolean } {
  const references: MasterDataReferenceFact[] = [];
  let protectedDependency = false;
  for (const day of days) {
    const payload = day.data as Row;
    const state = (payload?.dayState ?? {}) as Row;
    if (!Array.isArray(state.runs)) continue;
    for (const run of state.runs) {
      const values = payload.runValues?.[run.id] ?? {};
      for (const [section, before, after] of [
        ["meta", run, plan.rewriteMeta(run)],
        ["values", values, plan.rewriteValues(values)],
      ] as const) {
        for (const field of Object.keys(after)) {
          if (canonicalMasterJson(before[field]) === canonicalMasterJson(after[field])) continue;
          if (run.startedAt || run.endedAt) { protectedDependency = true; continue; }
          references.push({ date: day.date, runId: run.id, section, field,
            beforeExists: Object.hasOwn(before, field), afterExists: Object.hasOwn(after, field),
            before: before[field] ?? null, after: after[field] ?? null });
        }
      }
    }
  }
  return { references, protectedDependency };
}
