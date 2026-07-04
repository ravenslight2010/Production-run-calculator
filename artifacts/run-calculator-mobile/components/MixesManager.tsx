// Manager-only editor for factory-wide mixes (mobile parity with the web
// MixesManager). A mix is a pre-blended recipe (veggie/topping, cheese, sauce,
// …) made ahead for a product. Each mix names the product (brand + flavor) it
// matches against scheduled runs, a batch size (lbs/batch), an optional "make N
// days early" window, optional notes, an optional "amount already made", and a
// list of components (each ingredient and its per-pizza ounces). Mixes are
// persisted server-side and drive the Mixes make-day plan. The server enforces
// the manager role on writes; this card is only rendered for managers.

import { Feather } from "@expo/vector-icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import React from "react";
import { Pressable, Switch, Text, TextInput, View } from "react-native";
import {
  DEFAULT_DAYS_EARLY,
  normalizeMix,
  mixMatchesQuery,
  groupMixesByBrand,
  type Mix,
  type MixComponent,
} from "@workspace/mixes";
import { FONTS } from "@/constants/fonts";
import { useColors } from "@/hooks/useColors";
import { useMixes } from "@/hooks/useMixes";
import { deleteMixes, saveMixes } from "@/context/mixes";

function genId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function blankMix(): Mix {
  return {
    id: genId(),
    name: "New Mix",
    brand: "",
    flavor: "",
    batchSize: 0,
    daysEarly: DEFAULT_DAYS_EARLY,
    notes: "",
    amountAlreadyMade: 0,
    components: [],
    enabled: true,
  };
}

