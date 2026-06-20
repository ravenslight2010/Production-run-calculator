import { useEffect, useMemo, useRef, useState } from "react";
import { X, Upload, Sparkles } from "lucide-react";
import { exactMatch, fuzzyMatch, mergeImportRuns, type ImportParseResult } from "@/utils/runExcel";
import { requestMatchImport } from "@/matchImport";

const SKIP = "";
const CREATE = "__create__";

export type ImportCommit = {
  date: string;
  runs: { brand: string; flavor: string; casesPlanned: number; notes: string }[];
  createBrands: string[];
  createFlavors: { brand: string; flavor: string }[];
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
}: Props) {
  const [date, setDate] = useState(defaultDate);
  const [brandChoice, setBrandChoice] = useState<Record<string, string>>({});
  const [flavorChoice, setFlavorChoice] = useState<Record<string, string>>({});
  // AI-suggested matches for names that did not exactly match (best-effort; the
  // dialog still works without them via the Levenshtein fuzzy chips).
  const [aiBrandMatch, setAiBrandMatch] = useState<Record<string, string>>({});
  const [aiFlavorMatch, setAiFlavorMatch] = useState<Record<string, string>>({});
  const [aiLoading, setAiLoading] = useState(false);
  // Candidate keys already sent to the AI, so the brand->flavor cascade does not
  // refetch the same names repeatedly.
  const aiRequestedBrands = useRef<Set<string>>(new Set());
  const aiRequestedFlavors = useRef<Set<string>>(new Set());

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
    setAiLoading(false);
  }, [result]);

  // Ask the AI to match still-unmatched brand/flavor names against the saved
  // ones. Runs again as brands resolve (exposing more flavors); a per-candidate
  // ref guard prevents refetching the same names. Best-effort: any failure
  // (offline, not a manager, rate-limited) is swallowed and the user falls back
  // to the fuzzy chips.
  useEffect(() => {
    if (!result) return;
    const newBrands: string[] = [];
    const seenB = new Set<string>();
    for (const r of result.rows) {
      const k = r.brand.toLowerCase();
      if (seenB.has(k)) continue;
      seenB.add(k);
      if (exactMatch(r.brand, brands)) continue;
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
        }
        if (r.flavorMatches.length) {
          setAiFlavorMatch((p) => {
            const next = { ...p };
            for (const m of r.flavorMatches) {
              next[`${m.brand.toLowerCase()}|||${m.candidate.toLowerCase()}`] = m.match;
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
  }, [result, brandChoice, brands, brandFlavors, resolveBrandName]);

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
    const out: ImportCommit["runs"] = [];
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
      out.push({ brand: brandName, flavor: flavorName, casesPlanned: r.casesPlanned, notes: r.notes });
    }
    return {
      date: date.trim(),
      runs: mergeImportRuns(out),
      createBrands: [...createBrands],
      createFlavors: [...createFlavors.values()],
    };
  }

  const preview = buildCommit();
  const willImport = preview.runs.length;
  const skipped = rows.length - willImport;
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(date.trim());

  if (!open) return null;

  const chipCls = (active: boolean, tone: "default" | "create" | "skip" | "ai") => {
    const base = "text-xs px-2.5 py-1 rounded-full border transition-colors";
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

  // Merge the AI-suggested value into the fuzzy chip list (dedup, AI first) and
  // flag which value is the AI pick so it can be tinted differently.
  const chipValues = (
    aiVal: string | undefined,
    fuzzy: { value: string }[],
  ): { value: string; ai: boolean }[] => {
    const seen = new Set<string>();
    const out: { value: string; ai: boolean }[] = [];
    if (aiVal) {
      out.push({ value: aiVal, ai: true });
      seen.add(aiVal.toLowerCase());
    }
    for (const s of fuzzy) {
      if (seen.has(s.value.toLowerCase())) continue;
      seen.add(s.value.toLowerCase());
      out.push({ value: s.value, ai: false });
    }
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

          {errors.length > 0 && (
            <div className="rounded-md border border-destructive/60 p-3">
              <p className="text-sm font-semibold text-destructive mb-1">
                {errors.length} row{errors.length === 1 ? "" : "s"} skipped
              </p>
              {errors.slice(0, 6).map((e, i) => (
                <p key={i} className="text-xs text-muted-foreground">
                  Row {e.rowNumber}: {e.message}
                </p>
              ))}
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
                  const sugg = chipValues(aiBrandMatch[key], fuzzyMatch(cand, brands));
                  return (
                    <div key={key} className="rounded-md border border-border p-2.5">
                      <p className="text-sm font-medium text-foreground mb-2">“{cand}”</p>
                      <div className="flex flex-wrap gap-1.5">
                        {sugg.map((s) => (
                          <button
                            key={s.value}
                            type="button"
                            className={chipCls(cur === s.value, s.ai ? "ai" : "default")}
                            onClick={() => setBrandChoice((p) => ({ ...p, [key]: s.value }))}
                          >
                            {s.ai && <Sparkles className="inline w-3 h-3 mr-0.5 -mt-0.5" />}
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
                            className={chipCls(cur === s.value, s.ai ? "ai" : "default")}
                            onClick={() => setFlavorChoice((p) => ({ ...p, [f.key]: s.value }))}
                          >
                            {s.ai && <Sparkles className="inline w-3 h-3 mr-0.5 -mt-0.5" />}
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
            {willImport} run{willImport === 1 ? "" : "s"} → schedule
            {skipped > 0 ? `, ${skipped} skipped` : ""}
          </span>
          <button
            type="button"
            disabled={willImport === 0 || !dateValid}
            onClick={() => onConfirm(buildCommit())}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
          >
            Import {willImport > 0 ? willImport : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
