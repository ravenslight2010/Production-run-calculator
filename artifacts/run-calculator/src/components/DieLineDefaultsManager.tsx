// Manage Lists → Die Defaults — manager editor for per-die line-setting
// defaults. Each die type gets the five pre-fill values (crusts/cycle, cycle
// speed, speed adjustment, freezer time, extra case buffer). Saving stores a
// factory-wide override on the server; "Reset" removes it so the die falls
// back to the app's built-in defaults (7"/11"/12"/Argus map). Values are
// blank-fill pre-fills only — changing them never rewrites existing runs.

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, Save } from "lucide-react";
import {
  dieDefaultsKey,
  dieLineDefaultsFor,
  type DieLineDefaults,
} from "../dieDefaults";
import {
  saveDieLineDefaults,
  deleteDieLineDefaults,
  type DieLineDefaultsEntry,
} from "../dieLineDefaultsServer";
import { DIE_LINE_DEFAULTS_QUERY_KEY, useDieLineDefaults } from "../hooks/useDieLineDefaults";

const FIELDS: { key: keyof DieLineDefaults; label: string; step: string; optional?: boolean }[] = [
  { key: "crustsPerCycle", label: "Crusts / Cycle", step: "1" },
  { key: "cycleSpeed", label: "Cycle Speed", step: "0.1" },
  { key: "speedAdjustment", label: "Speed Adjustment", step: "0.05" },
  { key: "freezerTime", label: "Freezer Time (min)", step: "1" },
  { key: "casesPerLayer", label: "Extra Case Buffer", step: "1" },
  { key: "preTunnelMin", label: "Pre-tunnel (min)", step: "0.5", optional: true },
  { key: "postTunnelMin", label: "Post-tunnel (min)", step: "0.5", optional: true },
];

type Draft = Record<keyof DieLineDefaults, string>;

function toDraft(v: DieLineDefaults | null): Draft {
  return {
    crustsPerCycle: v ? String(v.crustsPerCycle) : "",
    cycleSpeed: v ? String(v.cycleSpeed) : "",
    speedAdjustment: v ? String(v.speedAdjustment) : "",
    freezerTime: v ? String(v.freezerTime) : "",
    casesPerLayer: v ? String(v.casesPerLayer) : "",
    // Optional tunnel fields: blank string means "leave at built-in default".
    preTunnelMin: v?.preTunnelMin != null ? String(v.preTunnelMin) : "",
    postTunnelMin: v?.postTunnelMin != null ? String(v.postTunnelMin) : "",
  };
}

export default function DieLineDefaultsManager({ dieTypes }: { dieTypes: string[] }) {
  const qc = useQueryClient();
  const { entries, overrides, isLoading } = useDieLineDefaults();
  // Per-die unsaved edits, keyed by canonical die name.
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [message, setMessage] = useState("");

  // Every die the factory knows about, plus any stored override whose die was
  // since removed from the Die Types list (still shown so it can be reset).
  const dies = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const name of [...dieTypes, ...entries.map((e) => e.name)]) {
      const k = dieDefaultsKey(name);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(name.trim());
    }
    return out.sort((a, b) => a.localeCompare(b));
  }, [dieTypes, entries]);

  const saveMutation = useMutation({
    mutationFn: (entry: DieLineDefaultsEntry) => saveDieLineDefaults([entry]),
    onSuccess: (_data, entry) => {
      qc.invalidateQueries({ queryKey: DIE_LINE_DEFAULTS_QUERY_KEY });
      setDrafts((d) => {
        const next = { ...d };
        delete next[dieDefaultsKey(entry.name)];
        return next;
      });
      setMessage(`Saved defaults for ${entry.name}.`);
    },
    onError: () => setMessage("Couldn't save — try again."),
  });

  const resetMutation = useMutation({
    mutationFn: (name: string) => deleteDieLineDefaults([name]),
    onSuccess: (_data, name) => {
      qc.invalidateQueries({ queryKey: DIE_LINE_DEFAULTS_QUERY_KEY });
      setDrafts((d) => {
        const next = { ...d };
        delete next[dieDefaultsKey(name)];
        return next;
      });
      setMessage(`Reset ${name} to the built-in defaults.`);
    },
    onError: () => setMessage("Couldn't reset — try again."),
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading die defaults…</p>;
  }

  return (
    <div className="space-y-3" data-testid="die-line-defaults-manager">
      <p className="text-xs text-muted-foreground">
        These numbers pre-fill the line settings when a die is picked on the run
        form or setup editor (blank fields only — nothing already typed is ever
        overwritten). Dies without saved values use the built-in defaults.
      </p>
      {message && <p className="text-xs text-primary font-medium">{message}</p>}
      {dies.length === 0 && (
        <p className="text-sm text-muted-foreground">No die types yet — add them under Die Types first.</p>
      )}
      {dies.map((die) => {
        const key = dieDefaultsKey(die);
        const stored = overrides[key] ?? null;
        const builtin = dieLineDefaultsFor(die);
        const base = stored ?? builtin;
        const draft = drafts[key] ?? toDraft(base);
        const dirty = key in drafts;
        const busy = saveMutation.isPending || resetMutation.isPending;
        const parsed: Partial<DieLineDefaults> = {};
        let valid = true;
        for (const f of FIELDS) {
          const raw = draft[f.key]?.trim() ?? "";
          if (raw === "") {
            // Optional fields may be left blank (blank → use built-in default).
            if (!f.optional) valid = false;
            // Leave the field absent from parsed so the server omits it.
          } else {
            const n = Number(raw);
            // Optional tunnel fields must be strictly positive (0 is not a valid
            // dwell time and the server drops ≤0 values; treat 0 the same as blank).
            if (!Number.isFinite(n) || n < 0 || (f.optional && n === 0)) valid = false;
            else parsed[f.key] = n;
          }
        }
        return (
          <div key={key} className="rounded-lg border border-border/50 bg-card/50 px-3 py-2.5 space-y-2" data-testid={`die-defaults-row-${key}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">{die}</span>
              <span className="text-[11px] text-muted-foreground">
                {stored ? "Custom (saved)" : builtin ? "Built-in defaults" : "No defaults yet"}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
              {FIELDS.map((f) => (
                <label key={f.key} className="space-y-0.5">
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {f.label}{f.optional && <span className="normal-case font-normal ml-0.5">(opt)</span>}
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={f.step}
                    value={draft[f.key]}
                    placeholder={f.optional ? "built-in" : undefined}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [key]: { ...(d[key] ?? toDraft(base)), [f.key]: e.target.value } }))
                    }
                    className="w-full border border-input rounded-md px-2 py-1.5 text-sm bg-background/50 focus:outline-none focus:ring-1 focus:ring-ring"
                    data-testid={`die-defaults-${key}-${f.key}`}
                  />
                </label>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy || !valid || (!dirty && !!stored)}
                onClick={() => saveMutation.mutate({ name: die, ...(parsed as DieLineDefaults) })}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-50"
                data-testid={`die-defaults-save-${key}`}
              >
                <Save className="w-3 h-3" /> Save
              </button>
              {(stored || dirty) && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (stored) resetMutation.mutate(die);
                    else setDrafts((d) => { const n = { ...d }; delete n[key]; return n; });
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-xs font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50"
                  data-testid={`die-defaults-reset-${key}`}
                >
                  <RotateCcw className="w-3 h-3" /> {stored ? "Reset to built-in" : "Discard changes"}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
