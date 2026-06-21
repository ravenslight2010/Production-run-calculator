import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Card, Button, SelectField } from "@/components/UI";
import { useColors } from "@/hooks/useColors";
import { FONTS } from "@/constants/fonts";
import type {
  IngredientSubstitution,
  SubstitutionAction,
} from "@workspace/inventory-math";

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Plain-language description of a single active substitution, shown in the list
// and in the recipe badge. Verbatim mirror of web's describeSubstitution.
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
// Mobile mirror of web's SubstitutionsManager.
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
  const colors = useColors();
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
  const canAdd =
    ingredient.trim().length > 0 &&
    (!needsSubstitute || substitute.trim().length > 0);

  function submit() {
    if (!canAdd) return;
    const amtNum = Number(amount);
    const sub: IngredientSubstitution = {
      id: genId(),
      ingredient: ingredient.trim(),
      action,
      ...(needsSubstitute ? { substitute: substitute.trim() } : {}),
      ...(needsSubstitute &&
      amount.trim() !== "" &&
      Number.isFinite(amtNum) &&
      amtNum > 0
        ? { amount: amtNum }
        : {}),
    };
    onAdd(sub);
    setIngredient("");
    setSubstitute("");
    setAmount("");
    setAction("swap");
  }

  const amberBg = "rgba(245,158,11,0.12)";
  const amberBorder = "rgba(245,158,11,0.4)";
  const amber = colors.warning;

  return (
    <Card title="Temporary Substitutions" icon="repeat" style={{ marginBottom: 16 }}>
      <Text style={[styles.hint, { color: colors.mutedForeground }]}>
        Swap, add, or remove an ingredient for today only. Applies to every run
        that uses it and reverts automatically at the daily reset.
      </Text>

      {/* Active list */}
      {substitutions.length > 0 && (
        <View style={{ gap: 6, marginBottom: 12 }}>
          {substitutions.map((s) => (
            <View
              key={s.id}
              style={[
                styles.activeRow,
                { backgroundColor: amberBg, borderColor: amberBorder },
              ]}
            >
              <Text
                style={[styles.activeText, { color: amber }]}
                numberOfLines={2}
              >
                {describeSubstitution(s)}
              </Text>
              <Pressable
                onPress={() => onRemove(s.id)}
                hitSlop={8}
                style={styles.activeRemove}
              >
                <Feather name="x" size={15} color={amber} />
              </Pressable>
            </View>
          ))}
          <Pressable onPress={onClearAll} style={styles.clearAll}>
            <Text style={[styles.clearAllText, { color: colors.mutedForeground }]}>
              Clear all
            </Text>
          </Pressable>
        </View>
      )}

      {/* Action selector */}
      <View style={styles.actionRow}>
        {ACTIONS.map((a) => {
          const active = action === a.value;
          return (
            <Pressable
              key={a.value}
              onPress={() => setAction(a.value)}
              style={[
                styles.actionBtn,
                {
                  borderColor: active ? amberBorder : colors.border,
                  backgroundColor: active ? amberBg : "transparent",
                },
              ]}
            >
              <Text
                style={[
                  styles.actionBtnText,
                  { color: active ? amber : colors.mutedForeground },
                ]}
              >
                {a.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Ingredient picker (free text allowed via add) */}
      <View style={{ marginBottom: 8 }}>
        <SelectField
          value={ingredient}
          onChange={setIngredient}
          options={ingredientOptions}
          allowAdd
          placeholder={
            action === "add" ? "Recipe / ingredient to add to" : "Ingredient to replace"
          }
        />
      </View>

      {needsSubstitute && (
        <View style={{ marginBottom: 10 }}>
          <SelectField
            value={substitute}
            onChange={setSubstitute}
            options={ingredientOptions}
            allowAdd
            placeholder={
              action === "add" ? "Ingredient to add" : "Replacement ingredient"
            }
          />
          <TextInput
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            placeholder="lbs (optional)"
            placeholderTextColor={colors.mutedForeground}
            style={[
              styles.amountInput,
              {
                borderColor: colors.border,
                color: colors.foreground,
                backgroundColor: colors.secondary,
              },
            ]}
          />
        </View>
      )}

      <Button label="Apply substitution" onPress={submit} disabled={!canAdd} />
    </Card>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 12, lineHeight: 17, marginBottom: 12, fontFamily: FONTS.regular },
  activeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  activeText: { flex: 1, fontSize: 13, fontFamily: FONTS.medium },
  activeRemove: { padding: 2 },
  clearAll: { alignSelf: "flex-end", paddingVertical: 2 },
  clearAllText: { fontSize: 12, fontFamily: FONTS.semibold, textDecorationLine: "underline" },
  actionRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  actionBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
  },
  actionBtnText: { fontSize: 12, fontFamily: FONTS.semibold },
  amountInput: {
    height: 42,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 15,
    fontFamily: FONTS.regular,
    marginTop: 8,
  },
});
