// Manager-only editor for factory-wide cheese recipes (mobile parity with the
// web CheeseRecipesManager). A cheese recipe is a named cheese blend a customer
// uses on the line — the customer (brand), the product flavors it is assigned
// to, the cheese-shredder setting, an optional cellulose note, notes, and a list
// of components (each ingredient and its per-BATCH pounds). Cheese recipes are
// persisted server-side and feed the run applicator "Cheese" cards, which pick
// one and hydrate their rows from it. This works exactly like Mixes but is a
// SEPARATE pool (cheese is not routed into Mixes). The server enforces the
// manager role on writes; this card is only rendered for managers.

import { Feather } from "@expo/vector-icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import React from "react";
import { Pressable, Switch, Text, TextInput, View } from "react-native";
import {
  normalizeCheeseRecipe,
  cheeseRecipeMatchesQuery,
  groupCheeseRecipesByBrand,
  type CheeseRecipe,
  type CheeseComponent,
} from "@workspace/cheese-recipes";
import { FONTS } from "@/constants/fonts";
import { useColors } from "@/hooks/useColors";
import { useCheeseRecipes } from "@/hooks/useCheeseRecipes";
import { deleteCheeseRecipes, saveCheeseRecipes } from "@/context/cheeseRecipes";

function genId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function blankCheeseRecipe(): CheeseRecipe {
  return {
    id: genId(),
    name: "New Cheese Recipe",
    brand: "",
    flavors: [],
    shredderSetting: "",
    cellulose: "",
    notes: "",
    components: [],
    enabled: true,
  };
}

