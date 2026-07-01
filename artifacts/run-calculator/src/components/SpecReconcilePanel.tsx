// Saved spec sheets cross-reference panel (web).
//
// "Cross-reference all" runs the pure deterministic diff locally (no AI, instant)
// against every saved spec sheet at once and renders a recipe-centric linked view:
// which recipes match the spec, which have ingredient discrepancies, which are not
// covered by any spec sheet, and which spec recipes aren't in the library.
//
// Individual "AI summary" per sheet still calls /api/ai/spec-reconcile for a
// plain-language narrative on top of the deterministic diff.
//
// Mirrors the mobile section in artifacts/run-calculator-mobile/app/master-data.tsx
// (replit.md parity).

import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, MinusCircle, XCircle, ChevronDown, ChevronRight } from "lucide-react";
import {
  reconcileSpecWithRecipes,
  toReconcileRecipes,
  reconcileSpecProfiles,
  toReconcileProfiles,
  type Discrepancy,
  type ProfileDiscrepancy,
  type ReconcileKind,
  type ReconcileRecipe,
} from "@workspace/spec-reconcile";
import {
  fetchSavedSpecSheets,
  reconcileSpecSheet,
  deleteSpecSheet,
  loadCurrentReconcileRecipes,
  loadCurrentReconcileProfiles,
  currentReconcileProfile,
  type SavedSpecSheet,
  type SpecReconcileResult,
} from "@/savedSpecSheets";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";

function fmtDate(ms: number): string {
  try {
    return new Date(ms).toLocaleString(undefined, {
      month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit",
    });
  } catch {
    return "";
  }
}

type SheetCoverage = {
  sheetId: number;
  sheetLabel: string;
  discrepancies: Discrepancy[];
};

type RecipeEntry = {
  kind: ReconcileKind;
  name: string;
  inLibrary: boolean;
  coverage: SheetCoverage[];
};

function buildCombinedView(sheets: SavedSpecSheet[], currentRecipes: ReconcileRecipe[]): RecipeEntry[] {
  const recipeMap = new Map<string, RecipeEntry>();

  for (const r of currentRecipes) {
    const key = `${r.kind}\0${r.name.trim().toLowerCase()}`;
    if (!recipeMap.has(key)) {
      recipeMap.set(key, { kind: r.kind, name: r.name, inLibrary: true, coverage: [] });
    }
  }

  for (const sheet of sheets) {
    const specRecipes = toReconcileRecipes(sheet.data?.recipes);
    const discrepancies = reconcileSpecWithRecipes({ specRecipes, currentRecipes });

    const ingredientDiscsByKey = new Map<string, Discrepancy[]>();
    for (const d of discrepancies) {
      if (d.type === "missing-recipe") continue;
      const key = `${d.kind}\0${d.recipeName.trim().toLowerCase()}`;
      const arr = ingredientDiscsByKey.get(key) ?? [];
      arr.push(d);
      ingredientDiscsByKey.set(key, arr);
    }

    for (const sr of specRecipes) {
      const key = `${sr.kind}\0${sr.name.trim().toLowerCase()}`;
      const existing = recipeMap.get(key);
      const discs = ingredientDiscsByKey.get(key) ?? [];
      if (existing) {
        existing.coverage.push({ sheetId: sheet.id, sheetLabel: sheet.label, discrepancies: discs });
      } else {
        recipeMap.set(key, {
          kind: sr.kind, name: sr.name, inLibrary: false,
          coverage: [{ sheetId: sheet.id, sheetLabel: sheet.label, discrepancies: [] }],
        });
      }
    }
  }

  return Array.from(recipeMap.values());
}

type ProfileCoverage = {
  sheetId: number;
  sheetLabel: string;
  discrepancies: ProfileDiscrepancy[];
};

type ProfileEntry = {
  brand: string;
  flavor: string;
  inLibrary: boolean;
  coverage: ProfileCoverage[];
};

