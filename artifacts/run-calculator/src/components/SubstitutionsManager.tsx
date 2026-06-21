import { useEffect, useState } from "react";
import { Replace, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type {
  IngredientSubstitution,
  SubstitutionAction,
} from "@workspace/inventory-math";

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Plain-language description of a single active substitution, shown in the list.
export function describeSubstitution(s: IngredientSubstitution): string {
  const amt = s.amount != null && s.amount > 0 ? ` (${s.amount} lbs)` : "";
  if (s.action === "remove") return `Remove ${s.ingredient}`;
  if (s.action === "add") return `Add ${s.substitute ?? ""}${amt} alongside ${s.ingredient}`;
  return `Swap ${s.ingredient} → ${s.substitute ?? ""}${amt}`;
}

const ACTIONS: { value: SubstitutionAction; label: string }[] = [
  { value: "swap", label: "Swap" },
  { value: "add", label: "Add" },
  { value: "remove", label: "Remove" },
];

// Floor-staff panel to overlay today's recipes with temporary substitutions when
// an ingredient is low/out. These never edit master data or the saved run
// recipes — they live in the synced day-state and revert at the daily reset.
export default function SubstitutionsManager({
  substitutions,
  ingredientOptions,
  onAdd,
  onRemove,
  onClearAll,
  prefillIngredient,
  onPrefillConsumed,
}: {
  substitutions: IngredientSubstitution[];
  ingredientOptions: string[];
  onAdd: (sub: IngredientSubstitution) => void;
  onRemove: (id: string) => void;
  onClearAll: () => void;
  prefillIngredient?: string | null;
  onPrefillConsumed?: () => void;
}) {
  const [ingredient, setIngredient] = useState("");
  const [action, setAction] = useState<SubstitutionAction>("swap");
  const [substitute, setSubstitute] = useState("");
  const [amount, setAmount] = useState("");

  useEffect(() => {
    if (prefillIngredient) {
      setIngredient(prefillIngredient);
      setAction("swap");
      setSubstitute("");
      setAmount("");
      onPrefillConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillIngredient]);

  const needsSubstitute = action !== "remove";
  const canAdd = ingredient.trim().length > 0 && (!needsSubstitute || substitute.trim().length > 0);

  function submit() {
    if (!canAdd) return;
    const amtNum = Number(amount);
    const sub: IngredientSubstitution = {
      id: genId(),
      ingredient: ingredient.trim(),
      action,
      ...(needsSubstitute ? { substitute: substitute.trim() } : {}),
      ...(needsSubstitute && amount.trim() !== "" && Number.isFinite(amtNum) && amtNum > 0
        ? { amount: amtNum }
        : {}),
    };
    onAdd(sub);
    setIngredient("");
    setSubstitute("");
    setAmount("");
    setAction("swap");
  }

  return (
    <Card className="bg-card/50 border-border/50 shadow-md">
      <CardHeader className="pb-2 pt-4 px-5">
        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Replace className="w-4 h-4" /> Temporary Substitutions
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        <p className="text-xs text-muted-foreground">
          Swap, add, or remove an ingredient for today only. Applies to every run that uses it and
          reverts automatically at the daily reset.
        </p>

        {/* Active list */}
        {substitutions.length > 0 && (
          <div className="space-y-1.5">
            {substitutions.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-amber-500/10 border border-amber-500/30 text-sm"
              >
                <span className="truncate text-amber-600 dark:text-amber-400">
                  {describeSubstitution(s)}
                </span>
                <button
                  type="button"
                  aria-label="Remove substitution"
                  onClick={() => onRemove(s.id)}
                  className="shrink-0 p-1 rounded hover:bg-amber-500/20 text-amber-600 dark:text-amber-400"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <div className="flex justify-end pt-0.5">
              <button
                type="button"
                onClick={onClearAll}
                className="text-xs font-semibold text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
              >
                Clear all
              </button>
            </div>
          </div>
        )}

        {/* Add form */}
        <datalist id="substitution-ingredient-options">
          {ingredientOptions.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        <div className="space-y-2">
          <div className="flex gap-2">
            {ACTIONS.map((a) => (
              <button
                key={a.value}
                type="button"
                onClick={() => setAction(a.value)}
                className={`flex-1 px-2.5 py-1.5 rounded-md border text-xs font-semibold transition-colors ${
                  action === a.value
                    ? "border-amber-500/60 bg-amber-500/15 text-amber-600 dark:text-amber-400"
                    : "border-border/60 text-muted-foreground hover:bg-muted/50"
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>
          <Input
            list="substitution-ingredient-options"
            placeholder={action === "add" ? "Recipe / ingredient to add to" : "Ingredient to replace"}
            value={ingredient}
            onChange={(e) => setIngredient(e.target.value)}
          />
          {needsSubstitute && (
            <div className="flex gap-2">
              <Input
                list="substitution-ingredient-options"
                placeholder={action === "add" ? "Ingredient to add" : "Replacement ingredient"}
                value={substitute}
                onChange={(e) => setSubstitute(e.target.value)}
                className="flex-1"
              />
              <Input
                type="number"
                inputMode="decimal"
                placeholder="lbs (opt.)"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-28"
              />
            </div>
          )}
          <Button type="button" onClick={submit} disabled={!canAdd} className="w-full">
            Apply substitution
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
