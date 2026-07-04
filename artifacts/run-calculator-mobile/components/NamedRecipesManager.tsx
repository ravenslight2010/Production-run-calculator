// Manager-only editor for factory-wide Dough / Sauce recipes (mobile parity with
// the web NamedRecipesManager). A named recipe is a simple name plus a list of
// components (each ingredient and its pounds). Unlike Cheese Recipes there is no
// brand/flavor grouping — this is a flat, searchable list sorted by name.
// Recipes are persisted server-side (shared across all signed-in users) and feed
// the run form's Dough / Sauce cards, which pick one and hydrate their rows from
// it. This works exactly like Cheese Recipes / Mixes but is a SEPARATE pool per
// kind. The server enforces the manager role on writes; this card is only
// rendered for managers.

import { Feather } from "@expo/vector-icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import React from "react";
import { Pressable, Switch, Text, TextInput, View } from "react-native";
import {
  normalizeNamedRecipe,
  namedRecipeMatchesQuery,
  sortNamedRecipesByName,
  namedRecipeTotalLbs,
  type NamedRecipe,
  type NamedRecipeComponent,
} from "@workspace/named-recipes";
import { FONTS } from "@/constants/fonts";
import { useColors } from "@/hooks/useColors";
import { useNamedRecipes } from "@/hooks/useNamedRecipes";
import {
  deleteNamedRecipes,
  saveNamedRecipes,
  type NamedRecipeKind,
} from "@/context/namedRecipes";

