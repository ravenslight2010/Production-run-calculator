import { useEffect, useMemo, useState } from "react";
import { X, Upload } from "lucide-react";
import { exactMatch, fuzzyMatch, type ImportParseResult } from "@/utils/runExcel";

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
      runs: out,
      createBrands: [...createBrands],
      createFlavors: [...createFlavors.values()],
    };
  }

  const preview = buildCommit();
  const willImport = preview.runs.length;
  const skipped = rows.length - willImport;
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(date.trim());

  if (!open) return null;

  const chipCls = (active: boolean, tone: "default" | "create" | "skip") => {
    const base = "text-xs px-2.5 py-1 rounded-full border transition-colors";
    if (!active) return `${base} border-border text-muted-foreground hover:bg-muted/50`;
    if (tone === "create") return `${base} border-green-500 bg-green-500/15 text-green-600`;
    if (tone === "skip") return `${base} border-destructive bg-destructive/15 text-destructive`;
    return `${base} border-primary bg-primary/15 text-primary`;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
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

          {uniqueBrands.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-foreground mb-2">Map Brands</p>
              <div className="space-y-2">
                {uniqueBrands.map((cand) => {
                  const key = cand.toLowerCase();
                  const cur = brandChoice[key] ?? SKIP;
                  const sugg = fuzzyMatch(cand, brands);
                  return (
                    <div key={key} className="rounded-md border border-border p-2.5">
                      <p className="text-sm font-medium text-foreground mb-2">“{cand}”</p>
                      <div className="flex flex-wrap gap-1.5">
                        {sugg.map((s) => (
                          <button
                            key={s.value}
                            type="button"
                            className={chipCls(cur === s.value, "default")}
                            onClick={() => setBrandChoice((p) => ({ ...p, [key]: s.value }))}
                          >
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
                  const sugg = fuzzyMatch(f.flavor, brandFlavors[f.brandName] ?? []);
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
                            className={chipCls(cur === s.value, "default")}
                            onClick={() => setFlavorChoice((p) => ({ ...p, [f.key]: s.value }))}
                          >
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