export default function MixesManager({
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
  const { items, isLoading } = useMixes();
  const [error, setError] = React.useState<string | null>(null);
  // Browsing state: search + which brand groups / mix editors are open. With
  // dozens of imported mixes a flat list of full editors is unusable, so the
  // list is grouped by brand (collapsed by default) and each mix is a compact
  // row that expands to the full editor on tap. (Parity with web.)
  const [query, setQuery] = React.useState("");
  const [openBrands, setOpenBrands] = React.useState<Set<string>>(new Set());
  const [openMixes, setOpenMixes] = React.useState<Set<string>>(new Set());

  const searching = query.trim().length > 0;
  const groups = React.useMemo(() => {
    const filtered = items.filter((m) => mixMatchesQuery(m, query));
    return groupMixesByBrand(filtered);
  }, [items, query]);

  function toggleBrand(key: string) {
    setOpenBrands((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleMix(id: string) {
    setOpenMixes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const saveMutation = useMutation({
    mutationFn: (next: Mix[]) => saveMixes(next),
    onSuccess: (saved) => {
      qc.setQueryData(["mixes"], saved);
      setError(null);
    },
    onError: () =>
      setError("Could not save the mix. Check your connection and try again."),
  });

  const deleteMutation = useMutation({
    mutationFn: (ids: string[]) => deleteMixes(ids),
    onSuccess: (saved) => {
      qc.setQueryData(["mixes"], saved);
      setError(null);
    },
    onError: () =>
      setError("Could not delete the mix. Check your connection and try again."),
  });

  const busy = saveMutation.isPending || deleteMutation.isPending;

  function addMix() {
    const draft = blankMix();
    // Open the new mix (and its no-brand group) so it's immediately editable.
    setQuery("");
    setOpenBrands((prev) => new Set(prev).add(""));
    setOpenMixes((prev) => new Set(prev).add(draft.id));
    saveMutation.mutate([draft]);
  }

  return (
    <View style={{ gap: 12 }}>
      <Text style={{ fontFamily: FONTS.regular, fontSize: 12, color: colors.mutedForeground }}>
        Define pre-blended mixes made ahead for a product. Match a mix to a
        product by brand + flavor, set its batch size and components (lbs per
        pizza). The Mixes tab shows what to make for a chosen day — within the
        days-early window (default {DEFAULT_DAYS_EARLY}).
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
          Loading mixes…
        </Text>
      ) : items.length === 0 ? (
        <Text style={{ fontFamily: FONTS.regular, fontSize: 12, color: colors.mutedForeground }}>
          No mixes yet. Add one below.
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
              placeholder="Search mixes by name, brand, or flavor…"
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
              No mixes match "{query.trim()}".
            </Text>
          ) : (
            groups.map((group) => {
              const key = group.brand.toLowerCase();
              // While searching, matched groups stay open so results are
              // visible. A single lone group is always open.
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
                      {group.brand || "No brand"}
                    </Text>
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
                        {group.mixes.length}
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
                      {group.mixes.map((mix) => {
                        const expanded = openMixes.has(mix.id);
                        return (
                          <View key={mix.id} style={{ gap: 6 }}>
                            <Pressable
                              onPress={() => toggleMix(mix.id)}
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
                                {mix.name || "Unnamed mix"}
                              </Text>
                              {mix.flavor ? (
                                <Text
                                  numberOfLines={1}
                                  style={{
                                    flexShrink: 1,
                                    fontFamily: FONTS.regular,
                                    fontSize: 11,
                                    color: colors.mutedForeground,
                                  }}
                                >
                                  {mix.flavor}
                                </Text>
                              ) : null}
                              <View style={{ flex: 1 }} />
                              {!mix.enabled ? (
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
                              {mix.batchSize > 0 ? (
                                <Text
                                  style={{
                                    fontFamily: FONTS.mono,
                                    fontSize: 10,
                                    color: colors.mutedForeground,
                                  }}
                                >
                                  {mix.batchSize} lbs
                                </Text>
                              ) : null}
                            </Pressable>
                            {expanded ? (
                              <MixEditor
                                mix={mix}
                                disabled={busy}
                                brands={brands}
                                brandFlavors={brandFlavors}
                                ingredientSuggestions={ingredientSuggestions}
                                onChange={(next) => saveMutation.mutate([next])}
                                onDelete={() => deleteMutation.mutate([mix.id])}
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
          onPress={addMix}
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
            Add Mix
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function MixEditor({
  mix,
  disabled,
  brands,
  brandFlavors,
  ingredientSuggestions,
  onChange,
  onDelete,
}: {
  mix: Mix;
  disabled: boolean;
  brands: string[];
  brandFlavors: Record<string, string[]>;
  ingredientSuggestions: string[];
  onChange: (mix: Mix) => void;
  onDelete: () => void;
}) {
  const colors = useColors();
  // Local draft so component rows / numbers edit smoothly; commit on blur.
  const [draft, setDraft] = React.useState<Mix>(mix);

  // Keep the local draft in step when the upstream record changes (e.g. a
  // background poll or a save round-trip returns the canonical row).
  const signature = JSON.stringify(mix);
  const [lastSignature, setLastSignature] = React.useState(signature);
  if (signature !== lastSignature) {
    setLastSignature(signature);
    setDraft(mix);
  }

  function patch(p: Partial<Mix>) {
    setDraft((d) => ({ ...d, ...p }));
  }

  function commit(next: Mix = draft) {
    const clean = normalizeMix(next);
    if (clean) onChange({ ...clean, id: next.id, scope: next.scope });
  }

  function patchComponent(idx: number, p: Partial<MixComponent>) {
    setDraft((d) => ({
      ...d,
      components: d.components.map((c, i) => (i === idx ? { ...c, ...p } : c)),
    }));
  }

  function addComponent() {
    setDraft((d) => ({
      ...d,
      components: [...d.components, { ingredient: "", perPizza: 0 }],
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
          placeholder="Mix name…"
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

      {/* Product match: brand + flavor */}
      <ChipPicker
        label="Brand"
        value={draft.brand}
        options={brands}
        placeholder="Any brand"
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
      <ChipPicker
        label="Flavor"
        value={draft.flavor}
        options={flavorOptions}
        placeholder="Any flavor"
        disabled={disabled}
        onChange={(v) => {
          const next = { ...draft, flavor: v };
          setDraft(next);
          commit(next);
        }}
        onCommit={() => commit()}
        onChangeText={(t) => patch({ flavor: t })}
        inputStyle={inputStyle}
      />

      {/* Batch size, days early, amount already made */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <NumberField
          label="Batch size (lbs)"
          value={draft.batchSize}
          disabled={disabled}
          onChange={(v) => patch({ batchSize: v })}
          onCommit={() => commit()}
          inputStyle={inputStyle}
        />
        <NumberField
          label="Days early"
          value={draft.daysEarly}
          integer
          disabled={disabled}
          onChange={(v) => patch({ daysEarly: v })}
          onCommit={() => commit()}
          inputStyle={inputStyle}
        />
        <NumberField
          label="Already made (lbs)"
          value={draft.amountAlreadyMade}
          disabled={disabled}
          onChange={(v) => patch({ amountAlreadyMade: v })}
          onCommit={() => commit()}
          inputStyle={inputStyle}
        />
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
        <Text style={{ fontFamily: FONTS.medium, fontSize: 12, color: colors.mutedForeground }}>
          Components (oz per pizza)
        </Text>
        {draft.components.length === 0 ? (
          <Text style={{ fontFamily: FONTS.regular, fontSize: 12, color: colors.mutedForeground }}>
            No components yet.
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
                  value={String(c.perPizza)}
                  onChangeText={(t) =>
                    patchComponent(idx, { perPizza: Math.max(0, Number(t) || 0) })
                  }
                  onBlur={() => commit()}
                  keyboardType="decimal-pad"
                  editable={!disabled}
                  style={[inputStyle, { width: 90, fontFamily: FONTS.mono, textAlign: "center" }]}
                />
                <Text style={{ fontFamily: FONTS.regular, fontSize: 12, color: colors.mutedForeground }}>
                  oz/pizza
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
            Add component
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// A free-text input with quick-pick chips for known options (mirrors the web
// datalist: type anything, or tap a known brand/flavor/ingredient).
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
}) {
  const colors = useColors();
  const chips = React.useMemo(
    () =>
      Array.from(new Set(options.map((o) => o.trim()).filter(Boolean)))
        .filter((o) => o.toLowerCase() !== value.trim().toLowerCase())
        .sort((a, b) => a.localeCompare(b))
        .slice(0, 20),
    [options, value],
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

function NumberField({
  label,
  value,
  integer = false,
  disabled,
  onChange,
  onCommit,
  inputStyle,
}: {
  label: string;
  value: number;
  integer?: boolean;
  disabled: boolean;
  onChange: (v: number) => void;
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
        value={String(value)}
        onChangeText={(t) => {
          const raw = Number(t) || 0;
          onChange(Math.max(0, integer ? Math.trunc(raw) : raw));
        }}
        onBlur={onCommit}
        keyboardType={integer ? "number-pad" : "decimal-pad"}
        editable={!disabled}
        style={[inputStyle, { width: 120, fontFamily: FONTS.mono, textAlign: "center" }]}
      />
    </View>
  );
}