export default function CheeseRecipesManager({
  brands = [],
  brandFlavors = {},
  ingredientSuggestions = [],
}: {
  brands?: string[];
  brandFlavors?: Record<string, string[]>;
  ingredientSuggestions?: string[];
}) {
  const colors = useColors();
  const qc = useQueryClient();
  const { items, isLoading } = useCheeseRecipes();
  const [error, setError] = React.useState<string | null>(null);
  // Browsing state: search + which brand groups / recipe editors are open.
  // Mirrors the web + Mixes manager — grouped by brand (collapsed by default),
  // each recipe a compact row that expands to the full editor on tap.
  const [query, setQuery] = React.useState("");
  const [openBrands, setOpenBrands] = React.useState<Set<string>>(new Set());
  const [openRecipes, setOpenRecipes] = React.useState<Set<string>>(new Set());

  const searching = query.trim().length > 0;
  const groups = React.useMemo(() => {
    const filtered = items.filter((r) => cheeseRecipeMatchesQuery(r, query));
    return groupCheeseRecipesByBrand(filtered);
  }, [items, query]);

  function toggleBrand(key: string) {
    setOpenBrands((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleRecipe(id: string) {
    setOpenRecipes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const saveMutation = useMutation({
    mutationFn: (next: CheeseRecipe[]) => saveCheeseRecipes(next),
    onSuccess: (saved) => {
      qc.setQueryData(["cheeseRecipes"], saved);
      setError(null);
    },
    onError: () =>
      setError("Could not save the cheese recipe. Check your connection and try again."),
  });

  const deleteMutation = useMutation({
    mutationFn: (ids: string[]) => deleteCheeseRecipes(ids),
    onSuccess: (saved) => {
      qc.setQueryData(["cheeseRecipes"], saved);
      setError(null);
    },
    onError: () =>
      setError("Could not delete the cheese recipe. Check your connection and try again."),
  });

  const busy = saveMutation.isPending || deleteMutation.isPending;

  function addRecipe() {
    const draft = blankCheeseRecipe();
    setQuery("");
    setOpenBrands((prev) => new Set(prev).add(""));
    setOpenRecipes((prev) => new Set(prev).add(draft.id));
    saveMutation.mutate([draft]);
  }

  return (
    <View style={{ gap: 12 }}>
      <Text style={{ fontFamily: FONTS.regular, fontSize: 12, color: colors.mutedForeground }}>
        Define each customer's cheese blend once. Set the customer (brand), the
        flavors it's used on, the shredder setting, and the ingredients with their
        pounds per batch. The run "Cheese" cards pick one of these and fill in the
        rows automatically.
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
          Loading cheese recipes…
        </Text>
      ) : items.length === 0 ? (
        <Text style={{ fontFamily: FONTS.regular, fontSize: 12, color: colors.mutedForeground }}>
          No cheese recipes yet. Add one below or import a Cheese Mix Recipe Specs
          workbook.
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
              placeholder="Search cheese recipes by name, customer, or flavor…"
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

          {groups.length === 0 ? (
            <Text style={{ fontFamily: FONTS.regular, fontSize: 12, color: colors.mutedForeground }}>
              No cheese recipes match "{query.trim()}".
            </Text>
          ) : (
            groups.map((group) => {
              const key = group.brand.toLowerCase();
              const open = searching || groups.length === 1 || openBrands.has(key);
              return (
                <View
                  key={key || "(none)"}
                  style={{
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 8,
                    overflow: "hidden",
                  }}
                >
                  <Pressable
                    onPress={() => toggleBrand(key)}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                      paddingHorizontal: 10,
                      paddingVertical: 10,
                      backgroundColor: colors.muted,
                    }}
                  >
                    <Feather
                      name={open ? "chevron-down" : "chevron-right"}
                      size={14}
                      color={colors.mutedForeground}
                    />
                    <Text
                      numberOfLines={1}
                      style={{
                        flex: 1,
                        fontFamily: FONTS.bold,
                        fontSize: 13,
                        color: colors.foreground,
                      }}
                    >
                      {group.brand || "No customer"}
                    </Text>
                    {group.shredderSetting ? (
                      <Text
                        style={{
                          fontFamily: FONTS.regular,
                          fontSize: 10,
                          color: colors.mutedForeground,
                        }}
                      >
                        Shredder {group.shredderSetting}
                      </Text>
                    ) : null}
                    <View
                      style={{
                        paddingHorizontal: 6,
                        paddingVertical: 2,
                        borderRadius: 999,
                        backgroundColor: colors.background,
                      }}
                    >
                      <Text
                        style={{
                          fontFamily: FONTS.mono,
                          fontSize: 10,
                          color: colors.mutedForeground,
                        }}
                      >
                        {group.recipes.length}
                      </Text>
                    </View>
                  </Pressable>
                  {open ? (
                    <View
                      style={{
                        gap: 6,
                        padding: 6,
                        borderTopWidth: 1,
                        borderTopColor: colors.border,
                      }}
                    >
                      {group.recipes.map((recipe) => {
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
                                backgroundColor: expanded
                                  ? colors.primary + "1a"
                                  : "transparent",
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
                              {recipe.flavors.length > 0 ? (
                                <Text
                                  numberOfLines={1}
                                  style={{
                                    flexShrink: 1,
                                    fontFamily: FONTS.regular,
                                    fontSize: 11,
                                    color: colors.mutedForeground,
                                  }}
                                >
                                  {recipe.flavors.join(", ")}
                                </Text>
                              ) : null}
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
                              <CheeseRecipeEditor
                                recipe={recipe}
                                disabled={busy}
                                brands={brands}
                                brandFlavors={brandFlavors}
                                ingredientSuggestions={ingredientSuggestions}
                                onChange={(next) => saveMutation.mutate([next])}
                                onDelete={() => deleteMutation.mutate([recipe.id])}
                              />
                            ) : null}
                          </View>
                        );
                      })}
                    </View>
                  ) : null}
                </View>
              );
            })
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
            Add Cheese Recipe
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function CheeseRecipeEditor({
  recipe,
  disabled,
  brands,
  brandFlavors,
  ingredientSuggestions,
  onChange,
  onDelete,
}: {
  recipe: CheeseRecipe;
  disabled: boolean;
  brands: string[];
  brandFlavors: Record<string, string[]>;
  ingredientSuggestions: string[];
  onChange: (recipe: CheeseRecipe) => void;
  onDelete: () => void;
}) {
  const colors = useColors();
  // Local draft so component rows / numbers edit smoothly; commit on blur.
  const [draft, setDraft] = React.useState<CheeseRecipe>(recipe);
  // Flavors edit as a comma-separated string (parity with web) so managers can
  // type freely; split back into flavors[] on commit.
  const [flavorsText, setFlavorsText] = React.useState<string>(recipe.flavors.join(", "));

  const signature = JSON.stringify(recipe);
  const [lastSignature, setLastSignature] = React.useState(signature);
  if (signature !== lastSignature) {
    setLastSignature(signature);
    setDraft(recipe);
    setFlavorsText(recipe.flavors.join(", "));
  }

  function patch(p: Partial<CheeseRecipe>) {
    setDraft((d) => ({ ...d, ...p }));
  }

  function commit(next: CheeseRecipe = draft) {
    const flavors = flavorsText
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean);
    const clean = normalizeCheeseRecipe({ ...next, flavors });
    if (clean) onChange({ ...clean, id: next.id, scope: next.scope });
  }

  function patchComponent(idx: number, p: Partial<CheeseComponent>) {
    setDraft((d) => ({
      ...d,
      components: d.components.map((c, i) => (i === idx ? { ...c, ...p } : c)),
    }));
  }

  function addComponent() {
    setDraft((d) => ({
      ...d,
      components: [...d.components, { ingredient: "", lbs: 0 }],
    }));
  }

  function removeComponent(idx: number) {
    const next = {
      ...draft,
      components: draft.components.filter((_, i) => i !== idx),
    };
    setDraft(next);
    commit(next);
  }

  const flavorOptions = brandFlavors[draft.brand] ?? [];

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
          placeholder="Cheese recipe name…"
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

      {/* Customer (brand) */}
      <ChipPicker
        label="Customer (brand)"
        value={draft.brand}
        options={brands}
        placeholder="Any customer"
        disabled={disabled}
        onChange={(v) => {
          const next = { ...draft, brand: v };
          setDraft(next);
          commit(next);
        }}
        onCommit={() => commit()}
        onChangeText={(t) => patch({ brand: t })}
        inputStyle={inputStyle}
      />

      {/* Shredder setting + cellulose */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <TextField
          label="Shredder setting"
          value={draft.shredderSetting}
          placeholder="e.g. 3"
          disabled={disabled}
          onChangeText={(t) => patch({ shredderSetting: t })}
          onCommit={() => commit()}
          inputStyle={inputStyle}
        />
        <TextField
          label="Cellulose"
          value={draft.cellulose}
          placeholder="optional"
          disabled={disabled}
          onChangeText={(t) => patch({ cellulose: t })}
          onCommit={() => commit()}
          inputStyle={inputStyle}
        />
      </View>

      {/* Flavors assigned */}
      <ChipPicker
        label="Flavors (comma separated — blank = all varieties)"
        value={flavorsText}
        options={flavorOptions}
        placeholder="Pepperoni, Cheese, …"
        disabled={disabled}
        onChange={(v) => {
          // Append a tapped flavor chip to the comma list.
          const parts = flavorsText
            .split(",")
            .map((f) => f.trim())
            .filter(Boolean);
          if (!parts.some((p) => p.toLowerCase() === v.toLowerCase())) parts.push(v);
          const next = parts.join(", ");
          setFlavorsText(next);
          commit();
        }}
        onCommit={() => commit()}
        onChangeText={setFlavorsText}
        inputStyle={inputStyle}
        matchValue=""
      />

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
        <Text style={{ fontFamily: FONTS.medium, fontSize: 12, color: colors.mutedForeground }}>
          Ingredients (lbs per batch)
        </Text>
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
                  onChangeText={(t) =>
                    patchComponent(idx, { lbs: Math.max(0, Number(t) || 0) })
                  }
                  onBlur={() => commit()}
                  keyboardType="decimal-pad"
                  editable={!disabled}
                  style={[inputStyle, { width: 90, fontFamily: FONTS.mono, textAlign: "center" }]}
                />
                <Text style={{ fontFamily: FONTS.regular, fontSize: 12, color: colors.mutedForeground }}>
                  lbs/batch
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
// datalist: type anything, or tap a known brand/flavor/ingredient). `matchValue`
// overrides which value the chip list hides (used for the comma-list flavors
// field, where the raw value isn't a single option).
function ChipPicker({
  label,
  value,
  options,
  placeholder,
  disabled,
  onChange,
  onCommit,
  onChangeText,
  inputStyle,
  matchValue,
}: {
  label?: string;
  value: string;
  options: string[];
  placeholder: string;
  disabled: boolean;
  onChange: (v: string) => void;
  onCommit: () => void;
  onChangeText: (t: string) => void;
  inputStyle: object;
  matchValue?: string;
}) {
  const colors = useColors();
  const hideValue = (matchValue ?? value).trim().toLowerCase();
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
      {label ? (
        <Text style={{ fontFamily: FONTS.medium, fontSize: 10, color: colors.mutedForeground, textTransform: "uppercase", letterSpacing: 0.5 }}>
          {label}
        </Text>
      ) : null}
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

function TextField({
  label,
  value,
  placeholder,
  disabled,
  onChangeText,
  onCommit,
  inputStyle,
}: {
  label: string;
  value: string;
  placeholder?: string;
  disabled: boolean;
  onChangeText: (t: string) => void;
  onCommit: () => void;
  inputStyle: object;
}) {
  const colors = useColors();
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ fontFamily: FONTS.medium, fontSize: 10, color: colors.mutedForeground, textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onBlur={onCommit}
        editable={!disabled}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        style={[inputStyle, { width: 150 }]}
      />
    </View>
  );
}
