import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Plus, Trash2, Snowflake } from "lucide-react";
import {
  DEFAULT_DAYS_EARLY,
  type FreezerPullItem,
} from "@workspace/freezer-pull";
import { useFreezerPullItems } from "../hooks/useFreezerPullItems";
import { saveFreezerPullItems, deleteFreezerPullItems } from "../freezerPull";

function genId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Manager-only editor for factory-wide freezer-pull items. Each item names an
// ingredient that must be pulled from the freezer `daysEarly` days before the
// run that uses it (default 3). Items are persisted server-side (shared across
// all signed-in users) and drive the "Pull Out Freezer" notices on the
// Warehouse tab. The server enforces the manager role on writes; this card is
// only rendered for managers.
//
// `suggestions` are existing ingredient/type names from the app's master lists,
// so a manager can tag a known ingredient in one tap instead of retyping it.
export default function FreezerPullItemsManager({
  suggestions = [],
}: {
  suggestions?: string[];
}) {
  const qc = useQueryClient();
  const { items, isLoading } = useFreezerPullItems();
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  // Ingredients already tagged (case-insensitive) so the quick-add list only
  // offers ones that aren't already configured.
  const tagged = useMemo(
    () => new Set(items.map((i) => i.ingredient.trim().toLowerCase())),
    [items],
  );
  const quickAdd = useMemo(
    () =>
      Array.from(new Set(suggestions.map((s) => s.trim()).filter(Boolean)))
        .filter((s) => !tagged.has(s.toLowerCase()))
        .sort((a, b) => a.localeCompare(b)),
    [suggestions, tagged],
  );

  const saveMutation = useMutation({
    mutationFn: (next: FreezerPullItem[]) => saveFreezerPullItems(next),
    onSuccess: (saved) => {
      qc.setQueryData(["freezerPullItems"], saved);
      setError(null);
    },
    onError: () =>
      setError("Could not save the item. Check your connection and try again."),
  });

  const deleteMutation = useMutation({
    mutationFn: (ids: string[]) => deleteFreezerPullItems(ids),
    onSuccess: (saved) => {
      qc.setQueryData(["freezerPullItems"], saved);
      setError(null);
    },
    onError: () =>
      setError("Could not delete the item. Check your connection and try again."),
  });

  const busy = saveMutation.isPending || deleteMutation.isPending;

  function addItem(ingredient: string) {
    const name = ingredient.trim();
    if (!name) return;
    if (tagged.has(name.toLowerCase())) {
      setNewName("");
      return;
    }
    saveMutation.mutate([
      { id: genId(), ingredient: name, daysEarly: DEFAULT_DAYS_EARLY, enabled: true },
    ]);
    setNewName("");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Snowflake className="w-4 h-4" />
          Freezer-Pull Items
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Tag ingredients that must be pulled from the freezer ahead of time.
          Each item is pulled <span className="font-semibold text-sky-300">N days</span> before a
          scheduled run that uses it (default {DEFAULT_DAYS_EARLY}). The Warehouse tab shows a
          "Pull Out Freezer" card once it's time.
        </p>

        {error && (
          <div className="flex items-start gap-2 px-2.5 py-1.5 rounded-md text-xs border bg-red-950/40 border-red-700/40 text-red-300">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {isLoading ? (
          <p className="text-xs text-muted-foreground">Loading items…</p>
        ) : items.length === 0 ? (
          <p className="text-xs text-muted-foreground">No freezer-pull items yet. Add one below.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {items.map((item) => (
              <ItemEditor
                key={item.id}
                item={item}
                disabled={busy}
                onChange={(next) => saveMutation.mutate([next])}
                onDelete={() => deleteMutation.mutate([item.id])}
              />
            ))}
          </div>
        )}

        {/* Add by typing, with existing ingredient names as suggestions. */}
        <div className="flex items-center gap-2 pt-1 border-t border-border/40">
          <input
            type="text"
            list="freezer-pull-suggestions"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addItem(newName)}
            placeholder="Ingredient name…"
            disabled={busy}
            className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs"
          />
          <datalist id="freezer-pull-suggestions">
            {quickAdd.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <button
            type="button"
            onClick={() => addItem(newName)}
            disabled={busy || !newName.trim()}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>

        {/* One-tap add from existing ingredient lists. */}
        {quickAdd.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold text-muted-foreground">
              Add from existing ingredients
            </p>
            <div className="flex flex-wrap gap-1.5">
              {quickAdd.slice(0, 30).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => addItem(s)}
                  disabled={busy}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full border border-border/60 bg-muted/30 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-50"
                >
                  <Plus className="w-3 h-3" /> {s}
                </button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ItemEditor({
  item,
  disabled,
  onChange,
  onDelete,
}: {
  item: FreezerPullItem;
  disabled: boolean;
  onChange: (item: FreezerPullItem) => void;
  onDelete: () => void;
}) {
  function patch(p: Partial<FreezerPullItem>) {
    onChange({ ...item, ...p });
  }

  return (
    <div className="rounded-md border border-border/60 bg-muted/20 p-2.5 flex flex-wrap items-center gap-2">
      <input
        type="text"
        value={item.ingredient}
        onChange={(e) => patch({ ingredient: e.target.value })}
        disabled={disabled}
        className="flex-1 min-w-[8rem] rounded-md border border-input bg-background px-2 py-1 text-xs font-semibold"
      />
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <span>pull</span>
        <input
          type="number"
          min={0}
          value={item.daysEarly}
          onChange={(e) =>
            patch({ daysEarly: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })
          }
          disabled={disabled}
          className="w-14 rounded-md border border-input bg-background px-2 py-1 text-xs font-mono"
        />
        <span>days early</span>
      </div>
      <label className="flex items-center gap-1 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={item.enabled}
          onChange={(e) => patch({ enabled: e.target.checked })}
          disabled={disabled}
        />
        On
      </label>
      <button
        type="button"
        onClick={onDelete}
        disabled={disabled}
        title="Delete item"
        className="p-1 rounded-md text-red-400 hover:bg-red-950/40 disabled:opacity-50"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
