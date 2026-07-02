import { useEffect, useMemo, useRef, useState } from "react";
import { X, Upload, Sparkles, History } from "lucide-react";
import {
  exactMatch,
  fuzzyMatch,
  mergeImportRuns,
  collectImportAliases,
  type ImportParseResult,
} from "@/utils/runExcel";
import { requestMatchImport } from "@/matchImport";
import { fetchImportAliases, saveImportAliases } from "@/importAliases";
import { saveAiCorrections } from "@/aiCorrections";
import type { ReviewVerdict } from "@workspace/ai-review";
import ReviewBadge from "./ReviewBadge";

const SKIP = "";
const CREATE = "__create__";

export type ImportCommitRunEntry = { brand: string; flavor: string; casesPlanned: number; notes: string };

export type ImportCommit = {
  date: string;
  runs: ImportCommitRunEntry[];
  createBrands: string[];
  createFlavors: { brand: string; flavor: string }[];
  // Set for multi-sheet day-block schedule imports: runs grouped by their own
  // production date (each date is committed/overridden independently). When
  // present, `date` is empty and `runs` is the flattened union (for counts).
  multiDay?: boolean;
  byDate?: { date: string; runs: ImportCommitRunEntry[] }[];
};

type Props = {
  open: boolean;
  onClose: () => void;
  result: ImportParseResult | null;
  brands: string[];
  brandFlavors: Record<string, string[]>;
  canCreate: boolean;
  defaultDate: string;
  onConfirm: (payload: ImportCommit) => void;
  // Multi-day commits write one date at a time; surface progress so the user
  // knows a large planner import is still running. Null ⇒ idle.
  progress?: { done: number; total: number } | null;
};

