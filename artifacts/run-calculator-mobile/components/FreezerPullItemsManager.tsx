// Manager-only editor for factory-wide freezer-pull items (mobile parity with
// the web FreezerPullItemsManager). Each item names an ingredient that must be
// pulled from the freezer `daysEarly` days before the run that uses it (default
// 3). Items are persisted server-side and drive the "Pull Out Freezer" notices
// on the Warehouse tab. The server enforces the manager role on writes; this
// card is only rendered for managers.
//
// `suggestions` are existing ingredient/type names from the app's master lists,
// so a manager can tag a known ingredient in one tap instead of retyping it.

import { Feather } from "@expo/vector-icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import React from "react";
import { Pressable, Switch, Text, TextInput, View } from "react-native";
import {
  DEFAULT_DAYS_EARLY,
  type FreezerPullItem,
} from "@workspace/freezer-pull";
import { FONTS } from "@/constants/fonts";
import { useColors } from "@/hooks/useColors";
import { useFreezerPullItems } from "@/hooks/useFreezerPullItems";
import {
  deleteFreezerPullItems,
  saveFreezerPullItems,
} from "@/context/freezerPull";

function genId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export default function FreezerPullItemsManager({
  suggestions = [],
}: {
  suggestions?: string[];
}) {
  const colors = useColors();
  const qc = useQueryClient();
  const { items, isLoading } = useFreezerPullItems();
  const [error, setError] = React.useState<string | null>(null);
  const [newName, setNewName] = React.useState("");

  const tagged = React.useMemo(
    () => new Set(items.map((i) => i.ingredient.trim().toLowerCase())),
    [items],
  );
  const quickAdd = React.useMemo(
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
    <View style={{ gap: 12 }}>
      <Text style={{ fontFamily: FONTS.regular, fontSize: 12, color: colors.mutedForeground }}>
        Tag ingredients that must be pulled from the freezer ahead of time. Each
        item is pulled N days before a scheduled run that uses it (default{" "}
        {DEFAULT_DAYS_EARLY}). The Warehouse tab shows a "Pull Out Freezer" card
        once it's time.
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
          Loading items…
        </Text>
      ) : items.length === 0 ? (
        <Text style={{ fontFamily: FONTS.regular, fontSize: 12, color: colors.mutedForeground }}>
          No freezer-pull items yet. Add one below.
        </Text>
      ) : (
        <View style={{ gap: 10 }}>
          {items.map((item) => (
            <ItemEditor
              key={item.id}
              item={item}
              disabled={busy}
              onChange={(next) => saveMutation.mutate([next])}
              onDelete={() => deleteMutation.mutate([item.id])}
            />
          ))}
        </View>
      )}

      {/* Add by typing */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 4 }}>
        <TextInput
          value={newName}
          onChangeText={setNewName}
          onSubmitEditing={() => addItem(newName)}
          placeholder="Ingredient name…"
          placeholderTextColor={colors.mutedForeground}
          editable={!busy}
          style={{
            flex: 1,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.background,
            color: colors.foreground,
            paddingHorizontal: 10,
            paddingVertical: 8,
            fontFamily: FONTS.regular,
            fontSize: 13,
          }}
        />
        <Pressable
          onPress={() => addItem(newName)}
          disabled={busy || !newName.trim()}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderRadius: 8,
            backgroundColor: colors.primary,
            opacity: busy || !newName.trim() ? 0.5 : 1,
          }}
        >
          <Feather name="plus" size={14} color={colors.primaryForeground} />
          <Text style={{ fontFamily: FONTS.bold, fontSize: 13, color: colors.primaryForeground }}>
            Add
          </Text>
        </Pressable>
      </View>

      {/* One-tap add from existing ingredient lists */}
      {quickAdd.length > 0 ? (
        <View style={{ gap: 6 }}>
          <Text style={{ fontFamily: FONTS.medium, fontSize: 11, color: colors.mutedForeground }}>
            Add from existing ingredients
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {quickAdd.slice(0, 30).map((s) => (
              <Pressable
                key={s}
                onPress={() => addItem(s)}
                disabled={busy}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.secondary,
                  opacity: busy ? 0.5 : 1,
                }}
              >
                <Feather name="plus" size={11} color={colors.mutedForeground} />
                <Text style={{ fontFamily: FONTS.regular, fontSize: 11, color: colors.mutedForeground }}>
                  {s}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </View>
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
  const colors = useColors();
  const patch = (p: Partial<FreezerPullItem>) => onChange({ ...item, ...p });

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
      <TextInput
        value={item.ingredient}
        onChangeText={(t) => patch({ ingredient: t })}
        editable={!disabled}
        style={{
          borderRadius: 8,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.background,
          color: colors.foreground,
          paddingHorizontal: 10,
          paddingVertical: 8,
          fontFamily: FONTS.medium,
          fontSize: 13,
        }}
      />
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={{ fontFamily: FONTS.regular, fontSize: 12, color: colors.mutedForeground }}>
            pull
          </Text>
          <TextInput
            value={String(item.daysEarly)}
            onChangeText={(t) =>
              patch({ daysEarly: Math.max(0, Math.trunc(Number(t) || 0)) })
            }
            keyboardType="number-pad"
            editable={!disabled}
            style={{
              width: 56,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.background,
              color: colors.foreground,
              paddingHorizontal: 8,
              paddingVertical: 6,
              fontFamily: FONTS.mono,
              fontSize: 13,
              textAlign: "center",
            }}
          />
          <Text style={{ fontFamily: FONTS.regular, fontSize: 12, color: colors.mutedForeground }}>
            days early
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Switch
            value={item.enabled}
            onValueChange={(v) => patch({ enabled: v })}
            disabled={disabled}
          />
          <Pressable onPress={onDelete} disabled={disabled} hitSlop={8}>
            <Feather name="trash-2" size={16} color="#f87171" />
          </Pressable>
        </View>
      </View>
    </View>
  );
}
