import { useEffect, useMemo, useState } from "react";
import { X, FileSpreadsheet, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import {
  recipeApplyIssue,
  profileApplyIssue,
  recipeApplyTargets,
  type ParsedProfile,
  type ParsedRecipe,
  type ParsedRecipeTarget,
  type ParsedSpecImport,
} from "@workspace/spec-import";
import type { SpecImportPrepared } from "@/specImport";
import { buildDiscrepancies } from "@/specImport";
import { profileExistsForImport, recipeExistsForImport } from "@/storage";
import ReviewBadge from "./ReviewBadge";

type Props = {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  /** Multi-file parse progress; null for a single file. */
  progress?: { done: number; total: number } | null;
  error: string | null;
  prepared: SpecImportPrepared | null;
  applying: boolean;
  /** Confirm with the edited, kept-only import the user chose to apply. */
  onConfirm: (parsed: ParsedSpecImport) => void;
};

// One editable profile row in the review. `orig` keeps every field the parser
// found (applicators, pepperonis, die, sauce oz); only brand/flavor + include are
// editable here. `tombstoned` = the user had merged/deleted this away, so it's
// excluded by default and shown as re-includable.
type ProfileItem = {
  key: string;
  orig: ParsedProfile;
  brand: string;
  flavor: string;
  include: boolean;
  tombstoned: boolean;
};

// One editable recipe row. `orig` keeps rows/targets/doughballOz/app; name + kind
// + include are editable (fixes "no name" and "cheese read as sauce").
// `brand`/`flavor` let the user attach a recipe that the AI left tied to no
// product (fixes the silent "recipe imported but shows up on nothing" miss).
type RecipeItem = {
  key: string;
  orig: ParsedRecipe;
  name: string;
  kind: ParsedRecipe["kind"];
  brand: string;
  flavor: string;
  include: boolean;
  tombstoned: boolean;
};

const KINDS: ParsedRecipe["kind"][] = ["dough", "sauce", "cheese"];

function buildProfileItems(prepared: SpecImportPrepared): ProfileItem[] {
  const kept = prepared.parsed.profiles.map((p, i) => ({
    key: `pk${i}`,
    orig: p,
    brand: p.brand ?? "",
    flavor: p.flavor ?? "",
    include: true,
    tombstoned: false,
  }));
  const skipped = prepared.skipped.profiles.map((p, i) => ({
    key: `ps${i}`,
    orig: p,
    brand: p.brand ?? "",
    flavor: p.flavor ?? "",
    include: false,
    tombstoned: true,
  }));
  return [...kept, ...skipped];
}

function buildRecipeItems(prepared: SpecImportPrepared): RecipeItem[] {
  const kept = prepared.parsed.recipes.map((r, i) => ({
    key: `rk${i}`,
    orig: r,
    name: r.name ?? "",
    kind: r.kind,
    brand: r.brand ?? "",
    flavor: r.flavor ?? "",
    include: true,
    tombstoned: false,
  }));
  const skipped = prepared.skipped.recipes.map((r, i) => ({
    key: `rs${i}`,
    orig: r,
    name: r.name ?? "",
    kind: r.kind,
    brand: r.brand ?? "",
    flavor: r.flavor ?? "",
    include: false,
    tombstoned: true,
  }));
  return [...kept, ...skipped];
}

// Compact one-line summary of the numbers the parser read for a profile, so the
// user can spot a misparse (wrong die/oz) at a glance and uncheck or re-upload.
function profileSummary(p: ParsedProfile): string {
  const parts: string[] = [];
  if (p.dieType) parts.push(`Die ${p.dieType}`);
  if (p.sauceOzPerPizza != null) {
    // Include the named bought/ready-made sauce (e.g. "BBQ Sauce") so the user
    // can see at a glance that the sheet's sauce name was read — otherwise a
    // successfully imported sauce name is invisible on this screen.
    parts.push(
      p.sauceName
        ? `Sauce ${p.sauceOzPerPizza} oz (${p.sauceName})`
        : `Sauce ${p.sauceOzPerPizza} oz`,
    );
  } else if (p.sauceName) {
    parts.push(`Sauce: ${p.sauceName}`);
  }
  for (const a of p.applicators ?? []) {
    if (a.type) parts.push(`${a.type} ${a.ozPerPizza} oz`);
  }
  for (const pp of p.pepperonis ?? []) {
    if (pp.type) parts.push(`${pp.type} ${pp.sticks} stk · ${pp.ozPerPizza} oz`);
  }
  return parts.join(" · ");
}

// Preview of the ingredient rows a recipe parsed to (first few + overflow count).
function recipeRowsPreview(r: ParsedRecipe): string {
  const rows = r.rows ?? [];
  const shown = rows.slice(0, 4).map((row) => `${row.ingredient} ${row.lbs} lb`);
  const extra = rows.length - shown.length;
  return shown.join(" · ") + (extra > 0 ? ` · +${extra} more` : "");
}

// Editable review/summary screen for the Excel spec-sheet importer. The manager
// can include/exclude each parsed profile & recipe, fix a recipe's name (unnamed
// recipes are flagged, not silently dropped), fix its type (dough/sauce/cheese),
// and correct a profile's brand/flavor match. Items the user previously merged or
// deleted away are shown separately (excluded by default) so a re-import never
// silently resurrects them. Only the included, corrected items are applied.
export default function SpecImportDialog({
  open,
  onClose,
  loading,
  progress,
  error,
  prepared,
  applying,
  onConfirm,
}: Props) {
  const [profiles, setProfiles] = useState<ProfileItem[]>([]);
  const [recipes, setRecipes] = useState<RecipeItem[]>([]);

  useEffect(() => {
    if (prepared) {
      setProfiles(buildProfileItems(prepared));
      setRecipes(buildRecipeItems(prepared));
    } else {
      setProfiles([]);
      setRecipes([]);
    }
  }, [prepared]);

  const brands = prepared?.brands ?? [];
  const flavorsByBrand = prepared?.flavorsByBrand ?? {};

  const setProfile = (key: string, patch: Partial<ProfileItem>) =>
    setProfiles((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  const setRecipe = (key: string, patch: Partial<RecipeItem>) =>
    setRecipes((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  // The edited, include-only import that would be applied. Recomputed live so the
  // change list and counts always reflect the user's edits.
  const edited: ParsedSpecImport = useMemo(() => {
    const outProfiles = profiles
      .filter((p) => p.include)
      .map((p): ParsedProfile => ({ ...p.orig, brand: p.brand.trim(), flavor: p.flavor.trim() }));
    const outRecipes = recipes
      .filter((r) => r.include)
      .map((r): ParsedRecipe => {
        const out: ParsedRecipe = { ...r.orig, name: r.name.trim(), kind: r.kind };
        const b = r.brand.trim();
        const f = r.flavor.trim();
        if (b) out.brand = b;
        else delete out.brand;
        if (f) out.flavor = f;
        else delete out.flavor;
        return out;
      });
    const out: ParsedSpecImport = { profiles: outProfiles, recipes: outRecipes };
    if (prepared?.parsed.note) out.note = prepared.parsed.note;
    return out;
  }, [profiles, recipes, prepared]);

  const discrepancies = useMemo(
    () => (prepared ? buildDiscrepancies(edited) : []),
    [edited, prepared],
  );

  if (!open) return null;

  const includedProfiles = profiles.filter((p) => p.include).length;
  const includedRecipes = recipes.filter((r) => r.include).length;
  const includedCount = includedProfiles + includedRecipes;
  const nothingParsed = prepared != null && profiles.length === 0 && recipes.length === 0;

  // Live "would be dropped" attention count across included items.
  const attentionCount =
    edited.profiles.filter((p) => profileApplyIssue(p)).length +
    edited.recipes.filter((r) => recipeApplyIssue(r)).length;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[90vh] flex flex-col rounded-xl border border-border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border p-4">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            <h2 className="text-base font-semibold text-foreground">Import Spec Sheet</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                {progress && progress.total > 1
                  ? `Reading file ${Math.min(progress.done + 1, progress.total)} of ${progress.total} and interpreting spec sheets & recipes…`
                  : "Reading the workbook and interpreting spec sheets & recipes…"}
              </p>
            </div>
          )}

          {!loading && error && (
            <div className="rounded-md border border-destructive/60 bg-destructive/10 p-3">
              <div className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-4 w-4" />
                <span className="text-sm font-medium">Could not import</span>
              </div>
              <p className="mt-1 text-sm text-destructive/90">{error}</p>
            </div>
          )}

          {!loading && !error && prepared && (
            <>
              <p className="text-sm text-muted-foreground">
                Review each item. Uncheck anything you don't want, fix a recipe's{" "}
                <span className="font-medium text-foreground">name</span> or{" "}
                <span className="font-medium text-foreground">type</span>, or correct a
                product's brand/flavor. Only checked items are applied — existing ones are
                overwritten, new ones are added.
              </p>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-border p-3">
                  <div className="text-2xl font-bold text-foreground">{includedProfiles}</div>
                  <div className="text-xs font-medium text-muted-foreground">
                    of {profiles.length} spec profiles
                  </div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="text-2xl font-bold text-foreground">{includedRecipes}</div>
                  <div className="text-xs font-medium text-muted-foreground">
                    of {recipes.length} recipes
                  </div>
                </div>
              </div>

              {attentionCount > 0 && (
                <div className="rounded-md border border-amber-400/60 bg-amber-500/10 p-2 text-xs text-amber-700">
                  {attentionCount} checked item{attentionCount === 1 ? "" : "s"} still{" "}
                  need attention — a recipe needs a name, or a profile is missing its
                  brand/flavor. These won't be saved until fixed or unchecked.
                </div>
              )}

              {/* Shared brand suggestions for the profile match pickers. */}
              <datalist id="spec-import-brands">
                {brands.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>

              {profiles.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Spec profiles
                  </p>
                  <ul className="space-y-2">
                    {profiles.map((p) => (
                      <ProfileRow
                        key={p.key}
                        item={p}
                        brands={brands}
                        flavorsByBrand={flavorsByBrand}
                        onToggle={() => setProfile(p.key, { include: !p.include })}
                        onBrand={(brand) => setProfile(p.key, { brand })}
                        onFlavor={(flavor) => setProfile(p.key, { flavor })}
                      />
                    ))}
                  </ul>
                </div>
              )}

              {recipes.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Recipes
                  </p>
                  <ul className="space-y-2">
                    {recipes.map((r) => (
                      <RecipeRow
                        key={r.key}
                        item={r}
                        editedProfiles={edited.profiles}
                        brands={brands}
                        flavorsByBrand={flavorsByBrand}
                        onToggle={() => setRecipe(r.key, { include: !r.include })}
                        onName={(name) => setRecipe(r.key, { name })}
                        onKind={(kind) => setRecipe(r.key, { kind })}
                        onBrand={(brand) => setRecipe(r.key, { brand })}
                        onFlavor={(flavor) => setRecipe(r.key, { flavor })}
                      />
                    ))}
                  </ul>
                </div>
              )}

              {prepared.newAliases.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {prepared.newAliases.length} new name mapping
                  {prepared.newAliases.length === 1 ? "" : "s"} will be remembered for
                  future imports.
                </p>
              )}

              {prepared.flagged.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-muted-foreground">
                    A second AI check flagged {prepared.flagged.length} item
                    {prepared.flagged.length === 1 ? "" : "s"} to double-check before applying:
                  </p>
                  {prepared.flagged.map((f, i) => (
                    <div key={i} className="space-y-0.5">
                      <p className="text-xs font-medium text-foreground">{f.label}</p>
                      <ReviewBadge review={f.review} />
                    </div>
                  ))}
                </div>
              )}

              {discrepancies.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-muted-foreground">
                    Applying these will change {discrepancies.length} thing
                    {discrepancies.length === 1 ? "" : "s"} in your current recipes:
                  </p>
                  <ul className="space-y-0.5">
                    {discrepancies.slice(0, 12).map((d, i) => (
                      <li key={i} className="text-xs text-foreground">
                        {d.message}
                      </li>
                    ))}
                  </ul>
                  {discrepancies.length > 12 && (
                    <p className="text-xs text-muted-foreground">
                      +{discrepancies.length - 12} more
                    </p>
                  )}
                </div>
              )}

              {prepared.note && (
                <div className="rounded-md border border-amber-400/60 bg-amber-500/10 p-3">
                  <div className="flex items-center gap-2 text-amber-600">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-sm font-medium">Note from the parser</span>
                  </div>
                  <p className="mt-1 text-sm text-amber-700">{prepared.note}</p>
                </div>
              )}

              {nothingParsed && (
                <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                  Nothing recognizable was found in this workbook. Try a different file.
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border p-4">
          <button
            type="button"
            onClick={onClose}
            disabled={applying}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(edited)}
            disabled={
              loading ||
              applying ||
              !!error ||
              !prepared ||
              nothingParsed ||
              includedCount === 0 ||
              attentionCount > 0
            }
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {applying ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            Apply {includedCount > 0 ? includedCount : ""} item
            {includedCount === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ tombstoned, isNew }: { tombstoned: boolean; isNew: boolean }) {
  if (tombstoned) {
    return (
      <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-600">
        Merged away
      </span>
    );
  }
  return (
    <span
      className={
        isNew
          ? "shrink-0 rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-green-600"
          : "shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-primary"
      }
    >
      {isNew ? "new" : "update"}
    </span>
  );
}

function ProfileRow({
  item,
  brands,
  flavorsByBrand,
  onToggle,
  onBrand,
  onFlavor,
}: {
  item: ProfileItem;
  brands: string[];
  flavorsByBrand: Record<string, string[]>;
  onToggle: () => void;
  onBrand: (v: string) => void;
  onFlavor: (v: string) => void;
}) {
  const brand = item.brand.trim();
  const flavor = item.flavor.trim();
  const issue = profileApplyIssue({ ...item.orig, brand, flavor });
  const isNew = !brand || !flavor || !profileExistsForImport(brand, flavor);
  const flavorMatch = Object.keys(flavorsByBrand).find(
    (b) => b.trim().toLowerCase() === brand.toLowerCase(),
  );
  const flavorOpts = flavorMatch ? flavorsByBrand[flavorMatch] ?? [] : [];
  const flavorListId = `spec-flavors-${item.key}`;
  const summary = profileSummary(item.orig);

  return (
    <li
      className={`rounded-lg border p-3 ${item.include ? "border-border" : "border-border/60 opacity-70"}`}
      data-testid={`spec-profile-${item.key}`}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={item.include}
          onChange={onToggle}
          className="mt-1 h-4 w-4 accent-primary"
          aria-label={`Include ${item.orig.brand} ${item.orig.flavor}`}
          data-testid={`spec-profile-include-${item.key}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {item.orig.brand || "(no brand)"} — {item.orig.flavor || "(no flavor)"}
            </span>
            <StatusBadge tombstoned={item.tombstoned} isNew={isNew} />
          </div>

          <datalist id={flavorListId}>
            {flavorOpts.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              value={item.brand}
              onChange={(e) => onBrand(e.target.value)}
              list="spec-import-brands"
              placeholder="Brand"
              aria-label={`Brand for ${item.orig.brand} ${item.orig.flavor}`}
              data-testid={`spec-profile-brand-${item.key}`}
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
            />
            <input
              value={item.flavor}
              onChange={(e) => onFlavor(e.target.value)}
              list={flavorListId}
              placeholder="Flavor"
              aria-label={`Flavor for ${item.orig.brand} ${item.orig.flavor}`}
              data-testid={`spec-profile-flavor-${item.key}`}
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
            />
          </div>

          {summary && (
            <div className="mt-1.5 text-xs text-muted-foreground">
              Read: {summary}
            </div>
          )}

          {item.include && issue && (
            <div className="mt-1 text-xs text-amber-600">
              {issue === "missing-brand"
                ? "Needs a brand — add one or it won't be saved."
                : "Needs a flavor — add one or it won't be saved."}
            </div>
          )}
          {item.tombstoned && (
            <div className="mt-1 text-xs text-amber-600">
              You merged/removed this before — check the box only if you want it back.
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function formatTargets(targets: ParsedRecipeTarget[]): string {
  const shown = targets.slice(0, 3).map((t) => `${t.brand} — ${t.flavor}`);
  const extra = targets.length - shown.length;
  return shown.join(", ") + (extra > 0 ? `, +${extra} more` : "");
}

function RecipeRow({
  item,
  editedProfiles,
  brands,
  flavorsByBrand,
  onToggle,
  onName,
  onKind,
  onBrand,
  onFlavor,
}: {
  item: RecipeItem;
  editedProfiles: ParsedProfile[];
  brands: string[];
  flavorsByBrand: Record<string, string[]>;
  onToggle: () => void;
  onName: (v: string) => void;
  onKind: (v: ParsedRecipe["kind"]) => void;
  onBrand: (v: string) => void;
  onFlavor: (v: string) => void;
}) {
  const name = item.name.trim();
  const brand = item.brand.trim();
  const flavor = item.flavor.trim();
  const candidate: ParsedRecipe = {
    ...item.orig,
    name,
    kind: item.kind,
    ...(brand ? { brand } : {}),
    ...(flavor ? { flavor } : {}),
  };
  const issue = recipeApplyIssue(candidate);
  const isNew = !name || !recipeExistsForImport(item.kind, name);
  const rowsPreview = recipeRowsPreview(item.orig);
  // Which products this recipe will actually attach to when applied. If empty,
  // the recipe name lands in the library but shows up on NO run — the silent
  // "it didn't import" miss the user reported.
  const targets = recipeApplyTargets(candidate, editedProfiles);
  const attachesToNothing = item.include && !issue && targets.length === 0;
  const flavorMatch = Object.keys(flavorsByBrand).find(
    (b) => b.trim().toLowerCase() === brand.toLowerCase(),
  );
  const flavorOpts = flavorMatch ? flavorsByBrand[flavorMatch] ?? [] : [];
  const flavorListId = `spec-recipe-flavors-${item.key}`;

  return (
    <li
      className={`rounded-lg border p-3 ${item.include ? "border-border" : "border-border/60 opacity-70"}`}
      data-testid={`spec-recipe-${item.key}`}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={item.include}
          onChange={onToggle}
          className="mt-1 h-4 w-4 accent-primary"
          aria-label={`Include recipe ${item.orig.name || "(unnamed)"}`}
          data-testid={`spec-recipe-include-${item.key}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {item.orig.name || "(unnamed recipe)"}
            </span>
            <StatusBadge tombstoned={item.tombstoned} isNew={isNew} />
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              value={item.name}
              onChange={(e) => onName(e.target.value)}
              placeholder="Recipe name"
              aria-label={`Name for recipe ${item.orig.name || "(unnamed)"}`}
              data-testid={`spec-recipe-name-${item.key}`}
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
            />
            <select
              value={item.kind}
              onChange={(e) => onKind(e.target.value as ParsedRecipe["kind"])}
              aria-label={`Type for recipe ${item.orig.name || "(unnamed)"}`}
              data-testid={`spec-recipe-kind-${item.key}`}
              className="shrink-0 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground capitalize"
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>

          {rowsPreview && (
            <div className="mt-1.5 text-xs text-muted-foreground">
              Read: {rowsPreview}
            </div>
          )}

          {item.include && !issue && targets.length > 0 && (
            <div className="mt-1 text-xs text-muted-foreground">
              Attaches to: {formatTargets(targets)}
            </div>
          )}

          {item.include && issue === "missing-name" && (
            <div className="mt-1 text-xs text-amber-600">
              Needs a name — this recipe won't be saved until you name it.
            </div>
          )}
          {item.include && issue === "no-rows" && (
            <div className="mt-1 text-xs text-amber-600">
              No ingredients were read — it won't be saved.
            </div>
          )}

          {attachesToNothing && (
            <div className="mt-2 rounded-md border border-amber-400/60 bg-amber-500/10 p-2">
              <div className="text-xs font-medium text-amber-700">
                Won't show on any product yet — set the brand & flavor it belongs to.
              </div>
              <datalist id={flavorListId}>
                {flavorOpts.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <input
                  value={item.brand}
                  onChange={(e) => onBrand(e.target.value)}
                  list="spec-import-brands"
                  placeholder="Brand"
                  aria-label={`Attach recipe ${item.orig.name || "(unnamed)"} to brand`}
                  data-testid={`spec-recipe-brand-${item.key}`}
                  className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                />
                <input
                  value={item.flavor}
                  onChange={(e) => onFlavor(e.target.value)}
                  list={flavorListId}
                  placeholder="Flavor"
                  aria-label={`Attach recipe ${item.orig.name || "(unnamed)"} to flavor`}
                  data-testid={`spec-recipe-flavor-${item.key}`}
                  className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                />
              </div>
              <p className="mt-1 text-[11px] text-amber-700/80">
                Enter both, or set just a brand to attach to every matching product in
                this import. The recipe is still saved to your library either way.
              </p>
            </div>
          )}

          {item.tombstoned && (
            <div className="mt-1 text-xs text-amber-600">
              You merged/removed this before — check the box only if you want it back.
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
