import { useId, useState } from "react";

// Inline "rename / merge brand" panel used by the Mixes and Cheese Recipes
// managers (Manage Lists). Opens under a brand group header. Typing a new
// name renames the whole group; typing (or picking) another existing group's
// name merges this group into it — grouping is case-insensitive, so the two
// groups collapse into one. The caller owns the actual data rewrite.
export function BrandRenamePanel({
  brand,
  nounLabel,
  itemCount,
  itemNoun,
  otherBrands,
  disabled,
  onSave,
  onCancel,
}: {
  brand: string;
  nounLabel: string; // "brand" | "customer (brand)"
  itemCount: number;
  itemNoun: string; // "mix" | "cheese recipe"
  otherBrands: string[]; // display names of the OTHER groups
  disabled: boolean;
  onSave: (newName: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(brand);
  const listId = useId();

  const trimmed = value.trim();
  const mergeTarget = otherBrands.find(
    (b) => b.toLowerCase() === trimmed.toLowerCase(),
  );
  const canSave = !disabled && trimmed.length > 0 && trimmed !== brand;
  const plural = itemCount === 1 ? itemNoun : `${itemNoun}s`;

  return (
    <div className="px-2.5 py-2 border-t border-border/40 bg-muted/20 space-y-1.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        Rename {nounLabel}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          list={listId}
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSave) onSave(trimmed);
            if (e.key === "Escape") onCancel();
          }}
          disabled={disabled}
          placeholder="New name…"
          className="flex-1 min-w-[10rem] rounded-md border border-input bg-background px-2 py-1 text-xs"
        />
        <datalist id={listId}>
          {otherBrands.map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>
        <button
          type="button"
          onClick={() => onSave(trimmed)}
          disabled={!canSave}
          className="px-2.5 py-1 rounded-md bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50"
        >
          {mergeTarget ? "Merge" : "Rename"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={disabled}
          className="px-2.5 py-1 rounded-md border border-border/60 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
      {mergeTarget ? (
        <p className="text-[11px] text-amber-300">
          This will move {itemCount} {plural} into the existing "{mergeTarget}"
          group. The {plural} themselves keep their names.
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Renames the {nounLabel} on all {itemCount} {plural} in this group. To
          merge into another group, type or pick its exact name.
        </p>
      )}
    </div>
  );
}
