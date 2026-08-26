import { useEffect, useState } from "react";
import {
  X,
  FileSpreadsheet,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Link2,
  Layers,
  Clock,
} from "lucide-react";
import { resolveCheeseCandidate, type CheeseImportCandidate } from "@workspace/cheese-import";
import { useAccessibleDialog } from "./useAccessibleDialog";
import type { CheeseRecipe } from "@workspace/cheese-recipes";
import type { SpecImportAlias } from "@workspace/spec-import";
import type { CheeseImportPrepared } from "@/cheeseImport";

type Props = {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  /** Multi-file parse progress; null for a single file. */
  progress?: { done: number; total: number } | null;
  error: string | null;
  prepared: CheeseImportPrepared | null;
  applying: boolean;
  /**
   * Confirm with the reviewed cheese recipes, blend-name aliases the manual
   * "use existing recipe" picks should be remembered as, and the ids of absent
   * recipes the manager chose to remove.
   */
  onConfirm: (
    recipesToApply: CheeseRecipe[],
    newAliases: SpecImportAlias[],
    recipesToRemove: string[],
    destructiveChangesAcknowledged: boolean,
  ) => void;
};

type Item = { key: string; candidate: CheeseImportCandidate };

// Review screen for the "Cheese Mix Recipe Specs" importer. Each customer tab is
// parsed deterministically into cheese recipes (shredder setting, per-flavor
// assignment lines, per-batch pounds). The manager reviews every parsed recipe
// and can include/exclude each one before confirming. Mirrors the mobile modal
// in artifacts/run-calculator-mobile (replit.md parity).
export default function CheeseImportDialog({
  open,
  onClose,
  loading,
  progress,
  error,
  prepared,
  applying,
  onConfirm,
}: Props) {
  const dialogRef = useAccessibleDialog<HTMLDivElement>(open, onClose);
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Absent-recipe ids the manager wants to remove on confirm.
  const [removedRecipes, setRemovedRecipes] = useState<Set<string>>(new Set());
  // Keys whose proposed "link to existing recipe" the manager is accepting.
  // Defaults on for every candidate that has a suggested link.
  const [linkOn, setLinkOn] = useState<Set<string>>(new Set());
  // Manual "use existing recipe instead" picks: key → existing pool recipe id.
  // A manual pick overrides the suggested link (and is remembered on confirm).
  const [redirects, setRedirects] = useState<Map<string, string>>(new Map());
  // Rename-before-create: key → new name typed by the manager. Only applies
  // when the row is NOT redirected to an existing recipe (a redirect keeps the
  // target's name). The sheet's original name is remembered as an alias so
  // re-imports still match the renamed recipe.
  const [renames, setRenames] = useState<Map<string, string>>(new Map());
  // Merge-re-import rows: this sheet block's name was previously MERGED onto an
  // existing recipe (learned alias link) whose OWN sheet block is also present
  // as an exact update. Both rows would target the same saved recipe, so the
  // merged-away one starts UNCHECKED with an explanatory note instead of
  // tripping the generic duplicate-target block.
  const [mergedAwayKeys, setMergedAwayKeys] = useState<Set<string>>(new Set());
  const [destructiveChangesConfirmed, setDestructiveChangesConfirmed] = useState(false);

  useEffect(() => {
    if (prepared) {
      setDestructiveChangesConfirmed(false);
      // Detect the merge-re-import case: an alias-linked row whose link target
      // is also claimed by another candidate's exact-id update.
      const exactIds = new Set(
        prepared.candidates
          .filter((c) => c.status === "update")
          .map((c) => c.recipe.id),
      );
      const mergedAway = new Set(
        prepared.candidates
          .filter(
            (c) =>
              c.linkTo &&
              c.linkedByAlias &&
              exactIds.has(c.linkTo.id) &&
              c.linkTo.id !== c.recipe.id,
          )
          .map((c) => c.recipe.id),
      );
      setMergedAwayKeys(mergedAway);
      setItems(prepared.candidates.map((c) => ({ key: c.recipe.id, candidate: c })));
      const auditedIds = prepared.auditApproval
        ? new Set(prepared.auditApproval.approvedLinks.map((link) => link.sourceId))
        : null;
      setSelected(
        new Set(
          prepared.candidates
            .map((c) => c.recipe.id)
            .filter((id) => !mergedAway.has(id) && (!auditedIds || auditedIds.has(id))),
        ),
      );
      setLinkOn(
        new Set(prepared.candidates.filter((c) => c.linkTo).map((c) => c.recipe.id)),
      );
      setRedirects(new Map());
      setRenames(new Map());
    } else {
      setDestructiveChangesConfirmed(false);
      setItems([]);
      setSelected(new Set());
      setRemovedRecipes(new Set());
      setLinkOn(new Set());
      setRedirects(new Map());
      setRenames(new Map());
      setMergedAwayKeys(new Set());
    }
  }, [prepared]);

  if (!open) return null;

  const s = prepared?.summary;
  const auditApproval = prepared?.auditApproval;
  const nothing = s != null && s.total === 0;
  const selectedCount = items.filter((it) => selected.has(it.key)).length;

  const toggle = (key: string) =>
    auditApproval
      ? undefined
      :
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleLink = (key: string) =>
    auditApproval
      ? undefined
      :
    setLinkOn((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const setRedirect = (key: string, targetId: string) =>
    auditApproval
      ? undefined
      :
    setRedirects((prev) => {
      const next = new Map(prev);
      if (targetId) next.set(key, targetId);
      else next.delete(key);
      return next;
    });

  const setRename = (key: string, name: string) =>
    auditApproval
      ? undefined
      :
    setRenames((prev) => {
      const next = new Map(prev);
      if (name) next.set(key, name);
      else next.delete(key);
      return next;
    });

  const poolById = new Map((prepared?.existingPool ?? []).map((p) => [p.id, p]));

  /** The manual redirect target for a row, if a valid pick is set. */
  const redirectTargetOf = (key: string) => {
    const id = redirects.get(key);
    return id ? poolById.get(id) : undefined;
  };

  /** The manager's rename for a row, if any (trimmed, non-empty, actually different). */
  const renameOf = (it: Item): string | null => {
    if (redirectTargetOf(it.key)) return null; // redirect keeps the target's name
    const typed = (renames.get(it.key) ?? "").trim();
    if (!typed) return null;
    if (typed.toLowerCase() === it.candidate.recipe.name.trim().toLowerCase()) return null;
    return typed;
  };

  /** Final recipe a row resolves to (manual redirect wins over suggested link). */
  const resolveItem = (it: Item): CheeseRecipe => {
    const target = redirectTargetOf(it.key);
    if (target) {
      return resolveCheeseCandidate(
        { ...it.candidate, linkTo: { id: target.id, name: target.name } },
        true,
      );
    }
    const resolved = resolveCheeseCandidate(it.candidate, linkOn.has(it.key));
    const rename = renameOf(it);
    return rename ? { ...resolved, name: rename } : resolved;
  };

  // Two included rows resolving to the SAME saved recipe would collide in the
  // last-write-wins merge and silently drop one row's data — block Apply until
  // the manager changes one of the picks.
  const included = items.filter((it) => selected.has(it.key));
  const destructiveChanges = [
    ...included.map((it) => it.candidate.status === "update"
      ? `Replaces the formula for "${resolveItem(it).name}".`
      : null,
    ).filter((message): message is string => !!message),
    ...[...removedRecipes].map((id) => `Removes "${poolById.get(id)?.name ?? id}".`),
  ];
  const requiresDestructiveConfirmation = destructiveChanges.length > 0;
  const finalIdCounts = new Map<string, number>();
  for (const it of included) {
    const id = resolveItem(it).id;
    finalIdCounts.set(id, (finalIdCounts.get(id) ?? 0) + 1);
  }
  const duplicateTargets = [...finalIdCounts.entries()]
    .filter(([, n]) => n > 1)
    .map(([id]) => poolById.get(id)?.name ?? id);

  // A rename that matches a DIFFERENT existing pool recipe's name would create
  // a confusing same-named duplicate — the right move there is the "Use
  // existing recipe" pick, so block Apply and say so.
  const renameCollisions: string[] = [];
  {
    const finalNameCounts = new Map<string, number>();
    for (const it of included) {
      const name = resolveItem(it).name.trim().toLowerCase();
      if (name) finalNameCounts.set(name, (finalNameCounts.get(name) ?? 0) + 1);
    }
    for (const it of included) {
      const rename = renameOf(it);
      if (!rename) continue;
      const lc = rename.toLowerCase();
      const resolvedId = resolveItem(it).id;
      const poolClash = (prepared?.existingPool ?? []).some(
        (p) => p.id !== resolvedId && p.name.trim().toLowerCase() === lc,
      );
      if (poolClash || (finalNameCounts.get(lc) ?? 0) > 1) renameCollisions.push(rename);
    }
  }

  const confirm = () => {
    if (duplicateTargets.length > 0 || renameCollisions.length > 0 || (requiresDestructiveConfirmation && !destructiveChangesConfirmed)) return;
    const newAliases: SpecImportAlias[] = [];
    const seen = new Set<string>();
    // Write BOTH a brand-scoped alias (context = the sheet's customer, so the
    // redirect only pre-applies on that customer's re-imports) and the shared
    // context-free row (fallback for older flows). Unbranded blends only get
    // the shared row.
    const addAlias = (external: string, canonical: string, brand: string) => {
      if (!external || !canonical) return;
      if (external.toLowerCase() === canonical.toLowerCase()) return;
      const push = (context: string | null) => {
        const dedupeKey = `${external.toLowerCase()}\u0000${(context ?? "").toLowerCase()}`;
        if (seen.has(dedupeKey)) return;
        seen.add(dedupeKey);
        newAliases.push({
          kind: "appType",
          externalName: external,
          canonicalName: canonical,
          context,
        });
      };
      if (brand) push(brand);
      push(null);
    };
    for (const it of included) {
      const brand = it.candidate.recipe.brand.trim();
      const target = redirectTargetOf(it.key);
      if (target) {
        addAlias(it.candidate.recipe.name.trim(), target.name.trim(), brand);
        continue;
      }
      // Rename-before-create: remember the sheet's original name as an alias
      // for the new name so a re-import links instead of duplicating.
      const rename = renameOf(it);
      if (rename) addAlias(it.candidate.recipe.name.trim(), rename, brand);
    }
    onConfirm(included.map(resolveItem), newAliases, [...removedRecipes], destructiveChangesConfirmed);
  };

  return (
    <div
      // No close-on-backdrop-click: the AI parse is slow and the review step
      // holds unsaved edits — a stray tap would silently cancel the import.
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cheese-import-dialog-title"
        className="w-full max-w-lg max-h-[90vh] flex flex-col rounded-xl border border-border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border p-4">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            <h2 id="cheese-import-dialog-title" className="text-base font-semibold text-foreground">Import Cheese Recipes</h2>
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
                  ? `Reading file ${Math.min(progress.done + 1, progress.total)} of ${progress.total} and reading cheese sheets…`
                  : "Reading the workbook and building cheese recipes from each tab…"}
              </p>
              {auditApproval && (
                <div className="rounded-md border border-blue-400/60 bg-blue-500/10 p-3 text-xs text-blue-800" data-testid="cheese-audit-approval">
                  This is the retained audited workbook. Exactly {auditApproval.approvedLinks.length} approved links are locked for application.
                  The Price Chopper Chicken Bacon Club formula conflict is held separately; no rows can be added or removed in this mode.
                </div>
              )}
              {prepared?.auditBlockedReason && (
                <div className="rounded-md border border-destructive/60 bg-destructive/10 p-3 text-xs text-destructive" data-testid="cheese-audit-blocked">
                  {prepared.auditBlockedReason}
                </div>
              )}
              <p className="text-xs text-muted-foreground/80">
                If the app sat idle, the server may need a moment to wake up first.
              </p>
              {/* Explicit escape hatch: if a request stalls (e.g. the server is
                  cold-starting), the user shouldn't have to find the small X to
                  get out of the blocking backdrop. */}
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Cancel import
              </button>
            </div>
          )}

          {!loading && error && (
            <div className="rounded-md border border-destructive/60 bg-destructive/10 p-3">
              <div className="flex items-center gap-2 text-red-400">
                <AlertTriangle className="h-4 w-4" />
                <span className="text-sm font-medium">Could not import</span>
              </div>
              <p className="mt-1 text-sm text-red-400">{error}</p>
            </div>
          )}

          {!loading && !error && prepared && (
            <>
              <p className="text-xs text-muted-foreground rounded-md border border-border bg-muted/40 p-2">
                Tip: for the best matching, import in this order — dough &amp;
                sauce recipes first, then spec sheets, then cheese and premix
                sheets. That way each import can link to what's already saved
                instead of creating duplicates.
              </p>
              <p className="text-sm text-muted-foreground">
                Review each cheese recipe below. Uncheck any you don't want.
                Checked recipes marked{" "}
                <span className="font-medium text-foreground">update</span> will
                replace the existing recipe;{" "}
                <span className="font-medium text-foreground">new</span> ones will
                be added.
              </p>

              <div className="rounded-lg border border-border p-3">
                <div className="text-2xl font-bold text-foreground">{selectedCount}</div>
                <div className="text-xs font-medium text-muted-foreground">
                  of {s!.total} recipes selected
                </div>
              </div>

              {items.length > 0 && (
                <ul className="space-y-2">
                  {items.map((it) => {
                    const c = it.candidate;
                    const r = c.recipe;
                    const isSel = selected.has(it.key);
                    const redirectTarget = redirectTargetOf(it.key);
                    const linked = !!redirectTarget || (!!c.linkTo && linkOn.has(it.key));
                    return (
                      <li
                        key={it.key}
                        className="rounded-lg border border-border p-3"
                        data-testid={`cheese-candidate-${it.key}`}
                      >
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={isSel}
                            onChange={() => toggle(it.key)}
                            disabled={!!auditApproval}
                            className="mt-1 h-4 w-4 accent-primary"
                            aria-label={`Include ${r.name}`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-sm font-medium text-foreground">
                                {r.name}
                              </span>
                              <span
                                className={
                                  linked
                                    ? "shrink-0 rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-blue-600"
                                    : c.status === "new"
                                      ? "shrink-0 rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-green-600"
                                      : "shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-primary"
                                }
                              >
                                {linked ? "link" : c.status}
                              </span>
                            </div>

                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                              {r.brand && (
                                <span>
                                  Customer:{" "}
                                  <span className="text-foreground">{r.brand}</span>
                                </span>
                              )}
                              {r.shredderSetting && (
                                <span>
                                  Shredder:{" "}
                                  <span className="text-foreground">{r.shredderSetting}</span>
                                </span>
                              )}
                              <span>
                                {r.components.length} ingredient
                                {r.components.length === 1 ? "" : "s"}
                              </span>
                            </div>
                            {r.flavors.length > 0 && (
                              <div className="mt-1 text-xs text-muted-foreground">
                                Flavors:{" "}
                                <span className="text-foreground">
                                  {r.flavors.join(", ")}
                                </span>
                              </div>
                            )}
                            {c.subMixOf && (
                              <div
                                className="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-purple-400/50 bg-purple-500/10 p-2"
                                data-testid={`cheese-submix-${it.key}`}
                              >
                                <Layers className="h-3.5 w-3.5 shrink-0 text-purple-600" />
                                <span className="text-xs text-purple-700">
                                  Sub-mix used inside{" "}
                                  <span className="font-medium">"{c.subMixOf}"</span>{" "}
                                  — not applied to pizzas on its own.
                                </span>
                              </div>
                            )}
                            {mergedAwayKeys.has(it.key) && (
                              <div
                                className="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-amber-400/60 bg-amber-500/10 p-2"
                                data-testid={`cheese-merged-away-${it.key}`}
                              >
                                <Link2 className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                                <span className="text-xs text-amber-700">
                                  This sheet was merged into{" "}
                                  <span className="font-medium">"{c.linkTo?.name}"</span>
                                  , which is also in this workbook — so it's
                                  left unchecked. Check it only if you want it
                                  to overwrite that recipe.
                                </span>
                              </div>
                            )}
                            {c.linkTo && !redirectTarget && (
                              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-blue-400/50 bg-blue-500/10 p-2">
                                <Link2 className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                                <span className="text-xs text-blue-700">
                                  Looks like your existing{" "}
                                  <span className="font-medium">"{c.linkTo.name}"</span>
                                </span>
                                <label
                                  className="ml-auto flex items-center gap-1.5 text-xs text-blue-700"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <input
                                    type="checkbox"
                                    className="h-3.5 w-3.5 accent-blue-600"
                                    checked={!!c.linkTo && linkOn.has(it.key)}
                                    onChange={() => toggleLink(it.key)}
                                    disabled={!!auditApproval}
                                    data-testid={`cheese-link-${it.key}`}
                                  />
                                  Update it instead of adding new
                                </label>
                              </div>
                            )}
                            {!auditApproval && !redirectTarget && isSel && (
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <label
                                  className="text-xs text-muted-foreground"
                                  htmlFor={`cheese-rename-${it.key}`}
                                >
                                  Save as:
                                </label>
                                <input
                                  id={`cheese-rename-${it.key}`}
                                  type="text"
                                  value={renames.get(it.key) ?? ""}
                                  onChange={(e) => setRename(it.key, e.target.value)}
                                  placeholder={r.name}
                                  className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                                  data-testid={`cheese-rename-${it.key}`}
                                />
                              </div>
                            )}
                            {!auditApproval && prepared.existingPool.length > 0 && (
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <label
                                  className="text-xs text-muted-foreground"
                                  htmlFor={`cheese-redirect-${it.key}`}
                                >
                                  Use existing recipe:
                                </label>
                                <select
                                  id={`cheese-redirect-${it.key}`}
                                  value={redirects.get(it.key) ?? ""}
                                  onChange={(e) => setRedirect(it.key, e.target.value)}
                                  className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                                  data-testid={`cheese-redirect-${it.key}`}
                                >
                                  <option value="">No — import as shown above</option>
                                  {prepared.existingPool.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.name}
                                      {p.brand ? ` (${p.brand})` : ""}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                            {redirectTarget && (
                              <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-blue-400/50 bg-blue-500/10 p-2">
                                <Link2 className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                                <span className="text-xs text-blue-700">
                                  Will update your existing{" "}
                                  <span className="font-medium">"{redirectTarget.name}"</span>{" "}
                                  with this sheet's ingredients — and remember this
                                  choice for future imports.
                                </span>
                              </div>
                            )}
                            {auditApproval?.held.sourceId === it.key && (
                              <div className="mt-2 rounded-md border border-amber-400/60 bg-amber-500/10 p-2 text-xs text-amber-800">
                                {auditApproval.held.reason} It is intentionally not applied.
                              </div>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              {prepared.prepItems.length > 0 && (
                <div
                  className="rounded-md border border-purple-400/50 bg-purple-500/10 p-3"
                  data-testid="cheese-prep-items"
                >
                  <div className="flex items-center gap-2 text-purple-700">
                    <Clock className="h-4 w-4" />
                    <span className="text-sm font-medium">
                      Fresh / prep items to pull early
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-purple-700/90">
                    These fresh ingredients appear inside cheese blends. They're
                    imported as part of the recipe — this list is just a reminder
                    to prep or pull them ahead.
                  </p>
                  <ul className="mt-2 space-y-1">
                    {prepared.prepItems.map((p) => (
                      <li
                        key={`${p.blend}\u0000${p.ingredient}`}
                        className="text-xs text-purple-800"
                      >
                        <span className="font-medium">{p.ingredient}</span>
                        {p.lbs > 0 ? ` — ${p.lbs} lbs` : ""}{" "}
                        <span className="text-purple-700/80">in {p.blend}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {!auditApproval && (prepared.absentRecipes?.length ?? 0) > 0 && (
                <div
                  className="rounded-md border border-amber-400/60 bg-amber-500/10 p-3"
                  data-testid="cheese-absent-recipes"
                >
                  <p className="text-sm font-medium text-amber-700">
                    No longer in workbook ({prepared.absentRecipes.length})
                  </p>
                  <p className="mt-1 text-xs text-amber-700/80">
                    These saved recipes share a brand with the imported file but are not
                    in it. Check the boxes to remove them, or leave unchecked to keep them.
                  </p>
                  <ul className="mt-2 space-y-1">
                    {prepared.absentRecipes.map((r) => (
                      <li key={r.id} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id={`absent-recipe-${r.id}`}
                          checked={removedRecipes.has(r.id)}
                          onChange={() =>
                            setRemovedRecipes((prev) => {
                              const next = new Set(prev);
                              if (next.has(r.id)) next.delete(r.id);
                              else next.add(r.id);
                              return next;
                            })
                          }
                          className="h-4 w-4 rounded border-amber-400 accent-amber-600"
                        />
                        <label
                          htmlFor={`absent-recipe-${r.id}`}
                          className="text-xs text-amber-800 cursor-pointer"
                        >
                          {r.name}
                          {r.brand && <> · {r.brand}</>}
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {requiresDestructiveConfirmation && (
                <label className="flex cursor-pointer items-start gap-2 rounded border border-amber-400/60 bg-amber-500/10 p-3 text-xs text-amber-900" data-testid="cheese-import-destructive-confirmation">
                  <input type="checkbox" checked={destructiveChangesConfirmed} onChange={(event) => setDestructiveChangesConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 accent-amber-600" />
                  <span><b>Review required.</b> {destructiveChanges.slice(0, 3).join(" ")} I want to apply these shared recipe changes.</span>
                </label>
              )}

              {duplicateTargets.length > 0 && (
                <div
                  className="rounded-md border border-destructive/60 bg-destructive/10 p-3"
                  data-testid="cheese-duplicate-target-warning"
                >
                  <div className="flex items-center gap-2 text-destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-sm font-medium">
                      Two recipes point at the same saved recipe
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-destructive/90">
                    More than one checked recipe would update{" "}
                    {duplicateTargets.map((n) => `"${n}"`).join(", ")} — only one
                    would survive. Change one of the "Use existing recipe" picks
                    (or uncheck one) before applying.
                  </p>
                  {included.some((it) => mergedAwayKeys.has(it.key)) && (
                    <p className="mt-1 text-sm text-destructive/90" data-testid="cheese-merge-hint">
                      Tip: these sheets were merged in Manage Lists — uncheck
                      the old (merged-away) sheet's row to apply.
                    </p>
                  )}
                </div>
              )}

              {renameCollisions.length > 0 && (
                <div
                  className="rounded-md border border-destructive/60 bg-destructive/10 p-3"
                  data-testid="cheese-rename-collision-warning"
                >
                  <div className="flex items-center gap-2 text-destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-sm font-medium">
                      A "Save as" name is already taken
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-destructive/90">
                    {renameCollisions.map((n) => `"${n}"`).join(", ")} matches an
                    existing recipe (or another row here). Pick it under "Use
                    existing recipe" instead, or choose a different name.
                  </p>
                </div>
              )}

              {prepared.note && (
                <div className="rounded-md border border-amber-400/60 bg-amber-500/10 p-3">
                  <div className="flex items-center gap-2 text-amber-600">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-sm font-medium">Note</span>
                  </div>
                  <p className="mt-1 text-sm text-amber-700">{prepared.note}</p>
                </div>
              )}

              {nothing && (
                <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                  No cheese recipes were found in this workbook. Try a different file.
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
            onClick={confirm}
            disabled={
              loading ||
              applying ||
              !!error ||
              !!prepared?.auditBlockedReason ||
              !prepared ||
              nothing ||
              selectedCount === 0 ||
              duplicateTargets.length > 0 ||
               renameCollisions.length > 0 ||
               (requiresDestructiveConfirmation && !destructiveChangesConfirmed)
            }
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {applying ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            Apply {selectedCount > 0 ? selectedCount : ""} recipe
            {selectedCount === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}
