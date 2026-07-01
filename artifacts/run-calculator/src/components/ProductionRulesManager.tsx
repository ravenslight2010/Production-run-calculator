import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertTriangle,
  Plus,
  Trash2,
  ShieldAlert,
  ShieldCheck,
  ArrowUp,
  ArrowDown,
  ListChecks,
  Filter,
} from "lucide-react";
import {
  newRule,
  defaultRuleName,
  ruleFieldDef,
  RULE_FIELDS,
  RULE_ATTRIBUTES,
  ruleAttributeDef,
  type ProductionRule,
  type RuleBypassCondition,
  type RuleType,
} from "@workspace/production-rules";
import { useProductionRules } from "../hooks/useProductionRules";
import { saveProductionRules, deleteProductionRules } from "../productionRules";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";

const TYPE_LABELS: Record<RuleType, string> = {
  "required-field": "Required field",
  "numeric-range": "Numeric range",
  sequence: "Sequence (allergen-style)",
};

const TYPE_HINTS: Record<RuleType, string> = {
  "required-field": "Warn or block if a run field is left blank.",
  "numeric-range": "Warn or block if a number falls outside a range.",
  sequence: "Warn or block a disallowed run-to-run transition.",
};

function genId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Manager-only editor for factory-wide production rules. Rules are persisted
// server-side (shared across all signed-in users) and evaluated on the Run tab —
// "flexible" rules warn inline, "strict" rules block starting a run. The server
// enforces the manager role on writes; this card is only rendered for managers.
export default function ProductionRulesManager() {
  const qc = useQueryClient();
  const { rules, isLoading } = useProductionRules();
  const [addType, setAddType] = useState<RuleType>("required-field");
  const [error, setError] = useState<string | null>(null);

  const numberFields = useMemo(() => RULE_FIELDS.filter((f) => f.kind === "number"), []);

  const saveMutation = useMutation({
    mutationFn: (next: ProductionRule[]) => saveProductionRules(next),
    onSuccess: (saved) => {
      qc.setQueryData(["productionRules"], saved);
      setError(null);
    },
    onError: () => setError("Could not save the rule. Check your connection and try again."),
  });

  const deleteMutation = useMutation({
    mutationFn: (ids: string[]) => deleteProductionRules(ids),
    onSuccess: (saved) => {
      qc.setQueryData(["productionRules"], saved);
      setError(null);
    },
    onError: () => setError("Could not delete the rule. Check your connection and try again."),
  });

  const busy = saveMutation.isPending || deleteMutation.isPending;

  function upsert(rule: ProductionRule) {
    saveMutation.mutate([rule]);
  }

  function addRule() {
    upsert(newRule(genId(), addType));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="w-4 h-4" />
          Production Rules
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Factory-wide checks on each run. <span className="font-semibold text-amber-400">Flexible</span> rules
          warn the operator; <span className="font-semibold text-red-400">Strict</span> rules block starting the run
          until fixed.
        </p>

        {error && (
          <div className="flex items-start gap-2 px-2.5 py-1.5 rounded-md text-xs border bg-red-950/40 border-red-700/40 text-red-300">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {isLoading ? (
          <p className="text-xs text-muted-foreground">Loading rules…</p>
        ) : rules.length === 0 ? (
          <p className="text-xs text-muted-foreground">No rules yet. Add one below.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {rules.map((rule) => (
              <RuleEditor
                key={rule.id}
                rule={rule}
                disabled={busy}
                onChange={upsert}
                onDelete={() => deleteMutation.mutate([rule.id])}
                numberFieldKeys={numberFields.map((f) => f.key)}
              />
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 pt-1 border-t border-border/40">
          <select
            value={addType}
            onChange={(e) => setAddType(e.target.value as RuleType)}
            disabled={busy}
            className="rounded-md border border-input bg-background px-2 py-1 text-xs"
          >
            {(Object.keys(TYPE_LABELS) as RuleType[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={addRule}
            disabled={busy}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" /> Add rule
          </button>
          <span className="text-[11px] text-muted-foreground">{TYPE_HINTS[addType]}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function RuleEditor({
  rule,
  disabled,
  onChange,
  onDelete,
  numberFieldKeys,
}: {
  rule: ProductionRule;
  disabled: boolean;
  onChange: (rule: ProductionRule) => void;
  onDelete: () => void;
  numberFieldKeys: string[];
}) {
  const attr = ruleAttributeDef(rule.attribute) ?? RULE_ATTRIBUTES[0];

  function patch(p: Partial<ProductionRule>) {
    onChange({ ...rule, ...p });
  }

  return (
    <div className="rounded-md border border-border/60 bg-muted/20 p-2.5 space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={rule.name}
          placeholder={defaultRuleName(rule.type)}
          onChange={(e) => patch({ name: e.target.value })}
          disabled={disabled}
          className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs font-semibold"
        />
        <button
          type="button"
          onClick={() =>
            patch({ enforcement: rule.enforcement === "strict" ? "flexible" : "strict" })
          }
          disabled={disabled}
          title="Toggle flexible (warn) / strict (block)"
          className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold border ${
            rule.enforcement === "strict"
              ? "bg-red-950/40 border-red-700/40 text-red-300"
              : "bg-amber-950/30 border-amber-700/40 text-amber-300"
          }`}
        >
          {rule.enforcement === "strict" ? (
            <>
              <ShieldAlert className="w-3.5 h-3.5" /> Strict
            </>
          ) : (
            <>
              <ShieldCheck className="w-3.5 h-3.5" /> Flexible
            </>
          )}
        </button>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={rule.enabled}
            onChange={(e) => patch({ enabled: e.target.checked })}
            disabled={disabled}
          />
          On
        </label>
        <ConfirmDeleteButton
          onConfirm={onDelete}
          title="Delete this rule?"
          description="This removes the production rule for everyone. This can't be undone."
        >
          <button
            type="button"
            disabled={disabled}
            title="Delete rule"
            className="p-1 rounded-md text-red-400 hover:bg-red-950/40 disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </ConfirmDeleteButton>
      </div>

      {rule.type === "required-field" && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Field must be set:</span>
          <select
            value={rule.field ?? ""}
            onChange={(e) => patch({ field: e.target.value })}
            disabled={disabled}
            className="rounded-md border border-input bg-background px-2 py-1 text-xs"
          >
            {RULE_FIELDS.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {rule.type === "numeric-range" && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            value={numberFieldKeys.includes(rule.field ?? "") ? rule.field : numberFieldKeys[0]}
            onChange={(e) => patch({ field: e.target.value })}
            disabled={disabled}
            className="rounded-md border border-input bg-background px-2 py-1 text-xs"
          >
            {RULE_FIELDS.filter((f) => numberFieldKeys.includes(f.key)).map((f) => (
              <option key={f.key} value={f.key}>
                {ruleFieldDef(f.key)?.label}
              </option>
            ))}
          </select>
          <span className="text-muted-foreground">min</span>
          <input
            type="number"
            value={rule.min ?? ""}
            onChange={(e) => patch({ min: e.target.value === "" ? null : Number(e.target.value) })}
            disabled={disabled}
            className="w-20 rounded-md border border-input bg-background px-2 py-1 text-xs font-mono"
          />
          <span className="text-muted-foreground">max</span>
          <input
            type="number"
            value={rule.max ?? ""}
            onChange={(e) => patch({ max: e.target.value === "" ? null : Number(e.target.value) })}
            disabled={disabled}
            className="w-20 rounded-md border border-input bg-background px-2 py-1 text-xs font-mono"
          />
        </div>
      )}

      {rule.type === "sequence" && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">{attr.label}: don't run</span>
          <select
            value={rule.after ?? attr.values[0].value}
            onChange={(e) => patch({ after: e.target.value })}
            disabled={disabled}
            className="rounded-md border border-input bg-background px-2 py-1 text-xs"
          >
            {attr.values.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </select>
          <span className="text-muted-foreground">right after</span>
          <select
            value={rule.before ?? attr.values[0].value}
            onChange={(e) => patch({ before: e.target.value })}
            disabled={disabled}
            className="rounded-md border border-input bg-background px-2 py-1 text-xs"
          >
            {attr.values.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <RuleExceptionsEditor rule={rule} disabled={disabled} patch={patch} />
    </div>
  );
}

// Manager-defined exceptions shared by every rule type: bypass conditions (run
// matches field=value -> rule waived entirely) and a required checklist (operator
// must acknowledge each step per-run before a strict block clears).
export function RuleExceptionsEditor({
  rule,
  disabled,
  patch,
}: {
  rule: ProductionRule;
  disabled: boolean;
  patch: (p: Partial<ProductionRule>) => void;
}) {
  // Exception rows are edited in LOCAL state, seeded once from the rule. A new
  // bypass/checklist row starts empty, but the server normalize drops empty
  // entries on every save round-trip — if we re-derived these lists from that
  // round-trip the freshly-added row would vanish instantly ("nothing happens").
  // Keeping them local lets the manager build a row up before it has a value;
  // empties are simply never persisted.
  const [bypass, setBypassState] = useState<RuleBypassCondition[]>(rule.bypass ?? []);
  const [checklist, setChecklistState] = useState<string[]>(rule.checklist ?? []);

  // Persist both exception lists together from local state so a change to one
  // never ships a stale copy of the other.
  function commit(nextBypass: RuleBypassCondition[], nextChecklist: string[]) {
    setBypassState(nextBypass);
    setChecklistState(nextChecklist);
    patch({
      bypass: nextBypass.length > 0 ? nextBypass : undefined,
      checklist: nextChecklist.length > 0 ? nextChecklist : undefined,
    });
  }

  function addBypass() {
    commit([...bypass, { field: RULE_FIELDS[0].key, value: "" }], checklist);
  }
  function patchBypass(i: number, p: Partial<RuleBypassCondition>) {
    commit(bypass.map((c, idx) => (idx === i ? { ...c, ...p } : c)), checklist);
  }
  function removeBypass(i: number) {
    commit(bypass.filter((_, idx) => idx !== i), checklist);
  }

  function addStep() {
    commit(bypass, [...checklist, ""]);
  }
  function patchStep(i: number, value: string) {
    commit(bypass, checklist.map((s, idx) => (idx === i ? value : s)));
  }
  function removeStep(i: number) {
    commit(bypass, checklist.filter((_, idx) => idx !== i));
  }
  function moveStep(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= checklist.length) return;
    const next = [...checklist];
    [next[i], next[j]] = [next[j], next[i]];
    commit(bypass, next);
  }

  return (
    <div className="space-y-2 pt-2 mt-1 border-t border-border/40">
      {/* Bypass conditions */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
          <Filter className="w-3 h-3" /> Skip this rule when…
        </div>
        {bypass.map((cond, i) => (
          <div key={i} className="flex items-center gap-1.5 text-xs">
            <select
              value={ruleFieldDef(cond.field) ? cond.field : RULE_FIELDS[0].key}
              onChange={(e) => patchBypass(i, { field: e.target.value })}
              disabled={disabled}
              className="rounded-md border border-input bg-background px-2 py-1 text-xs"
            >
              {RULE_FIELDS.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
            <span className="text-muted-foreground">=</span>
            <input
              type="text"
              value={cond.value}
              placeholder="value"
              onChange={(e) => patchBypass(i, { value: e.target.value })}
              disabled={disabled}
              className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs"
            />
            <button
              type="button"
              onClick={() => removeBypass(i)}
              disabled={disabled}
              title="Remove condition"
              className="p-1 rounded-md text-red-400 hover:bg-red-950/40 disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addBypass}
          disabled={disabled}
          className="flex items-center gap-1 text-[11px] text-primary hover:underline disabled:opacity-50"
        >
          <Plus className="w-3 h-3" /> Add bypass condition
        </button>
      </div>

      {/* Required checklist */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
          <ListChecks className="w-3 h-3" /> Require checklist before Start
        </div>
        {checklist.map((step, i) => (
          <div key={i} className="flex items-center gap-1.5 text-xs">
            <span className="text-[11px] text-muted-foreground w-4 text-right">{i + 1}.</span>
            <input
              type="text"
              value={step}
              placeholder="step description"
              onChange={(e) => patchStep(i, e.target.value)}
              disabled={disabled}
              className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs"
            />
            <button
              type="button"
              onClick={() => moveStep(i, -1)}
              disabled={disabled || i === 0}
              title="Move up"
              className="p-1 rounded-md text-muted-foreground hover:bg-muted disabled:opacity-30"
            >
              <ArrowUp className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => moveStep(i, 1)}
              disabled={disabled || i === checklist.length - 1}
              title="Move down"
              className="p-1 rounded-md text-muted-foreground hover:bg-muted disabled:opacity-30"
            >
              <ArrowDown className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => removeStep(i)}
              disabled={disabled}
              title="Remove step"
              className="p-1 rounded-md text-red-400 hover:bg-red-950/40 disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addStep}
          disabled={disabled}
          className="flex items-center gap-1 text-[11px] text-primary hover:underline disabled:opacity-50"
        >
          <Plus className="w-3 h-3" /> Add checklist step
        </button>
      </div>
    </div>
  );
}
