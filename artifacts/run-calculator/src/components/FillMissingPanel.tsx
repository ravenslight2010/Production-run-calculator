import { useEffect, useState } from "react";
import {
  ClipboardList,
  Loader2,
  Sparkles,
  Check,
  AlertTriangle,
  Lock,
  SkipForward,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type FieldProposal,
  type ProposalSource,
  type FieldCategory,
  type LearnedValueRow,
  detectMissingFields,
  buildProposals,
  aiCandidates,
  buildFillMissingInput,
  requestFillMissing,
  fillMissingErrorMessage,
  makeWebLookup,
  fetchFillMissingValues,
  saveFillMissingValues,
} from "../fillMissing";
import type { ReviewVerdict } from "@workspace/ai-review";
import ReviewBadge from "./ReviewBadge";
import { useMe } from "../useRole";

// AI suggestions may carry an advisory reviewer verdict; the shared lib's
// FieldProposal doesn't, so widen it locally for display.
type ReviewedProposal = FieldProposal & { review?: ReviewVerdict };

const CATEGORY_LABEL: Record<FieldCategory, string> = {
  identity: "Run Identity",
  line: "Line & Speed",
  packaging: "Packaging",
  sauce: "Sauce",
  applicator: "Applicators",
  pepperoni: "Pepperoni",
  dough: "Dough Supply",
};
const CATEGORY_ORDER: FieldCategory[] = [
  "identity",
  "line",
  "packaging",
  "sauce",
  "applicator",
  "pepperoni",
  "dough",
];