function genId(prefix: string): string {
  return `${prefix}:` + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function blankNamedRecipe(prefix: string, name: string): NamedRecipe {
  return { id: genId(prefix), name, notes: "", components: [], enabled: true };
}

export default function NamedRecipesManager({
  kind,
  ingredientSuggestions = [],
}: {
  kind: NamedRecipeKind;
  ingredientSuggestions?: string[];
}) {
  const colors = useColors();
  const qc = useQueryClient();
  const { items, isLoading } = useNamedRecipes(kind);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [openRecipes, setOpenRecipes] = React.useState<Set<string>>(new Set());

  const label = kind === "dough" ? "Dough" : "Sauce";
  const queryKey = kind === "dough" ? "doughRecipes" : "sauceRecipes";

  const filtered = React.useMemo(
    () => sortNamedRecipesByName(items.filter((r) => namedRecipeMatchesQuery(r, query))),
    [items, query],
  );

  function toggleRecipe(id: string) {
    setOpenRecipes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const saveMutation = useMutation({
    mutationFn: (next: NamedRecipe[]) => saveNamedRecipes(kind, next),
    onSuccess: (saved) => {
      qc.setQueryData([queryKey], saved);
      setError(null);
    },
    onError: () =>
      setError(`Could not save the ${label.toLowerCase()} recipe. Check your connection and try again.`),
  });

  const deleteMutation = useMutation({
    mutationFn: (ids: string[]) => deleteNamedRecipes(kind, ids),
    onSuccess: (saved) => {
      qc.setQueryData([queryKey], saved);
      setError(null);
    },
    onError: () =>
      setError(`Could not delete the ${label.toLowerCase()} recipe. Check your connection and try again.`),
  });

  const busy = saveMutation.isPending || deleteMutation.isPending;

  function addRecipe() {
    const draft = blankNamedRecipe(kind, `New ${label} Recipe`);
    setQuery("");
    setOpenRecipes((prev) => new Set(prev).add(draft.id));
    saveMutation.mutate([draft]);
  }

  return (
    <View style={{ gap: 12 }}>
      <Text style={{ fontFamily: FONTS.regular, fontSize: 12, color: colors.mutedForeground }}>
        Define each {label.toLowerCase()} recipe once by name and its ingredients
        with pounds. The run "{label}" cards pick one of these and fill in the rows
        automatically.
      </Text>

      {error ? (
        <View
          style={{
            flexDirection: "row",
            gap: 8,
            padding: 10,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: "#dc2626",
            backgroundColor: "#dc262622",
          }}
        >
          <Feather name="alert-triangle" size={14} color="#fca5a5" style={{ marginTop: 2 }} />
          <Text style={{ flex: 1, fontFamily: FONTS.regular, fontSize: 12, color: "#fca5a5" }}>
            {error}
          </Text>
        </View>
      ) : null}

      {isLoading ? (
        <Text style={{ fontFamily: FONTS.regular, fontSize: 12, color: colors.mutedForeground }}>
          Loading {label.toLowerCase()} recipes…
        </Text>
      ) : items.length === 0 ? (
        <Text style={{ fontFamily: FONTS.regular, fontSize: 12, color: colors.mutedForeground }}>
          No {label.toLowerCase()} recipes yet. Add one below.
        </Text>
      ) : (
        <View style={{ gap: 10 }}>
          {/* Search */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 8,
              paddingHorizontal: 10,
              backgroundColor: colors.background,
            }}
          >
            <Feather name="search" size={14} color={colors.mutedForeground} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={`Search ${label.toLowerCase()} recipes by name or ingredient…`}
              placeholderTextColor={colors.mutedForeground}
              style={{
                flex: 1,
                fontFamily: FONTS.regular,
                fontSize: 12,
                color: colors.foreground,
                paddingVertical: 8,
              }}
            />
          </View>

          {filtered.length === 0 ? (
            <Text style={{ fontFamily: FONTS.regular, fontSize: 12, color: colors.mutedForeground }}>
              No {label.toLowerCase()} recipes match "{query.trim()}".
            </Text>
          ) : (
            <View style={{ gap: 6 }}>
              {filtered.map((recipe) => {
                const expanded = openRecipes.has(recipe.id);
                return (
                  <View key={recipe.id} style={{ gap: 6 }}>
                    <Pressable
                      onPress={() => toggleRecipe(recipe.id)}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 8,
                        paddingHorizontal: 8,
                        paddingVertical: 8,
                        borderRadius: 8,
                        borderWidth: 1,
                        borderColor: expanded ? colors.primary : "transparent",
                        backgroundColor: expanded ? colors.primary + "1a" : "transparent",
                      }}
                    >
                      <Feather
                        name={expanded ? "chevron-down" : "chevron-right"}
                        size={12}
                        color={colors.mutedForeground}
                      />
                      <Text
                        numberOfLines={1}
                        style={{
                          flexShrink: 1,
                          fontFamily: FONTS.medium,
                          fontSize: 12,
                          color: colors.foreground,
                        }}
                      >
                        {recipe.name || "Unnamed recipe"}
                      </Text>
                      <View style={{ flex: 1 }} />
                      {!recipe.enabled ? (
                        <View
                          style={{
                            paddingHorizontal: 6,
                            paddingVertical: 2,
                            borderRadius: 999,
                            backgroundColor: colors.muted,
                          }}
                        >
                          <Text
                            style={{
                              fontFamily: FONTS.regular,
                              fontSize: 10,
                              color: colors.mutedForeground,
                            }}
                          >
                            Off
                          </Text>
                        </View>
                      ) : null}
                      {recipe.components.length > 0 ? (
                        <Text
                          style={{
                            fontFamily: FONTS.mono,
                            fontSize: 10,
                            color: colors.mutedForeground,
                          }}
                        >
                          {recipe.components.length} ing
                        </Text>
                      ) : null}
                    </Pressable>
                    {expanded ? (
                      <NamedRecipeEditor
                        kind={kind}
                        recipe={recipe}
                        disabled={busy}
                        ingredientSuggestions={ingredientSuggestions}
                        onChange={(next) => saveMutation.mutate([next])}
                        onDelete={() => deleteMutation.mutate([recipe.id])}
                      />
                    ) : null}
                  </View>
                );
              })}
            </View>
          )}
        </View>
      )}

      <View style={{ paddingTop: 4 }}>
        <Pressable
          onPress={addRecipe}
          disabled={busy}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            alignSelf: "flex-start",
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderRadius: 8,
            backgroundColor: colors.primary,
            opacity: busy ? 0.5 : 1,
          }}
        >
          <Feather name="plus" size={14} color={colors.primaryForeground} />
          <Text style={{ fontFamily: FONTS.bold, fontSize: 13, color: colors.primaryForeground }}>
            Add {label} Recipe
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function NamedRecipeEditor({
  kind,
  recipe,
  disabled,
  ingredientSuggestions,
  onChange,
  onDelete,
}: {
  kind: NamedRecipeKind;
  recipe: NamedRecipe;
  disabled: boolean;
  ingredientSuggestions: string[];
  onChange: (recipe: NamedRecipe) => void;
  onDelete: () => void;
}) {
  const colors = useColors();
  const [draft, setDraft] = React.useState<NamedRecipe>(recipe);

  const signature = JSON.stringify(recipe);
  const [lastSignature, setLastSignature] = React.useState(signature);
  if (signature !== lastSignature) {
    setLastSignature(signature);
    setDraft(recipe);
  }

  function patch(p: Partial<NamedRecipe>) {
    setDraft((d) => ({ ...d, ...p }));
  }

  function commit(next: NamedRecipe = draft) {
    const clean = normalizeNamedRecipe(next);
    if (clean) onChange({ ...clean, id: next.id, scope: next.scope });
  }

  function patchComponent(idx: number, p: Partial<NamedRecipeComponent>) {
    setDraft((d) => ({
      ...d,
      components: d.components.map((c, i) => (i === idx ? { ...c, ...p } : c)),
    }));
  }

  function addComponent() {
    setDraft((d) => ({ ...d, components: [...d.components, { ingredient: "", lbs: 0 }] }));
  }

  function removeComponent(idx: number) {
    const next = { ...draft, components: draft.components.filter((_, i) => i !== idx) };
    setDraft(next);
    commit(next);
  }

  const totalLbs = namedRecipeTotalLbs({
    ...draft,
    components: draft.components.map((c) => ({ ingredient: c.ingredient, lbs: Number(c.lbs) || 0 })),
  });

  const inputStyle = {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    color: colors.foreground,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontFamily: FONTS.regular,
    fontSize: 13,
  } as const;

  return (
    <View
      style={{
        gap: 10,
        padding: 12,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.secondary,
      }}
    >
      {/* Name + enabled + delete */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <TextInput
          value={draft.name}
          onChangeText={(t) => patch({ name: t })}
          onBlur={() => commit()}
          editable={!disabled}
          placeholder={`${kind === "dough" ? "Dough" : "Sauce"} recipe name…`}
          placeholderTextColor={colors.mutedForeground}
          style={[inputStyle, { flex: 1, fontFamily: FONTS.medium }]}
        />
        <Switch
          value={draft.enabled}
          onValueChange={(v) => {
            const next = { ...draft, enabled: v };
            setDraft(next);
            commit(next);
          }}
          disabled={disabled}
        />
        <Pressable onPress={onDelete} disabled={disabled} hitSlop={8}>
          <Feather name="trash-2" size={16} color="#f87171" />
        </Pressable>
      </View>

      {/* Notes */}
      <TextInput
        value={draft.notes ?? ""}
        onChangeText={(t) => patch({ notes: t })}
        onBlur={() => commit()}
        editable={!disabled}
        placeholder="Notes (optional)…"
        placeholderTextColor={colors.mutedForeground}
        style={inputStyle}
      />

      {/* Components */}
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ fontFamily: FONTS.medium, fontSize: 12, color: colors.mutedForeground }}>
            Ingredients (lbs)
          </Text>
          {totalLbs > 0 ? (
            <Text style={{ fontFamily: FONTS.mono, fontSize: 11, color: colors.mutedForeground }}>
              {totalLbs.toLocaleString(undefined, { maximumFractionDigits: 2 })} lbs
            </Text>
          ) : null}
        </View>
        {draft.components.length === 0 ? (
          <Text style={{ fontFamily: FONTS.regular, fontSize: 12, color: colors.mutedForeground }}>
            No ingredients yet.
          </Text>
        ) : (
          draft.components.map((c, idx) => (
            <View key={idx} style={{ gap: 6 }}>
              <ChipPicker
                value={c.ingredient}
                options={ingredientSuggestions}
                placeholder="Ingredient…"
                disabled={disabled}
                onChange={(v) => {
                  patchComponent(idx, { ingredient: v });
                  commit({
                    ...draft,
                    components: draft.components.map((cc, i) =>
                      i === idx ? { ...cc, ingredient: v } : cc,
                    ),
                  });
                }}
                onCommit={() => commit()}
                onChangeText={(t) => patchComponent(idx, { ingredient: t })}
                inputStyle={inputStyle}
              />
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <TextInput
                  value={String(c.lbs)}
                  onChangeText={(t) => patchComponent(idx, { lbs: Math.max(0, Number(t) || 0) })}
                  onBlur={() => commit()}
                  keyboardType="decimal-pad"
                  editable={!disabled}
                  style={[inputStyle, { width: 90, fontFamily: FONTS.mono, textAlign: "center" }]}
                />
                <Text style={{ fontFamily: FONTS.regular, fontSize: 12, color: colors.mutedForeground }}>
                  lbs
                </Text>
                <View style={{ flex: 1 }} />
                <Pressable onPress={() => removeComponent(idx)} disabled={disabled} hitSlop={8}>
                  <Feather name="trash-2" size={15} color="#f87171" />
                </Pressable>
              </View>
            </View>
          ))
        )}
        <Pressable
          onPress={addComponent}
          disabled={disabled}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            alignSelf: "flex-start",
            paddingHorizontal: 10,
            paddingVertical: 4,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.background,
            opacity: disabled ? 0.5 : 1,
          }}
        >
          <Feather name="plus" size={11} color={colors.mutedForeground} />
          <Text style={{ fontFamily: FONTS.regular, fontSize: 11, color: colors.mutedForeground }}>
            Add ingredient
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// A free-text input with quick-pick chips for known options (mirrors the web
// datalist: type anything, or tap a known ingredient).
function ChipPicker({
  value,
  options,
  placeholder,
  disabled,
  onChange,
  onCommit,
  onChangeText,
  inputStyle,
}: {
  value: string;
  options: string[];
  placeholder: string;
  disabled: boolean;
  onChange: (v: string) => void;
  onCommit: () => void;
  onChangeText: (t: string) => void;
  inputStyle: object;
}) {
  const colors = useColors();
  const hideValue = value.trim().toLowerCase();
  const chips = React.useMemo(
    () =>
      Array.from(new Set(options.map((o) => o.trim()).filter(Boolean)))
        .filter((o) => o.toLowerCase() !== hideValue)
        .sort((a, b) => a.localeCompare(b))
        .slice(0, 20),
    [options, hideValue],
  );
  return (
    <View style={{ gap: 4 }}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onBlur={onCommit}
        editable={!disabled}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        style={inputStyle}
      />
      {chips.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {chips.map((o) => (
            <Pressable
              key={o}
              onPress={() => onChange(o)}
              disabled={disabled}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 3,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.background,
                opacity: disabled ? 0.5 : 1,
              }}
            >
              <Text style={{ fontFamily: FONTS.regular, fontSize: 11, color: colors.mutedForeground }}>
                {o}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}