// Cross-reference every saved sheet's PROFILE specs (die/sauce/applicators/
// pepperonis) against the current profile library, grouped per brand+flavor. A
// spec profile the library lacks is "spec-only"; a matched profile with field
// differences shows them. Sheets with no profiles simply contribute nothing.
function buildProfileView(sheets: SavedSpecSheet[]): ProfileEntry[] {
  const map = new Map<string, ProfileEntry>();

  for (const sheet of sheets) {
    const specProfiles = toReconcileProfiles(sheet.data?.profiles);
    if (specProfiles.length === 0) continue;
    const currentProfiles = loadCurrentReconcileProfiles(specProfiles);
    const discrepancies = reconcileSpecProfiles({ specProfiles, currentProfiles });

    const discsByKey = new Map<string, ProfileDiscrepancy[]>();
    for (const d of discrepancies) {
      if (d.type === "missing-profile") continue;
      const key = `${d.brand.trim().toLowerCase()}\0${d.flavor.trim().toLowerCase()}`;
      const arr = discsByKey.get(key) ?? [];
      arr.push(d);
      discsByKey.set(key, arr);
    }

    for (const sp of specProfiles) {
      const key = `${sp.brand.trim().toLowerCase()}\0${sp.flavor.trim().toLowerCase()}`;
      const inLibrary = currentReconcileProfile(sp.brand, sp.flavor) != null;
      let entry = map.get(key);
      if (!entry) {
        entry = { brand: sp.brand, flavor: sp.flavor, inLibrary, coverage: [] };
        map.set(key, entry);
      }
      entry.coverage.push({
        sheetId: sheet.id,
        sheetLabel: sheet.label,
        discrepancies: discsByKey.get(key) ?? [],
      });
    }
  }

  return Array.from(map.values());
}

const KIND_ORDER: ReconcileKind[] = ["dough", "sauce", "cheese"];
const KIND_LABELS: Record<ReconcileKind, string> = { dough: "Dough", sauce: "Sauce", cheese: "Cheese" };

type Props = { autoCheckSignal?: number };