const SOURCE_META: Record<ProposalSource, { label: string; cls: string }> = {
  learned: { label: "Remembered", cls: "bg-amber-500/15 text-amber-300 border-amber-500/40" },
  profile: { label: "From profile", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  spec: { label: "From spec sheet", cls: "bg-sky-500/15 text-sky-400 border-sky-500/30" },
  default: { label: "Default", cls: "bg-slate-500/15 text-slate-300 border-slate-500/30" },
  ai: { label: "AI suggestion", cls: "bg-violet-500/15 text-violet-300 border-violet-500/30" },
  none: { label: "No suggestion", cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
};

type RowState = {
  draft: string;
  applied: boolean;
  skipped: boolean;
};

export default function FillMissingPanel({
  getRecord,
  brand,
  flavor,
  dieType,
  canEdit,
  onCommit,
}: {
  getRecord: () => Record<string, unknown>;
  brand: string;
  flavor: string;
  dieType: string;
  canEdit: boolean;
  onCommit: (key: string, value: string | number) => void;
}) {
  const { isManager } = useMe();
  const [proposals, setProposals] = useState<ReviewedProposal[] | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  // Server-persisted learned values (factory-wide). Fetched once on mount;
  // best-effort, so any failure just leaves the list empty.
  const [learnedValues, setLearnedValues] = useState<LearnedValueRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchFillMissingValues()
      .then((vals) => {
        if (!cancelled) setLearnedValues(vals);
      })
      .catch(() => {
        /* best-effort: proceed without learned values */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function scan() {
    const rec = getRecord();
    const missing = detectMissingFields(rec);
    const props = buildProposals(missing, makeWebLookup(brand, flavor, learnedValues));
    setProposals(props);
    setAiError(null);
    setAiNote(null);
    const next: Record<string, RowState> = {};
    for (const p of props) {
      next[p.key] = { draft: p.value == null ? "" : String(p.value), applied: false, skipped: false };
    }
    setRows(next);
  }

  async function getAiSuggestions() {
    if (!proposals) return;
    const candidates = aiCandidates(proposals);
    if (candidates.length === 0) return;
    setAiLoading(true);
    setAiError(null);
    setAiNote(null);
    try {
      const input = buildFillMissingInput(brand, flavor, dieType, candidates, getRecord());
      const res = await requestFillMissing(input);
      const byKey = new Map(res.suggestions.map((s) => [s.key, s]));
      setProposals((prev) =>
        (prev ?? []).map((p) => {
          const s = byKey.get(p.key);
          if (!s || p.source !== "none") return p;
          return { ...p, value: s.value, source: "ai", rationale: s.rationale, review: s.review };
        }),
      );
      setRows((prev) => {
        const next = { ...prev };
        for (const [key, s] of byKey) {
          if (next[key] && !next[key].applied && !next[key].skipped) {
            next[key] = { ...next[key], draft: s.value };
          }
        }
        return next;
      });
      if (res.note) setAiNote(res.note);
    } catch (e) {
      setAiError(fillMissingErrorMessage(e));
    } finally {
      setAiLoading(false);
    }
  }

  function apply(p: FieldProposal) {
    const row = rows[p.key];
    if (!row) return;
    const raw = row.draft.trim();
    if (raw === "") return;
    const value = p.kind === "number" ? Number(raw) : raw;
    if (p.kind === "number" && (!Number.isFinite(value as number) || (value as number) < 0)) return;
    onCommit(p.key, value);
    setRows((prev) => ({ ...prev, [p.key]: { ...prev[p.key], applied: true, skipped: false } }));
    // Remember this confirmed value factory-wide so future scans of the same
    // product propose it as a "learned" source. Needs a product key (brand +
    // flavor); best-effort, so failures are swallowed.
    if (brand.trim() && flavor.trim()) {
      const learnedRow: LearnedValueRow = {
        brand: brand.trim(),
        flavor: flavor.trim(),
        fieldKey: p.key,
        value: String(value),
      };
      setLearnedValues((prev) => {
        const others = prev.filter(
          (v) =>
            !(
              v.fieldKey === learnedRow.fieldKey &&
              v.brand.trim().toLowerCase() === learnedRow.brand.toLowerCase() &&
              v.flavor.trim().toLowerCase() === learnedRow.flavor.toLowerCase()
            ),
        );
        return [...others, learnedRow];
      });
      void saveFillMissingValues([learnedRow]).catch(() => {
        /* best-effort */
      });
    }
  }

  function skip(key: string) {
    setRows((prev) => ({ ...prev, [key]: { ...prev[key], skipped: true } }));
  }

  const pending = (proposals ?? []).filter((p) => {
    const r = rows[p.key];
    return r && !r.applied && !r.skipped;
  });
  const hasAiCandidates = (proposals ?? []).some(
    (p) => p.source === "none" && p.fillable && !rows[p.key]?.applied && !rows[p.key]?.skipped,
  );

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardList className="w-4 h-4 text-primary" />
          Fill in Missing Data
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Find blank fields this run needs and propose values from your profile, the spec sheet,
          documented defaults, or AI. Nothing is applied until you confirm each one.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={scan} size="sm" variant="secondary" className="gap-2" data-testid="button-scan-missing">
            <ClipboardList className="w-4 h-4" />
            {proposals ? "Re-scan" : "Scan for missing data"}
          </Button>
          {proposals && hasAiCandidates && isManager && (
            <Button
              onClick={getAiSuggestions}
              size="sm"
              className="gap-2"
              disabled={aiLoading}
              data-testid="button-ai-suggestions"
            >
              {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {aiLoading ? "Asking AI…" : "Get AI suggestions"}
            </Button>
          )}
          {proposals && hasAiCandidates && !isManager && (
            <span className="text-[11px] text-muted-foreground">
              AI suggestions require a manager.
            </span>
          )}
        </div>

        {aiError && (
          <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
            <AlertTriangle className="mt-0.5 w-3.5 h-3.5 shrink-0" />
            <span>{aiError}</span>
          </div>
        )}
        {aiNote && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
            {aiNote}
          </div>
        )}

        {proposals && pending.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Check className="w-6 h-6 text-emerald-400" />
            <p className="text-sm font-semibold text-foreground">Nothing left to fill</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Every required field for this run has a value.
            </p>
          </div>
        )}

        {proposals &&
          CATEGORY_ORDER.map((cat) => {
            const inCat = pending.filter((p) => p.category === cat);
            if (inCat.length === 0) return null;
            return (
              <div key={cat} className="space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  {CATEGORY_LABEL[cat]}
                </p>
                {inCat.map((p) => {
                  const row = rows[p.key];
                  const meta = SOURCE_META[p.source];
                  return (
                    <div key={p.key} className="rounded-lg border border-border bg-card/60 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold text-foreground">{p.label}</p>
                        <span
                          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${meta.cls}`}
                        >
                          {meta.label}
                        </span>
                      </div>
                      {p.rationale && (
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{p.rationale}</p>
                      )}
                      {p.source === "ai" && p.review && (
                        <div className="mt-1">
                          <ReviewBadge review={p.review} />
                        </div>
                      )}
                      {!p.fillable ? (
                        <p className="mt-2 text-[11px] text-amber-400">
                          Set this on the run itself before configuring — it can&apos;t be filled here.
                        </p>
                      ) : (
                        <div className="mt-2.5 flex flex-wrap items-center gap-2">
                          {p.options ? (
                            <select
                              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                              value={row?.draft ?? ""}
                              disabled={!canEdit}
                              onChange={(e) =>
                                setRows((prev) => ({ ...prev, [p.key]: { ...prev[p.key], draft: e.target.value } }))
                              }
                              data-testid={`select-fill-${p.key}`}
                            >
                              <option value="">—</option>
                              {p.options.map((o) => (
                                <option key={o} value={o}>
                                  {o}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <Input
                              className="h-8 w-32 text-xs"
                              type={p.kind === "number" ? "number" : "text"}
                              value={row?.draft ?? ""}
                              disabled={!canEdit}
                              placeholder={p.source === "none" ? "No suggestion" : ""}
                              onChange={(e) =>
                                setRows((prev) => ({ ...prev, [p.key]: { ...prev[p.key], draft: e.target.value } }))
                              }
                              data-testid={`input-fill-${p.key}`}
                            />
                          )}
                          <Button
                            size="sm"
                            className="h-8 gap-1.5 text-xs"
                            disabled={!canEdit || !(row?.draft ?? "").trim()}
                            onClick={() => apply(p)}
                            data-testid={`button-apply-${p.key}`}
                          >
                            <Check className="h-3.5 w-3.5" /> Apply
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 gap-1.5 text-xs"
                            onClick={() => skip(p.key)}
                            data-testid={`button-skip-${p.key}`}
                          >
                            <SkipForward className="h-3.5 w-3.5" /> Skip
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}

        {!canEdit && proposals && pending.length > 0 && (
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Lock className="w-3 h-3" /> Enter supervisor mode to apply values.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