export default function ExcelImportDialog({
  open,
  onClose,
  result,
  brands,
  brandFlavors,
  canCreate,
  defaultDate,
  onConfirm,
  progress,
}: Props) {
  const [date, setDate] = useState(defaultDate);
  const [brandChoice, setBrandChoice] = useState<Record<string, string>>({});
  const [flavorChoice, setFlavorChoice] = useState<Record<string, string>>({});
  // AI-suggested matches for names that did not exactly match (best-effort; the
  // dialog still works without them via the Levenshtein fuzzy chips).
  const [aiBrandMatch, setAiBrandMatch] = useState<Record<string, string>>({});
  const [aiFlavorMatch, setAiFlavorMatch] = useState<Record<string, string>>({});
  // Reviewer-AI verdicts for the AI-suggested matches (advisory; keyed like the
  // match maps). Shown next to a row when the user's current choice is the AI
  // value the reviewer flagged.
  const [aiBrandReview, setAiBrandReview] = useState<Record<string, ReviewVerdict>>({});
  const [aiFlavorReview, setAiFlavorReview] = useState<Record<string, ReviewVerdict>>({});
  const [aiLoading, setAiLoading] = useState(false);
  // Candidate keys already sent to the AI, so the brand->flavor cascade does not
  // refetch the same names repeatedly.
  const aiRequestedBrands = useRef<Set<string>>(new Set());
  const aiRequestedFlavors = useRef<Set<string>>(new Set());
  // Learned aliases — confirmed matches from PAST imports, fetched once per file
  // and auto-applied (taking priority over AI; the AI never re-derives names an
  // alias already covers). Keyed like the AI maps: brand by lowercased imported
  // name, flavor by `${brandLower}|||${flavorLower}`.
  const [aliasBrandMatch, setAliasBrandMatch] = useState<Record<string, string>>({});
  const [aliasFlavorMatch, setAliasFlavorMatch] = useState<Record<string, string>>({});
  const [aliasLoaded, setAliasLoaded] = useState(false);

  const rows = result?.rows ?? [];
  const errors = result?.errors ?? [];

  useEffect(() => {
    if (!result) return;
    setDate(defaultDate);
    const bc: Record<string, string> = {};
    for (const r of result.rows) {
      const key = r.brand.toLowerCase();
      if (bc[key] !== undefined) continue;
      bc[key] = exactMatch(r.brand, brands) ?? SKIP;
    }
    setBrandChoice(bc);
    setFlavorChoice({});
  }, [result, defaultDate, brands]);

  const resolveBrandName = useMemo(
    () =>
      (candidate: string): string | null => {
        const choice = brandChoice[candidate.toLowerCase()] ?? SKIP;
        if (choice === CREATE) return candidate;
        if (choice === SKIP) return null;
        return choice;
      },
    [brandChoice],
  );

  useEffect(() => {
    if (!result) return;
    setFlavorChoice((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const r of result.rows) {
        if (!r.flavor) continue;
        const brandName = resolveBrandName(r.brand);
        if (!brandName) continue;
        const key = `${brandName.toLowerCase()}|||${r.flavor.toLowerCase()}`;
        if (next[key] !== undefined) continue;
        const opts = brandFlavors[brandName] ?? [];
        next[key] = exactMatch(r.flavor, opts) ?? SKIP;
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [result, brandChoice, brandFlavors, resolveBrandName]);

  // Reset AI state whenever a new file is parsed.
  useEffect(() => {
    aiRequestedBrands.current = new Set();
    aiRequestedFlavors.current = new Set();
    setAiBrandMatch({});
    setAiFlavorMatch({});
    setAiBrandReview({});
    setAiFlavorReview({});
    setAiLoading(false);
  }, [result]);

  // Fetch learned aliases once per parsed file and build lookup maps. Best-effort
  // (sync off / offline → no aliases). `aliasLoaded` gates the AI request so the
  // AI never re-derives a name an alias already covers (alias wins).
  useEffect(() => {
    if (!result) return;
    setAliasBrandMatch({});
    setAliasFlavorMatch({});
    setAliasLoaded(false);
    let cancelled = false;
    fetchImportAliases()
      .then((aliases) => {
        if (cancelled) return;
        const bm: Record<string, string> = {};
        const fm: Record<string, string> = {};
        for (const a of aliases) {
          if (a.type === "brand") {
            bm[a.externalName.toLowerCase()] = a.canonicalName;
          } else if (a.type === "flavor" && a.brandContext) {
            fm[`${a.brandContext.toLowerCase()}|||${a.externalName.toLowerCase()}`] =
              a.canonicalName;
          }
        }
        setAliasBrandMatch(bm);
        setAliasFlavorMatch(fm);
      })
      .catch(() => {
        /* best-effort; proceed with no learned aliases */
      })
      .finally(() => {
        if (!cancelled) setAliasLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [result]);

  // Ask the AI to match still-unmatched brand/flavor names against the saved
  // ones. Runs again as brands resolve (exposing more flavors); a per-candidate
  // ref guard prevents refetching the same names. Best-effort: any failure
  // (offline, not a manager, rate-limited) is swallowed and the user falls back
  // to the fuzzy chips.
  useEffect(() => {
    if (!result) return;
    // Wait for learned aliases so the AI doesn't re-derive names an alias already
    // covers (a learned, human-confirmed match always wins over a fresh guess).
    if (!aliasLoaded) return;
    const newBrands: string[] = [];
    const seenB = new Set<string>();
    for (const r of result.rows) {
      const k = r.brand.toLowerCase();
      if (seenB.has(k)) continue;
      seenB.add(k);
      if (exactMatch(r.brand, brands)) continue;
      // Covered by a valid learned alias → skip the AI for this brand.
      if (aliasBrandMatch[k] && brands.includes(aliasBrandMatch[k])) continue;
      if (aiRequestedBrands.current.has(k)) continue;
      newBrands.push(r.brand);
    }
    const newFlavors: { brand: string; flavor: string }[] = [];
    const seenF = new Set<string>();
    for (const r of result.rows) {
      if (!r.flavor) continue;
      const brandName = resolveBrandName(r.brand);
      if (!brandName) continue;
      const opts = brandFlavors[brandName] ?? [];
      if (exactMatch(r.flavor, opts)) continue;
      const key = `${brandName.toLowerCase()}|||${r.flavor.toLowerCase()}`;
      if (seenF.has(key)) continue;
      seenF.add(key);
      // Covered by a valid learned alias → skip the AI for this flavor.
      if (aliasFlavorMatch[key] && opts.includes(aliasFlavorMatch[key])) continue;
      if (aiRequestedFlavors.current.has(key)) continue;
      newFlavors.push({ brand: brandName, flavor: r.flavor });
    }
    if (newBrands.length === 0 && newFlavors.length === 0) return;
    newBrands.forEach((b) => aiRequestedBrands.current.add(b.toLowerCase()));
    newFlavors.forEach((f) =>
      aiRequestedFlavors.current.add(`${f.brand.toLowerCase()}|||${f.flavor.toLowerCase()}`),
    );

    let cancelled = false;
    setAiLoading(true);
    requestMatchImport({ brands, brandFlavors, unmatchedBrands: newBrands, unmatchedFlavors: newFlavors })
      .then((r) => {
        if (cancelled) return;
        if (r.brandMatches.length) {
          setAiBrandMatch((p) => {
            const next = { ...p };
            for (const m of r.brandMatches) next[m.candidate.toLowerCase()] = m.match;
            return next;
          });
          setAiBrandReview((p) => {
            const next = { ...p };
            for (const m of r.brandMatches) if (m.review) next[m.candidate.toLowerCase()] = m.review;
            return next;
          });
        }
        if (r.flavorMatches.length) {
          setAiFlavorMatch((p) => {
            const next = { ...p };
            for (const m of r.flavorMatches) {
              next[`${m.brand.toLowerCase()}|||${m.candidate.toLowerCase()}`] = m.match;
            }
            return next;
          });
          setAiFlavorReview((p) => {
            const next = { ...p };
            for (const m of r.flavorMatches) {
              if (m.review) next[`${m.brand.toLowerCase()}|||${m.candidate.toLowerCase()}`] = m.review;
            }
            return next;
          });
        }
      })
      .catch(() => {
        /* best-effort; fall back to fuzzy chips */
      })
      .finally(() => {
        if (!cancelled) setAiLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [result, brandChoice, brands, brandFlavors, resolveBrandName, aliasLoaded, aliasBrandMatch, aliasFlavorMatch]);

  // Apply learned brand aliases to choices still at SKIP (never clobber a user
  // pick; only when the saved target still exists).
  useEffect(() => {
    if (Object.keys(aliasBrandMatch).length === 0) return;
    setBrandChoice((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [k, v] of Object.entries(aliasBrandMatch)) {
        if ((next[k] ?? SKIP) === SKIP && brands.includes(v)) {
          next[k] = v;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [aliasBrandMatch, brands]);

  // Apply learned flavor aliases to choices still at SKIP — only when the saved
  // target still exists under that brand (a stale alias must NOT lock in a
  // now-missing flavor; leaving it SKIP lets AI/fuzzy correct it instead).
  useEffect(() => {
    if (Object.keys(aliasFlavorMatch).length === 0) return;
    const optsByBrandLower = new Map<string, string[]>();
    for (const [b, opts] of Object.entries(brandFlavors)) {
      optsByBrandLower.set(b.toLowerCase(), opts);
    }
    setFlavorChoice((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [k, v] of Object.entries(aliasFlavorMatch)) {
        if ((next[k] ?? SKIP) !== SKIP) continue;
        const brandLower = k.split("|||")[0] ?? "";
        const opts = optsByBrandLower.get(brandLower) ?? [];
        if (!opts.includes(v)) continue;
        next[k] = v;
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [aliasFlavorMatch, brandFlavors]);

  // Apply AI brand matches to choices still at SKIP (never clobber a user pick).
  useEffect(() => {
    if (Object.keys(aiBrandMatch).length === 0) return;
    setBrandChoice((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [k, v] of Object.entries(aiBrandMatch)) {
        if ((next[k] ?? SKIP) === SKIP && brands.includes(v)) {
          next[k] = v;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [aiBrandMatch, brands]);

  // Apply AI flavor matches to choices still at SKIP (never clobber a user pick).
  useEffect(() => {
    if (Object.keys(aiFlavorMatch).length === 0) return;
    setFlavorChoice((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [k, v] of Object.entries(aiFlavorMatch)) {
        if ((next[k] ?? SKIP) === SKIP) {
          next[k] = v;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [aiFlavorMatch]);

  const uniqueBrands = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      const k = r.brand.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      if (!exactMatch(r.brand, brands)) out.push(r.brand);
    }
    return out;
  }, [rows, brands]);

  const uniqueFlavors = useMemo(() => {
    const out: { brandName: string; flavor: string; key: string }[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      if (!r.flavor) continue;
      const brandName = resolveBrandName(r.brand);
      if (!brandName) continue;
      const opts = brandFlavors[brandName] ?? [];
      if (exactMatch(r.flavor, opts)) continue;
      const key = `${brandName.toLowerCase()}|||${r.flavor.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ brandName, flavor: r.flavor, key });
    }
    return out;
  }, [rows, brandFlavors, resolveBrandName]);

  function buildCommit(): ImportCommit {
    const createBrands = new Set<string>();
    const createFlavors = new Map<string, { brand: string; flavor: string }>();
    const out: (ImportCommitRunEntry & { srcDate?: string })[] = [];
    for (const r of rows) {
      const brandName = resolveBrandName(r.brand);
      if (!brandName) continue;
      if ((brandChoice[r.brand.toLowerCase()] ?? SKIP) === CREATE) createBrands.add(brandName);
      let flavorName = "";
      if (r.flavor) {
        const key = `${brandName.toLowerCase()}|||${r.flavor.toLowerCase()}`;
        const fc = flavorChoice[key] ?? SKIP;
        if (fc === CREATE) {
          flavorName = r.flavor;
          createFlavors.set(`${brandName}|||${r.flavor}`, { brand: brandName, flavor: r.flavor });
        } else if (fc === SKIP) {
          continue;
        } else {
          flavorName = fc;
        }
      }
      out.push({ brand: brandName, flavor: flavorName, casesPlanned: r.casesPlanned, notes: r.notes, srcDate: r.date });
    }
    const strip = (o: ImportCommitRunEntry & { srcDate?: string }): ImportCommitRunEntry => ({
      brand: o.brand,
      flavor: o.flavor,
      casesPlanned: o.casesPlanned,
      notes: o.notes,
    });
    // Multi-sheet day-block file: group resolved runs by their own production
    // date and merge duplicates within each date. Each date is committed (and
    // overridden) independently by the caller.
    if (result?.multiDay) {
      const byDateMap = new Map<string, ImportCommitRunEntry[]>();
      for (const o of out) {
        if (!o.srcDate) continue;
        const arr = byDateMap.get(o.srcDate) ?? [];
        arr.push(strip(o));
        byDateMap.set(o.srcDate, arr);
      }
      const byDate = [...byDateMap.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([d, runs]) => ({ date: d, runs: mergeImportRuns(runs) }));
      return {
        date: "",
        runs: byDate.flatMap((b) => b.runs),
        multiDay: true,
        byDate,
        createBrands: [...createBrands],
        createFlavors: [...createFlavors.values()],
      };
    }
    return {
      date: date.trim(),
      runs: mergeImportRuns(out.map(strip)),
      createBrands: [...createBrands],
      createFlavors: [...createFlavors.values()],
    };
  }

  // Persist every non-exact match the user confirmed (manual, AI-accepted, or
  // alias-reused) so future imports auto-apply it. Best-effort; never blocks the
  // import.
  function handleConfirm() {
    const aliases = collectImportAliases(rows, brandChoice, flavorChoice, {
      skip: SKIP,
      create: CREATE,
    });
    if (aliases.length > 0) {
      void saveImportAliases(aliases).catch(() => {});
      // Also record each confirmed name fix in the factory-wide corrections pool
      // (additive — alongside the import-specific aliases above) so every other
      // name-resolving AI helper honors it too. Brand/flavor domains.
      void saveAiCorrections(
        aliases.map((a) => ({
          domain: a.type,
          fromText: a.externalName,
          toText: a.canonicalName,
        })),
      );
    }
    onConfirm(buildCommit());
  }

  const preview = buildCommit();
  const willImport = preview.runs.length;
  const skipped = rows.length - willImport;
  const multiDay = !!result?.multiDay;
  // Multi-day imports have no single date picker — each run carries its own day.
  const dateValid = multiDay || /^\d{4}-\d{2}-\d{2}$/.test(date.trim());
  const dayCount = preview.byDate?.length ?? 0;
  const dateRange = dayCount
    ? `${preview.byDate![0].date} → ${preview.byDate![dayCount - 1].date}`
    : "";

  if (!open) return null;

  const chipCls = (active: boolean, tone: "default" | "create" | "skip" | "ai" | "saved") => {
    const base = "text-xs px-2.5 py-1 rounded-full border transition-colors";
    if (tone === "saved") {
      return active
        ? `${base} border-amber-500 bg-amber-500/15 text-amber-600`
        : `${base} border-amber-400/60 text-amber-600 hover:bg-amber-500/10`;
    }
    if (tone === "ai") {
      return active
        ? `${base} border-violet-500 bg-violet-500/15 text-violet-600`
        : `${base} border-violet-400/60 text-violet-600 hover:bg-violet-500/10`;
    }
    if (!active) return `${base} border-border text-muted-foreground hover:bg-muted/50`;
    if (tone === "create") return `${base} border-green-500 bg-green-500/15 text-green-600`;
    if (tone === "skip") return `${base} border-destructive bg-destructive/15 text-destructive`;
    return `${base} border-primary bg-primary/15 text-primary`;
  };

  type ChipSource = "saved" | "ai" | "default";
  // Merge the learned-alias value (highest priority) and AI-suggested value into
  // the fuzzy chip list (dedup; saved first, then AI) and flag each value's
  // source so it can be tinted/iconed distinctly.
  const chipValues = (
    aliasVal: string | undefined,
    aiVal: string | undefined,
    fuzzy: { value: string }[],
  ): { value: string; source: ChipSource }[] => {
    const seen = new Set<string>();
    const out: { value: string; source: ChipSource }[] = [];
    const push = (value: string, source: ChipSource) => {
      const k = value.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ value, source });
    };
    if (aliasVal) push(aliasVal, "saved");
    if (aiVal) push(aiVal, "ai");
    for (const s of fuzzy) push(s.value, "default");
    return out;
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[90vh] flex flex-col rounded-xl border border-border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Upload className="w-4 h-4 text-primary" />
            <span className="text-base font-semibold text-foreground">Import Excel</span>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto space-y-4">
          {multiDay ? (
            <div className="rounded-md border border-border bg-muted/40 p-3">
              <p className="text-sm font-semibold text-foreground">Schedule planner detected</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {willImport} run{willImport === 1 ? "" : "s"} across {dayCount} day
                {dayCount === 1 ? "" : "s"}
                {dateRange ? ` (${dateRange})` : ""}. Only runs dated today or later are imported;
                re-importing replaces previously imported runs on each of these days.
              </p>
              {willImport === 0 && (
                <p className="mt-1 text-xs text-destructive">
                  No runs dated today or later were found in this file.
                </p>
              )}
            </div>
          ) : (
            <div>
              <label className="text-[11px] font-semibold text-muted-foreground tracking-wide">
                SCHEDULE DATE (YYYY-MM-DD)
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={`mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground ${
                  dateValid ? "border-border" : "border-destructive"
                }`}
              />
            </div>
          )}

          {errors.length > 0 && (
            <div className="rounded-md border border-destructive/60 p-3">
              <p className="text-sm font-semibold text-destructive mb-1">
                {errors.length} row{errors.length === 1 ? "" : "s"} skipped
              </p>
              <div className="max-h-32 overflow-y-auto space-y-0.5">
                {errors.map((e, i) => (
                  <p key={i} className="text-xs text-muted-foreground">
                    Row {e.rowNumber}: {e.message}
                  </p>
                ))}
              </div>
            </div>
          )}

          {aiLoading && (
            <div className="flex items-center gap-1.5 text-xs text-violet-600">
              <Sparkles className="w-3.5 h-3.5 animate-pulse" />
              AI matching…
            </div>
          )}

          {uniqueBrands.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-foreground mb-2">Map Brands</p>
              <div className="space-y-2">
                {uniqueBrands.map((cand) => {
                  const key = cand.toLowerCase();
                  const cur = brandChoice[key] ?? SKIP;
                  const sugg = chipValues(aliasBrandMatch[key], aiBrandMatch[key], fuzzyMatch(cand, brands));
                  return (
                    <div key={key} className="rounded-md border border-border p-2.5">
                      <p className="text-sm font-medium text-foreground mb-2">“{cand}”</p>
                      <div className="flex flex-wrap gap-1.5">
                        {sugg.map((s) => (
                          <button
                            key={s.value}
                            type="button"
                            className={chipCls(cur === s.value, s.source)}
                            onClick={() => setBrandChoice((p) => ({ ...p, [key]: s.value }))}
                          >
                            {s.source === "saved" && <History className="inline w-3 h-3 mr-0.5 -mt-0.5" />}
                            {s.source === "ai" && <Sparkles className="inline w-3 h-3 mr-0.5 -mt-0.5" />}
                            {s.value}
                          </button>
                        ))}
                        {canCreate && (
                          <button
                            type="button"
                            className={chipCls(cur === CREATE, "create")}
                            onClick={() => setBrandChoice((p) => ({ ...p, [key]: CREATE }))}
                          >
                            + Create “{cand}”
                          </button>
                        )}
                        <button
                          type="button"
                          className={chipCls(cur === SKIP, "skip")}
                          onClick={() => setBrandChoice((p) => ({ ...p, [key]: SKIP }))}
                        >
                          Skip
                        </button>
                      </div>
                      {brands.length > 0 && (
                        <select
                          className="mt-2 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground"
                          value={brands.includes(cur) ? cur : ""}
                          onChange={(e) =>
                            setBrandChoice((p) => ({ ...p, [key]: e.target.value }))
                          }
                        >
                          <option value="">Or link to an existing brand…</option>
                          {brands.map((b) => (
                            <option key={b} value={b}>
                              {b}
                            </option>
                          ))}
                        </select>
                      )}
                      {aiBrandReview[key] && cur === aiBrandMatch[key] && (
                        <ReviewBadge review={aiBrandReview[key]} className="mt-2" />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {uniqueFlavors.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-foreground mb-2">Map Flavors</p>
              <div className="space-y-2">
                {uniqueFlavors.map((f) => {
                  const cur = flavorChoice[f.key] ?? SKIP;
                  const sugg = chipValues(
                    aliasFlavorMatch[f.key],
                    aiFlavorMatch[f.key],
                    fuzzyMatch(f.flavor, brandFlavors[f.brandName] ?? []),
                  );
                  return (
                    <div key={f.key} className="rounded-md border border-border p-2.5">
                      <p className="text-sm font-medium text-foreground mb-2">
                        {f.brandName} → “{f.flavor}”
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {sugg.map((s) => (
                          <button
                            key={s.value}
                            type="button"
                            className={chipCls(cur === s.value, s.source)}
                            onClick={() => setFlavorChoice((p) => ({ ...p, [f.key]: s.value }))}
                          >
                            {s.source === "saved" && <History className="inline w-3 h-3 mr-0.5 -mt-0.5" />}
                            {s.source === "ai" && <Sparkles className="inline w-3 h-3 mr-0.5 -mt-0.5" />}
                            {s.value}
                          </button>
                        ))}
                        {canCreate && (
                          <button
                            type="button"
                            className={chipCls(cur === CREATE, "create")}
                            onClick={() => setFlavorChoice((p) => ({ ...p, [f.key]: CREATE }))}
                          >
                            + Create “{f.flavor}”
                          </button>
                        )}
                        <button
                          type="button"
                          className={chipCls(cur === SKIP, "skip")}
                          onClick={() => setFlavorChoice((p) => ({ ...p, [f.key]: SKIP }))}
                        >
                          Skip
                        </button>
                      </div>
                      {(brandFlavors[f.brandName]?.length ?? 0) > 0 && (
                        <select
                          className="mt-2 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground"
                          value={
                            (brandFlavors[f.brandName] ?? []).includes(cur) ? cur : ""
                          }
                          onChange={(e) =>
                            setFlavorChoice((p) => ({ ...p, [f.key]: e.target.value }))
                          }
                        >
                          <option value="">Or link to an existing flavor…</option>
                          {(brandFlavors[f.brandName] ?? []).map((fl) => (
                            <option key={fl} value={fl}>
                              {fl}
                            </option>
                          ))}
                        </select>
                      )}
                      {aiFlavorReview[f.key] && cur === aiFlavorMatch[f.key] && (
                        <ReviewBadge review={aiFlavorReview[f.key]} className="mt-2" />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {!canCreate && (uniqueBrands.length > 0 || uniqueFlavors.length > 0) && (
            <p className="text-xs text-muted-foreground">
              Switch to Supervisor to create new brands or flavors.
            </p>
          )}

          {uniqueBrands.length === 0 && uniqueFlavors.length === 0 && (
            <p className="text-sm text-muted-foreground">All brands &amp; flavors matched existing entries.</p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-border">
          <span className="text-sm text-muted-foreground">
            {progress
              ? `Importing day ${progress.done} of ${progress.total}…`
              : multiDay
                ? `${willImport} run${willImport === 1 ? "" : "s"} across ${dayCount} day${dayCount === 1 ? "" : "s"}`
                : `${willImport} run${willImport === 1 ? "" : "s"} → schedule${skipped > 0 ? `, ${skipped} skipped` : ""}`}
          </span>
          <button
            type="button"
            disabled={willImport === 0 || !dateValid || !!progress}
            onClick={handleConfirm}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
          >
            {progress ? "Importing…" : `Import ${willImport > 0 ? willImport : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