export default function SpecReconcilePanel({ autoCheckSignal = 0 }: Props) {
  const [sheets, setSheets] = useState<SavedSpecSheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [combined, setCombined] = useState<RecipeEntry[] | null>(null);
  const [profileView, setProfileView] = useState<ProfileEntry[] | null>(null);
  const [checkingAll, setCheckingAll] = useState(false);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  const [busyId, setBusyId] = useState<number | null>(null);
  const [aiResult, setAiResult] = useState<SpecReconcileResult | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);

  const prevSignalRef = useRef(-1);

  async function refresh() {
    setLoading(true);
    setListError(null);
    try {
      setSheets(await fetchSavedSpecSheets());
    } catch {
      setListError("Couldn't load saved spec sheets.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  // Auto-run cross-reference when triggered externally (e.g. after a spec sheet
  // or recipe import). Re-fetches the sheet list first so the newly saved sheet
  // is included, then immediately runs the deterministic diff.
  useEffect(() => {
    if (autoCheckSignal === 0) return;
    if (autoCheckSignal === prevSignalRef.current) return;
    prevSignalRef.current = autoCheckSignal;
    void (async () => {
      setLoading(true);
      setListError(null);
      setResultError(null);
      setAiResult(null);
      try {
        const latest = await fetchSavedSpecSheets();
        setSheets(latest);
        if (latest.length > 0) {
          const currentRecipes = loadCurrentReconcileRecipes();
          setCombined(buildCombinedView(latest, currentRecipes));
          setProfileView(buildProfileView(latest));
          setExpandedKeys(new Set());
        }
      } catch {
        setListError("Couldn't load saved spec sheets.");
      } finally {
        setLoading(false);
      }
    })();
  }, [autoCheckSignal]);

  function handleCheckAll() {
    setCheckingAll(true);
    setCombined(null);
    setProfileView(null);
    setAiResult(null);
    setResultError(null);
    setExpandedKeys(new Set());
    try {
      const currentRecipes = loadCurrentReconcileRecipes();
      setCombined(buildCombinedView(sheets, currentRecipes));
      setProfileView(buildProfileView(sheets));
    } catch {
      setResultError("Couldn't build cross-reference. Please try again.");
    } finally {
      setCheckingAll(false);
    }
  }

  async function handleAiCheck(sheet: SavedSpecSheet) {
    setBusyId(sheet.id);
    setAiResult(null);
    setCombined(null);
    setProfileView(null);
    setResultError(null);
    try {
      setAiResult(await reconcileSpecSheet(sheet));
    } catch {
      setResultError("Couldn't cross-reference that spec sheet. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: number) {
    setBusyId(id);
    try {
      const next = await deleteSpecSheet(id);
      setSheets(next);
      if (aiResult?.specSheetId === id) setAiResult(null);
      if (combined) setCombined(null);
      if (profileView) setProfileView(null);
    } catch {
      setResultError("Couldn't delete that spec sheet.");
    } finally {
      setBusyId(null);
    }
  }

  function toggleExpand(key: string) {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const summaryCounts = combined
    ? {
        total: combined.length,
        covered: combined.filter((r) => r.inLibrary && r.coverage.length > 0).length,
        issues: combined.filter((r) => r.coverage.some((c) => c.discrepancies.length > 0)).length,
        uncovered: combined.filter((r) => r.inLibrary && r.coverage.length === 0).length,
        specOnly: combined.filter((r) => !r.inLibrary).length,
      }
    : null;

  return (
    <Card data-testid="spec-reconcile-panel">
      <CardHeader>
        <CardTitle className="text-base flex items-center justify-between gap-2 flex-wrap">
          <span>Spec Sheet Cross-Reference</span>
          {!loading && sheets.length > 0 && (
            <Button
              size="sm"
              onClick={handleCheckAll}
              disabled={checkingAll || busyId !== null}
              data-testid="button-check-all-specs"
            >
              {checkingAll ? "Checking…" : "Cross-reference all"}
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Your two most recently imported spec sheets are saved here. Cross-reference
          all at once to see which recipes match the spec, or check a single sheet for
          an AI-written plain-language summary.
        </p>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : listError ? (
          <p className="text-sm text-destructive">{listError}</p>
        ) : sheets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No saved spec sheets yet. Import a spec sheet and it will appear here.
          </p>
        ) : (
          <div className="space-y-2">
            {sheets.map((s) => (
              <div
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3"
                data-testid={`spec-sheet-${s.id}`}
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{s.label}</div>
                  <div className="text-xs text-muted-foreground">
                    Imported {fmtDate(s.createdAt)}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleAiCheck(s)}
                    disabled={busyId !== null || checkingAll}
                    data-testid={`button-check-spec-${s.id}`}
                  >
                    {busyId === s.id ? "Checking…" : "AI summary"}
                  </Button>
                  <ConfirmDeleteButton
                    onConfirm={() => handleDelete(s.id)}
                    title="Delete this saved spec sheet?"
                    description="This removes the saved spec sheet. This can't be undone."
                  >
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId !== null || checkingAll}
                      data-testid={`button-delete-spec-${s.id}`}
                    >
                      Delete
                    </Button>
                  </ConfirmDeleteButton>
                </div>
              </div>
            ))}
          </div>
        )}

        {resultError && <p className="text-sm text-destructive">{resultError}</p>}

        {combined && summaryCounts && (
          <div className="space-y-4 mt-2" data-testid="spec-reconcile-result">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">
                {sheets.length} spec sheet{sheets.length !== 1 ? "s" : ""}
              </Badge>
              <Badge variant="secondary">
                {summaryCounts.covered} recipe{summaryCounts.covered !== 1 ? "s" : ""} matched
              </Badge>
              {summaryCounts.issues > 0 && (
                <Badge variant="destructive">
                  {summaryCounts.issues} with issue{summaryCounts.issues !== 1 ? "s" : ""}
                </Badge>
              )}
              {summaryCounts.uncovered > 0 && (
                <Badge variant="outline">
                  {summaryCounts.uncovered} not in any spec
                </Badge>
              )}
              {summaryCounts.specOnly > 0 && (
                <Badge variant="outline">
                  {summaryCounts.specOnly} spec-only
                </Badge>
              )}
              {profileView && profileView.some((p) => p.coverage.some((c) => c.discrepancies.length > 0)) && (
                <Badge variant="destructive">
                  {profileView.filter((p) => p.coverage.some((c) => c.discrepancies.length > 0)).length} profile
                  {profileView.filter((p) => p.coverage.some((c) => c.discrepancies.length > 0)).length !== 1 ? "s" : ""} with issues
                </Badge>
              )}
              {profileView && profileView.some((p) => !p.inLibrary) && (
                <Badge variant="outline">
                  {profileView.filter((p) => !p.inLibrary).length} profile
                  {profileView.filter((p) => !p.inLibrary).length !== 1 ? "s" : ""} not in library
                </Badge>
              )}
              {summaryCounts.issues === 0 &&
                summaryCounts.specOnly === 0 &&
                summaryCounts.uncovered === 0 &&
                (!profileView || profileView.every((p) => p.inLibrary && p.coverage.every((c) => c.discrepancies.length === 0))) && (
                  <Badge variant="secondary" className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                    Everything matches
                  </Badge>
                )}
            </div>

            {KIND_ORDER.map((kind) => {
              const recipes = combined.filter((r) => r.kind === kind);
              if (recipes.length === 0) return null;
              return (
                <div key={kind}>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    {KIND_LABELS[kind]}
                  </h4>
                  <div className="space-y-1">
                    {recipes.map((recipe) => {
                      const key = `${recipe.kind}\0${recipe.name}`;
                      const expanded = expandedKeys.has(key);
                      const allDiscs = recipe.coverage.flatMap((c) => c.discrepancies);
                      const status: "match" | "issues" | "uncovered" | "spec-only" =
                        !recipe.inLibrary
                          ? "spec-only"
                          : recipe.coverage.length === 0
                            ? "uncovered"
                            : allDiscs.length > 0
                              ? "issues"
                              : "match";
                      const canExpand = allDiscs.length > 0 || !recipe.inLibrary;

                      return (
                        <div key={key} className="rounded border border-border bg-card/50 overflow-hidden">
                          <button
                            type="button"
                            className={`w-full flex items-center gap-2 px-3 py-2 text-left ${canExpand ? "cursor-pointer hover:bg-muted/30 transition-colors" : "cursor-default"}`}
                            onClick={() => canExpand && toggleExpand(key)}
                          >
                            {status === "match" && (
                              <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
                            )}
                            {status === "issues" && (
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-500" />
                            )}
                            {status === "uncovered" && (
                              <MinusCircle className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                            )}
                            {status === "spec-only" && (
                              <XCircle className="w-3.5 h-3.5 shrink-0 text-blue-400" />
                            )}
                            <span className="flex-1 text-sm font-medium truncate">{recipe.name}</span>
                            {recipe.coverage.length > 0 && (
                              <span className="text-xs text-muted-foreground shrink-0">
                                {recipe.coverage.length} sheet{recipe.coverage.length !== 1 ? "s" : ""}
                              </span>
                            )}
                            {status === "uncovered" && (
                              <Badge variant="outline" className="text-[10px] py-0 px-1.5 shrink-0">
                                Not in any spec
                              </Badge>
                            )}
                            {status === "spec-only" && (
                              <Badge variant="outline" className="text-[10px] py-0 px-1.5 shrink-0">
                                Not in library
                              </Badge>
                            )}
                            {status === "issues" && (
                              <Badge variant="destructive" className="text-[10px] py-0 px-1.5 shrink-0">
                                {allDiscs.length} diff{allDiscs.length !== 1 ? "s" : ""}
                              </Badge>
                            )}
                            {canExpand && (
                              expanded
                                ? <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                                : <ChevronRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                            )}
                          </button>

                          {expanded && (
                            <div className="px-3 pb-3 border-t border-border pt-2 space-y-2">
                              {!recipe.inLibrary ? (
                                <p className="text-xs text-muted-foreground">
                                  This recipe appears on the spec sheet but isn't in your current recipe library.
                                </p>
                              ) : (
                                recipe.coverage
                                  .filter((c) => c.discrepancies.length > 0)
                                  .map((cov) => (
                                    <div key={cov.sheetId}>
                                      {sheets.length > 1 && (
                                        <p className="text-xs font-medium text-muted-foreground mb-1">
                                          {cov.sheetLabel}:
                                        </p>
                                      )}
                                      <ul className="space-y-0.5">
                                        {cov.discrepancies.map((d, i) => (
                                          <li key={i} className="text-xs text-muted-foreground">
                                            — {d.message}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  ))
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {profileView && profileView.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  Profiles
                </h4>
                <div className="space-y-1">
                  {profileView.map((p) => {
                    const key = `profile\0${p.brand}\0${p.flavor}`;
                    const expanded = expandedKeys.has(key);
                    const allDiscs = p.coverage.flatMap((c) => c.discrepancies);
                    const status: "match" | "issues" | "spec-only" = !p.inLibrary
                      ? "spec-only"
                      : allDiscs.length > 0
                        ? "issues"
                        : "match";
                    const canExpand = allDiscs.length > 0 || !p.inLibrary;

                    return (
                      <div key={key} className="rounded border border-border bg-card/50 overflow-hidden">
                        <button
                          type="button"
                          className={`w-full flex items-center gap-2 px-3 py-2 text-left ${canExpand ? "cursor-pointer hover:bg-muted/30 transition-colors" : "cursor-default"}`}
                          onClick={() => canExpand && toggleExpand(key)}
                        >
                          {status === "match" && (
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
                          )}
                          {status === "issues" && (
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-500" />
                          )}
                          {status === "spec-only" && (
                            <XCircle className="w-3.5 h-3.5 shrink-0 text-blue-400" />
                          )}
                          <span className="flex-1 text-sm font-medium truncate">
                            {p.brand} — {p.flavor}
                          </span>
                          {p.coverage.length > 0 && (
                            <span className="text-xs text-muted-foreground shrink-0">
                              {p.coverage.length} sheet{p.coverage.length !== 1 ? "s" : ""}
                            </span>
                          )}
                          {status === "spec-only" && (
                            <Badge variant="outline" className="text-[10px] py-0 px-1.5 shrink-0">
                              Not in library
                            </Badge>
                          )}
                          {status === "issues" && (
                            <Badge variant="destructive" className="text-[10px] py-0 px-1.5 shrink-0">
                              {allDiscs.length} diff{allDiscs.length !== 1 ? "s" : ""}
                            </Badge>
                          )}
                          {canExpand && (
                            expanded
                              ? <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                              : <ChevronRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                          )}
                        </button>

                        {expanded && (
                          <div className="px-3 pb-3 border-t border-border pt-2 space-y-2">
                            {!p.inLibrary ? (
                              <p className="text-xs text-muted-foreground">
                                This profile appears on the spec sheet but isn't set up in your current profiles.
                              </p>
                            ) : (
                              p.coverage
                                .filter((c) => c.discrepancies.length > 0)
                                .map((cov) => (
                                  <div key={cov.sheetId}>
                                    {sheets.length > 1 && (
                                      <p className="text-xs font-medium text-muted-foreground mb-1">
                                        {cov.sheetLabel}:
                                      </p>
                                    )}
                                    <ul className="space-y-0.5">
                                      {cov.discrepancies.map((d, i) => (
                                        <li key={i} className="text-xs text-muted-foreground">
                                          — {d.message}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                ))
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {aiResult && (
          <div
            className="space-y-3 rounded-md border border-border bg-muted/30 p-3"
            data-testid="spec-reconcile-result"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">AI summary</span>
              {aiResult.discrepancies.length === 0 ? (
                <Badge variant="secondary">Recipes match</Badge>
              ) : (
                <Badge variant="destructive">
                  {aiResult.discrepancies.length} recipe difference
                  {aiResult.discrepancies.length === 1 ? "" : "s"}
                </Badge>
              )}
            </div>
            {aiResult.summary ? (
              <p className="whitespace-pre-wrap text-sm">{aiResult.summary}</p>
            ) : null}
            {aiResult.discrepancies.length > 0 ? (
              <ul className="space-y-1">
                {aiResult.discrepancies.map((d, i) => (
                  <li key={i} className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {d.kind} · {d.recipeName}
                    </span>
                    {" — "}
                    {d.message}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                Every recipe on this spec sheet matches your current recipes exactly.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
