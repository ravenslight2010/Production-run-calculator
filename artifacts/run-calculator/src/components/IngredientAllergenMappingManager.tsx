import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Search } from "lucide-react";
import {
  INGREDIENT_ALLERGENS,
  ingredientAllergenReviewPending,
  type Ingredient,
  type IngredientAllergen,
} from "@workspace/ingredient-catalog";
import { useUpdateIngredientAllergenMapping } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { updateMasterDataSlice, useMasterDataSlice } from "../masterData";

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const MAX_REVIEW_QUEUE_RESULTS = 50;

export default function IngredientAllergenMappingManager() {
  const queryClient = useQueryClient();
  const query = useMasterDataSlice("ingredients");
  const items = query.data ?? [];
  const [search, setSearch] = useState("");
  const [reviewQueueOnly, setReviewQueueOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<IngredientAllergen[]>([]);
  const [reviewed, setReviewed] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const mutation = useUpdateIngredientAllergenMapping();

  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const selected = selectedId ? byId.get(selectedId) ?? null : null;
  const reviewQueueItems = useMemo(
    () =>
      items
        .filter(ingredientAllergenReviewPending)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [items],
  );
  const filteredItems = useMemo(() => {
    const queryText = search.trim().toLowerCase();
    const source = reviewQueueOnly ? reviewQueueItems : items;
    return [...source]
      .filter((item) => !queryText || item.name.toLowerCase().includes(queryText))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [items, reviewQueueItems, reviewQueueOnly, search]);
  const visibleItems = reviewQueueOnly
    ? filteredItems.slice(0, MAX_REVIEW_QUEUE_RESULTS)
    : filteredItems;

  useEffect(() => {
    if (!selected) return;
    setDraft(INGREDIENT_ALLERGENS.filter((allergen) => selected.allergens.includes(allergen)));
    setReviewed(selected.allergensReviewed);
  }, [selected?.id, selected?.allergens, selected?.allergensReviewed]);

  const dirty = selected
    ? reviewed !== selected.allergensReviewed ||
      draft.length !== selected.allergens.length ||
      draft.some((allergen) => !selected.allergens.includes(allergen))
    : false;

  async function saveMapping() {
    if (!selected || !dirty || mutation.isPending) return;
    try {
      const saved = await mutation.mutateAsync({
        id: selected.id,
        data: { allergens: draft, reviewed },
      });
      updateMasterDataSlice(queryClient, "ingredients", (current) =>
        current?.map((item) => (item.id === saved.id ? saved : item)),
      );
      setSavedId(saved.id);
    } catch {
      // Keep the current saved catalog intact. The inline alert below provides
      // a retry path without exposing request details.
    }
  }

  function status(item: Ingredient): string {
    if (!item.allergensReviewed) return "Unreviewed — allergen status unknown";
    if (item.allergens.length === 0) return "Reviewed — none of these nine";
    return `Reviewed — ${item.allergens.map(titleCase).join(", ")}`;
  }

  return (
    <Card data-testid="ingredient-allergen-mapping-manager">
      <CardHeader>
        <CardTitle className="text-base">Ingredient allergen mappings</CardTitle>
        <p className="text-sm text-muted-foreground">
          Review each ingredient identity. An empty selection means “none of these
          nine” only when you explicitly mark it reviewed.
        </p>
        <p className="text-xs text-muted-foreground">
          These mappings are for run visibility only, not food-label claims or cleaning clearance.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
          <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">Search ingredients</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search ingredients…"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            data-testid="allergen-ingredient-search"
          />
        </label>
        <label className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
          <input
            type="checkbox"
            checked={reviewQueueOnly}
            onChange={(event) => setReviewQueueOnly(event.target.checked)}
            data-testid="allergen-review-queue-toggle"
          />
          <span className="flex-1">Only show ingredients needing review</span>
          <span
            className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums"
            role="status"
            aria-label={`${reviewQueueItems.length} ingredients need allergen review`}
            data-testid="allergen-review-queue-count"
          >
            {reviewQueueItems.length > MAX_REVIEW_QUEUE_RESULTS
              ? `${MAX_REVIEW_QUEUE_RESULTS}+`
              : reviewQueueItems.length}
          </span>
        </label>
        {reviewQueueOnly && (
          <p className="text-xs text-muted-foreground" role="status">
            Showing up to the first {MAX_REVIEW_QUEUE_RESULTS} matching ingredients. Search to
            narrow the queue. Unreviewed or uncertain mappings remain unknown.
          </p>
        )}

        {query.isLoading ? (
          <p className="py-4 text-center text-sm text-muted-foreground" role="status">
            Loading ingredient mappings…
          </p>
        ) : query.isError ? (
          <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <p className="text-sm text-destructive" role="alert">
              Ingredient mapping data could not be loaded. No ingredient is being treated as allergen-free.
            </p>
            <button
              type="button"
              onClick={() => void query.refetch()}
              className="rounded border border-border px-3 py-1.5 text-sm hover:bg-muted/40"
            >
              Retry loading
            </button>
          </div>
        ) : items.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No ingredient identities are available to review.
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,1fr)]">
            <div className="max-h-[28rem] space-y-1 overflow-y-auto rounded-md border border-border p-1">
              {visibleItems.map((item) => {
                const target = item.mergedInto ? byId.get(item.mergedInto) : null;
                const inactive = !item.enabled || Boolean(item.mergedInto);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(item.id);
                      setSavedId(null);
                      mutation.reset();
                    }}
                    aria-expanded={selectedId === item.id}
                    data-testid={`allergen-mapping-select-${item.id}`}
                    className={`block w-full rounded px-3 py-2 text-left transition-colors ${
                      selectedId === item.id
                        ? "bg-primary/10 ring-1 ring-primary/30"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <span className="block truncate text-sm font-medium">{item.name}</span>
                    <span className="block text-xs text-muted-foreground">{status(item)}</span>
                    {inactive && (
                      <span className="block text-xs text-muted-foreground">
                        {item.mergedInto
                          ? `Merged into ${target?.name ?? "an unavailable ingredient"}; historical recipe rows may still refer to this identity.`
                          : "Inactive ingredient identity; historical recipe rows may still refer to it."}
                      </span>
                    )}
                  </button>
                );
              })}
              {visibleItems.length === 0 && (
                <p className="p-3 text-sm text-muted-foreground">
                  {reviewQueueOnly && reviewQueueItems.length === 0
                    ? "No ingredient mappings need review."
                    : reviewQueueOnly
                      ? "No matching ingredients need review."
                      : "No matching ingredients."}
                </p>
              )}
            </div>

            {selected ? (
              <fieldset
                className="space-y-3 rounded-md border border-border p-3"
                data-testid="allergen-mapping-editor"
                disabled={mutation.isPending}
              >
                <legend className="px-1 text-sm font-semibold">{selected.name}</legend>
                <p className="text-xs text-muted-foreground">
                  Select every tracked allergen supported by the reviewed ingredient information.
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {INGREDIENT_ALLERGENS.map((allergen) => (
                    <label key={allergen} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={draft.includes(allergen)}
                        onChange={(event) => {
                          setDraft((current) =>
                            INGREDIENT_ALLERGENS.filter((value) =>
                              event.target.checked
                                ? value === allergen || current.includes(value)
                                : value !== allergen && current.includes(value),
                            ),
                          );
                          setSavedId(null);
                        }}
                        aria-label={`${titleCase(allergen)} for ${selected.name}`}
                        data-testid={`allergen-checkbox-${allergen}`}
                      />
                      {titleCase(allergen)}
                    </label>
                  ))}
                </div>
                <label className="flex items-start gap-2 rounded-md border border-border/70 p-2 text-sm">
                  <input
                    type="checkbox"
                    checked={reviewed}
                    onChange={(event) => {
                      setReviewed(event.target.checked);
                      setSavedId(null);
                    }}
                    aria-label={`Mark ${selected.name} mapping reviewed`}
                    data-testid="allergen-reviewed-checkbox"
                  />
                  <span>
                    I reviewed this ingredient’s mapping. With no allergens selected, this means
                    “none of these nine.”
                  </span>
                </label>
                {!reviewed && (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    This ingredient remains unknown until its mapping is explicitly reviewed.
                  </p>
                )}

                {mutation.isError && (
                  <div
                    className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-sm text-destructive"
                    role="alert"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>
                      The mapping was not saved. The previous saved mapping is unchanged; check
                      your access and try again.
                    </span>
                  </div>
                )}
                {savedId === selected.id && !mutation.isError && (
                  <p className="flex items-center gap-1 text-sm text-green-700 dark:text-green-300" role="status">
                    <Check className="h-4 w-4" aria-hidden="true" />
                    Saved: {status(selected)}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => void saveMapping()}
                  disabled={!dirty || mutation.isPending}
                  data-testid="save-allergen-mapping"
                  className="w-full rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {mutation.isPending
                    ? "Saving…"
                    : reviewed && draft.length === 0
                      ? "Save reviewed — none of these nine"
                      : "Save mapping"}
                </button>
              </fieldset>
            ) : (
              <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
                Select an ingredient to review or update its mapping.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
