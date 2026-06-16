import { Feather } from "@expo/vector-icons";
import React from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { useColors } from "@/hooks/useColors";
import { FONTS } from "@/constants/fonts";
import type { RecipeRow } from "@/context/RunContext";

export function MetricCard({
  label,
  value,
  sublabel,
  highlight,
  style,
}: {
  label: string;
  value: string;
  sublabel?: string;
  highlight?: boolean;
  style?: ViewStyle;
}) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.metricCard,
        {
          backgroundColor: colors.card,
          borderColor: highlight ? colors.primary : colors.border,
        },
        style,
      ]}
    >
      <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>
        {label}
      </Text>
      <Text
        style={[
          styles.metricValue,
          { color: highlight ? colors.primary : colors.foreground },
        ]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      {sublabel ? (
        <Text style={[styles.metricSublabel, { color: colors.mutedForeground }]}>
          {sublabel}
        </Text>
      ) : null}
    </View>
  );
}

export function BatchCard({
  name,
  batches,
  lbs,
  sub,
  style,
}: {
  name: string;
  batches: number;
  lbs: number;
  sub?: string;
  style?: ViewStyle;
}) {
  const colors = useColors();
  const active = batches > 0;
  return (
    <View
      style={[
        styles.batchCard,
        {
          backgroundColor: colors.card,
          borderColor: active ? colors.border : colors.border,
        },
        style,
      ]}
    >
      <Text style={[styles.batchName, { color: colors.mutedForeground }]}>
        {name.toUpperCase()}
      </Text>
      <Text
        style={[
          styles.batchCount,
          { color: active ? colors.foreground : colors.mutedForeground },
        ]}
      >
        {active ? batches : "—"}
      </Text>
      <Text style={[styles.batchUnit, { color: colors.mutedForeground }]}>
        {active ? `batches · ${lbs.toFixed(0)} lbs` : "batches"}
      </Text>
      {active && sub ? (
        <Text style={[styles.batchUnit, { color: colors.primary, marginTop: 2 }]}>
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

export function Stepper({
  label,
  value,
  onDecrement,
  onIncrement,
  min = 0,
}: {
  label: string;
  value: number;
  onDecrement: () => void;
  onIncrement: () => void;
  min?: number;
}) {
  const colors = useColors();
  return (
    <View style={[styles.stepperRow, { borderBottomColor: colors.border }]}>
      <Text style={[styles.stepperLabel, { color: colors.foreground }]}>
        {label}
      </Text>
      <View style={styles.stepperControls}>
        <Pressable
          onPress={onDecrement}
          disabled={value <= min}
          style={({ pressed }) => [
            styles.stepperBtn,
            {
              backgroundColor: colors.secondary,
              opacity: pressed || value <= min ? 0.4 : 1,
            },
          ]}
        >
          <Text style={[styles.stepperBtnText, { color: colors.foreground }]}>
            −
          </Text>
        </Pressable>
        <Text style={[styles.stepperValue, { color: colors.foreground }]}>
          {value}
        </Text>
        <Pressable
          onPress={onIncrement}
          style={({ pressed }) => [
            styles.stepperBtn,
            { backgroundColor: colors.secondary, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Text style={[styles.stepperBtnText, { color: colors.foreground }]}>
            +
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

export function SectionHeader({ title }: { title: string }) {
  const colors = useColors();
  return (
    <Text style={[styles.sectionHeader, { color: colors.mutedForeground }]}>
      {title.toUpperCase()}
    </Text>
  );
}

export function StatRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  const colors = useColors();
  return (
    <View style={[statRowStyles.row, { borderBottomColor: colors.border }]}>
      <Text
        style={[statRowStyles.label, { color: colors.mutedForeground }]}
        numberOfLines={1}
      >
        {label}
      </Text>
      <Text
        style={[
          statRowStyles.value,
          { color: highlight ? colors.primary : colors.foreground },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const statRowStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 9,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: { fontSize: 13, flexShrink: 1, fontFamily: FONTS.regular },
  value: {
    fontSize: 14,
    fontFamily: FONTS.mono,
    fontVariant: ["tabular-nums"],
    textAlign: "right",
  },
});

export function NumericField({
  label,
  value,
  onChangeText,
  onBlur,
  unit,
  placeholder = "0",
  inputProps,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  onBlur?: () => void;
  unit?: string;
  placeholder?: string;
  inputProps?: TextInputProps;
}) {
  const colors = useColors();
  return (
    <View style={[styles.fieldRow, { borderBottomColor: colors.border }]}>
      <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
        {label}
      </Text>
      <View style={styles.fieldRight}>
        <TextInput
          style={[styles.fieldInput, { color: colors.foreground }]}
          value={value}
          onChangeText={onChangeText}
          onBlur={onBlur}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedForeground}
          keyboardType="decimal-pad"
          textAlign="right"
          selectTextOnFocus
          {...inputProps}
        />
        {unit ? (
          <Text style={[styles.fieldUnit, { color: colors.mutedForeground }]}>
            {unit}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export function TextField({
  label,
  value,
  onChangeText,
  onBlur,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  onBlur?: () => void;
  placeholder?: string;
}) {
  const colors = useColors();
  return (
    <View style={[styles.fieldRow, { borderBottomColor: colors.border }]}>
      <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
        {label}
      </Text>
      <TextInput
        style={[styles.fieldInputText, { color: colors.foreground }]}
        value={value}
        onChangeText={onChangeText}
        onBlur={onBlur}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        textAlign="right"
        autoCapitalize="words"
        selectTextOnFocus
      />
    </View>
  );
}

export function CardSection({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.cardSection,
        { backgroundColor: colors.card, borderColor: colors.border },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Card({
  title,
  icon,
  accent = false,
  accentColor,
  children,
  style,
  contentStyle,
}: {
  title?: string;
  icon?: keyof typeof Feather.glyphMap;
  accent?: boolean;
  accentColor?: string;
  children: React.ReactNode;
  style?: ViewStyle;
  contentStyle?: ViewStyle;
}) {
  const colors = useColors();
  const showAccent = accent || !!accentColor;
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
        style,
      ]}
    >
      {showAccent ? (
        <View
          style={[
            styles.cardAccent,
            { backgroundColor: accentColor ?? colors.primary },
          ]}
        />
      ) : null}
      {title ? (
        <View style={styles.cardHeader}>
          {icon ? (
            <Feather name={icon} size={15} color={colors.mutedForeground} />
          ) : null}
          <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>
            {title.toUpperCase()}
          </Text>
        </View>
      ) : null}
      <View style={[styles.cardContent, contentStyle]}>{children}</View>
    </View>
  );
}

export function Button({
  label,
  onPress,
  icon,
  variant = "primary",
  disabled = false,
  size = "md",
  style,
}: {
  label: string;
  onPress: () => void;
  icon?: keyof typeof Feather.glyphMap;
  variant?: "primary" | "outline" | "destructive";
  disabled?: boolean;
  size?: "sm" | "md";
  style?: ViewStyle;
}) {
  const colors = useColors();
  const bg =
    variant === "primary"
      ? colors.primary
      : variant === "destructive"
        ? colors.destructive
        : "transparent";
  const fg =
    variant === "primary"
      ? colors.primaryForeground
      : variant === "destructive"
        ? colors.destructiveForeground
        : colors.foreground;
  const borderColor =
    variant === "outline" ? colors.border : "transparent";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        size === "sm" && styles.buttonSm,
        {
          backgroundColor: bg,
          borderColor,
          opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
        },
        style,
      ]}
    >
      {icon ? <Feather name={icon} size={size === "sm" ? 13 : 15} color={fg} /> : null}
      <Text
        style={[
          styles.buttonText,
          size === "sm" && styles.buttonTextSm,
          { color: fg },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export type FactoryPreset = { name: string; ingredients: RecipeRow[] };

export function RecipeEditor({
  rows,
  onChange,
  ingredientOptions,
  name,
  onNameChange,
  presetNames,
  onSavePreset,
  onApplyPreset,
  onDeletePreset,
  effectiveLabel = "Effective batch",
  factoryPresets,
  onApplyFactory,
  factoryLabel = "Factory mixes for this brand + flavor",
  onSaveMix,
  batchScale = false,
}: {
  rows: RecipeRow[];
  onChange: (rows: RecipeRow[]) => void;
  ingredientOptions: string[];
  name: string;
  onNameChange: (n: string) => void;
  presetNames: string[];
  onSavePreset: () => void;
  onApplyPreset: (name: string) => void;
  onDeletePreset: (name: string) => void;
  effectiveLabel?: string;
  factoryPresets?: FactoryPreset[];
  onApplyFactory?: (preset: FactoryPreset) => void;
  factoryLabel?: string;
  onSaveMix?: () => void;
  batchScale?: boolean;
}) {
  const colors = useColors();
  const total = rows.reduce((s, r) => s + (Number(r.lbs) || 0), 0);
  // Batch-size scaler: "4" is the base recipe (1×); other sizes scale the
  // displayed weights for quick reference. Editing is only allowed at base.
  const SCALE_OPTIONS: { label: string; value: number }[] = [
    { label: "½", value: 0.5 },
    { label: "4", value: 1 },
    { label: "5", value: 1.25 },
    { label: "6", value: 1.5 },
  ];
  const [scale, setScale] = React.useState(1);
  const effScale = batchScale ? scale : 1;

  const setRow = (i: number, patch: Partial<RecipeRow>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeRow = (i: number) => onChange(rows.filter((_, idx) => idx !== i));
  const addRow = (ingredient = "") =>
    onChange([...rows, { ingredient, lbs: 0 }]);

  return (
    <View style={recipeStyles.wrap}>
      {/* Recipe name + save preset */}
      {effScale === 1 ? (
      <View style={recipeStyles.nameRow}>
        <TextInput
          style={[
            recipeStyles.nameInput,
            { color: colors.foreground, borderColor: colors.border },
          ]}
          value={name}
          onChangeText={onNameChange}
          placeholder="Recipe name…"
          placeholderTextColor={colors.mutedForeground}
          autoCapitalize="words"
        />
        <Pressable
          onPress={onSavePreset}
          disabled={!name.trim() || rows.length === 0}
          style={({ pressed }) => [
            recipeStyles.savePresetBtn,
            {
              backgroundColor: colors.secondary,
              borderColor: colors.border,
              opacity:
                !name.trim() || rows.length === 0 ? 0.4 : pressed ? 0.6 : 1,
            },
          ]}
        >
          <Feather name="bookmark" size={13} color={colors.foreground} />
          <Text style={[recipeStyles.savePresetText, { color: colors.foreground }]}>
            Save
          </Text>
        </Pressable>
        {onSaveMix ? (
          <Pressable
            onPress={onSaveMix}
            disabled={!name.trim() || rows.length === 0}
            style={({ pressed }) => [
              recipeStyles.savePresetBtn,
              {
                backgroundColor: colors.secondary,
                borderColor: colors.primary,
                opacity:
                  !name.trim() || rows.length === 0 ? 0.4 : pressed ? 0.6 : 1,
              },
            ]}
          >
            <Feather name="zap" size={13} color={colors.primary} />
            <Text style={[recipeStyles.savePresetText, { color: colors.primary }]}>
              Save as mix
            </Text>
          </Pressable>
        ) : null}
      </View>
      ) : null}

      {/* Preset chips */}
      {effScale === 1 && presetNames.length > 0 ? (
        <View style={recipeStyles.presetRow}>
          {presetNames.map((p) => (
            <View
              key={p}
              style={[
                recipeStyles.presetChip,
                { borderColor: colors.border, backgroundColor: colors.secondary },
              ]}
            >
              <Pressable onPress={() => onApplyPreset(p)} hitSlop={4}>
                <Text style={[recipeStyles.presetChipText, { color: colors.foreground }]}>
                  {p}
                </Text>
              </Pressable>
              <Pressable onPress={() => onDeletePreset(p)} hitSlop={6}>
                <Feather name="x" size={12} color={colors.mutedForeground} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      {/* Factory mix presets matching brand + flavor */}
      {effScale === 1 && factoryPresets && factoryPresets.length > 0 ? (
        <View style={recipeStyles.factoryWrap}>
          <Text style={[recipeStyles.factoryLabel, { color: colors.mutedForeground }]}>
            {factoryLabel}
          </Text>
          <View style={recipeStyles.presetRow}>
            {factoryPresets.map((fp) => (
              <Pressable
                key={fp.name}
                onPress={() => onApplyFactory?.(fp)}
                style={({ pressed }) => [
                  recipeStyles.factoryChip,
                  {
                    borderColor: colors.primary,
                    opacity: pressed ? 0.6 : 1,
                  },
                ]}
              >
                <Feather name="zap" size={11} color={colors.primary} />
                <Text style={[recipeStyles.factoryChipText, { color: colors.foreground }]}>
                  {fp.name}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {/* Batch-size scaler */}
      {batchScale ? (
        <View style={recipeStyles.scaleRow}>
          <Text style={[recipeStyles.scaleLabel, { color: colors.mutedForeground }]}>
            Batch size
          </Text>
          <View style={[recipeStyles.scaleGroup, { backgroundColor: colors.secondary }]}>
            {SCALE_OPTIONS.map((opt) => {
              const active = scale === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => setScale(opt.value)}
                  style={[
                    recipeStyles.scaleBtn,
                    active && { backgroundColor: colors.primary },
                  ]}
                >
                  <Text
                    style={[
                      recipeStyles.scaleBtnText,
                      { color: active ? "#fff" : colors.foreground },
                    ]}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {scale !== 1 ? (
            <Text style={[recipeStyles.scaleHint, { color: colors.mutedForeground }]}>
              ×{scale} · view only
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* Ingredient rows */}
      {rows.map((row, i) => (
        <View key={i} style={recipeStyles.row}>
          <TextInput
            style={[
              recipeStyles.ingInput,
              { color: colors.foreground, borderColor: colors.border },
            ]}
            value={row.ingredient}
            onChangeText={(t) => setRow(i, { ingredient: t })}
            placeholder="Ingredient"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="words"
            editable={effScale === 1}
          />
          {effScale === 1 ? (
            <TextInput
              style={[
                recipeStyles.lbsInput,
                { color: colors.foreground, borderColor: colors.border },
              ]}
              value={row.lbs > 0 ? String(row.lbs) : ""}
              onChangeText={(t) => {
                const n = parseFloat(t);
                setRow(i, { lbs: isNaN(n) ? 0 : n });
              }}
              placeholder="0"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="decimal-pad"
              textAlign="right"
              selectTextOnFocus
            />
          ) : (
            <View
              style={[
                recipeStyles.lbsInput,
                recipeStyles.lbsReadonly,
                { borderColor: colors.border },
              ]}
            >
              <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>
                {(Number(row.lbs) || 0) > 0
                  ? ((Number(row.lbs) || 0) * effScale).toFixed(1)
                  : "0"}
              </Text>
            </View>
          )}
          <Text style={[recipeStyles.lbsUnit, { color: colors.mutedForeground }]}>
            lbs
          </Text>
          {effScale === 1 ? (
            <Pressable onPress={() => removeRow(i)} hitSlop={6}>
              <Feather name="trash-2" size={16} color="#ef4444" />
            </Pressable>
          ) : null}
        </View>
      ))}

      {/* Quick-add ingredient chips */}
      {effScale === 1 && ingredientOptions.length > 0 ? (
        <View style={recipeStyles.quickRow}>
          {ingredientOptions.map((opt) => (
            <Pressable
              key={opt}
              onPress={() => addRow(opt)}
              style={({ pressed }) => [
                recipeStyles.quickChip,
                {
                  borderColor: colors.border,
                  opacity: pressed ? 0.6 : 1,
                },
              ]}
            >
              <Feather name="plus" size={11} color={colors.primary} />
              <Text style={[recipeStyles.quickChipText, { color: colors.foreground }]}>
                {opt}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {effScale === 1 ? (
        <Pressable
          onPress={() => addRow()}
          style={({ pressed }) => [
            recipeStyles.addRowBtn,
            { borderColor: colors.primary, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Feather name="plus" size={14} color={colors.primary} />
          <Text style={[recipeStyles.addRowText, { color: colors.primary }]}>
            Add ingredient
          </Text>
        </Pressable>
      ) : null}

      <View style={[recipeStyles.totalRow, { borderTopColor: colors.border }]}>
        <Text style={[recipeStyles.totalLabel, { color: colors.mutedForeground }]}>
          {effectiveLabel}
        </Text>
        <Text style={[recipeStyles.totalValue, { color: colors.primary }]}>
          {total > 0 ? `${(total * effScale).toFixed(1)} lbs` : "—"}
        </Text>
      </View>
    </View>
  );
}

export function ReadOnlyRecipe({
  rows,
  emptyText = "No recipe configured. Add ingredients in Setup.",
}: {
  rows: RecipeRow[];
  emptyText?: string;
}) {
  const colors = useColors();
  const filtered = (rows ?? []).filter(
    (r) => (r.ingredient ?? "").trim() !== "" || (Number(r.lbs) || 0) > 0,
  );
  const total = filtered.reduce((s, r) => s + (Number(r.lbs) || 0), 0);
  if (filtered.length === 0) {
    return (
      <Text style={[roStyles.empty, { color: colors.mutedForeground }]}>
        {emptyText}
      </Text>
    );
  }
  return (
    <View style={roStyles.wrap}>
      <View style={roStyles.headRow}>
        <Text style={[roStyles.headIng, { color: colors.mutedForeground }]}>
          INGREDIENT
        </Text>
        <Text style={[roStyles.headLbs, { color: colors.mutedForeground }]}>
          LBS / BATCH
        </Text>
      </View>
      {filtered.map((r, i) => (
        <View
          key={i}
          style={[roStyles.row, { borderBottomColor: colors.border }]}
        >
          <Text style={[roStyles.ing, { color: colors.foreground }]}>
            {r.ingredient || "—"}
          </Text>
          <Text style={[roStyles.lbs, { color: colors.foreground }]}>
            {(Number(r.lbs) || 0).toFixed(1)}
          </Text>
        </View>
      ))}
      <View style={[roStyles.totalRow, { borderTopColor: colors.border }]}>
        <Text style={[roStyles.totalLabel, { color: colors.mutedForeground }]}>
          Total / Batch
        </Text>
        <Text style={[roStyles.totalValue, { color: colors.foreground }]}>
          {total.toFixed(1)} lbs
        </Text>
      </View>
    </View>
  );
}

const roStyles = StyleSheet.create({
  wrap: { gap: 0 },
  empty: { fontSize: 13, fontStyle: "italic" },
  headRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
    paddingHorizontal: 2,
  },
  headIng: { fontSize: 10, fontFamily: FONTS.bold, letterSpacing: 0.6 },
  headLbs: { fontSize: 10, fontFamily: FONTS.bold, letterSpacing: 0.6 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  ing: { fontSize: 14, flex: 1, paddingRight: 8, fontFamily: FONTS.regular },
  lbs: { fontSize: 14, fontFamily: FONTS.mono, fontVariant: ["tabular-nums"] },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    paddingTop: 10,
    marginTop: 6,
    paddingHorizontal: 2,
  },
  totalLabel: { fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, fontFamily: FONTS.semibold },
  totalValue: { fontSize: 14, fontFamily: FONTS.monoBold, fontVariant: ["tabular-nums"] },
});

const recipeStyles = StyleSheet.create({
  wrap: { gap: 10 },
  nameRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  nameInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    fontFamily: FONTS.regular,
  },
  savePresetBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  savePresetText: { fontSize: 13, fontFamily: FONTS.semibold },
  presetRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  presetChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  presetChipText: { fontSize: 12, fontFamily: FONTS.medium },
  factoryWrap: { gap: 6 },
  factoryLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    fontFamily: FONTS.regular,
  },
  factoryChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  factoryChipText: { fontSize: 12, fontFamily: FONTS.medium },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  ingInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 14,
    fontFamily: FONTS.regular,
  },
  lbsInput: {
    width: 64,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 7,
    fontSize: 14,
    fontFamily: FONTS.mono,
  },
  lbsReadonly: { alignItems: "flex-end", justifyContent: "center" },
  lbsUnit: { fontSize: 12, width: 22, fontFamily: FONTS.regular },
  scaleRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  scaleLabel: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, fontFamily: FONTS.regular },
  scaleGroup: { flexDirection: "row", borderRadius: 4, padding: 3, gap: 3 },
  scaleBtn: {
    minWidth: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  scaleBtnText: { fontSize: 13, fontFamily: FONTS.bold },
  scaleHint: { fontSize: 11, fontFamily: FONTS.regular },
  quickRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  quickChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  quickChipText: { fontSize: 11, fontFamily: FONTS.regular },
  addRowBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 4,
    paddingVertical: 9,
  },
  addRowText: { fontSize: 13, fontFamily: FONTS.semibold },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    paddingTop: 10,
  },
  totalLabel: { fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, fontFamily: FONTS.semibold },
  totalValue: { fontSize: 16, fontFamily: FONTS.monoBold },
});

const styles = StyleSheet.create({
  metricCard: {
    borderRadius: 8,
    padding: 14,
    borderWidth: 1,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  metricLabel: {
    fontSize: 10,
    fontFamily: FONTS.semibold,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 4,
    textAlign: "center",
  },
  metricValue: {
    fontSize: 32,
    fontFamily: FONTS.bold,
    textAlign: "center",
  },
  metricSublabel: {
    fontSize: 11,
    marginTop: 3,
    textAlign: "center",
    fontFamily: FONTS.regular,
  },

  batchCard: {
    borderRadius: 8,
    padding: 14,
    borderWidth: 1,
    flex: 1,
    alignItems: "flex-start",
  },
  batchName: {
    fontSize: 10,
    fontFamily: FONTS.semibold,
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  batchCount: {
    fontSize: 40,
    fontFamily: FONTS.monoBold,
    lineHeight: 44,
  },
  batchUnit: { fontSize: 11, marginTop: 2, fontFamily: FONTS.regular },

  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  stepperLabel: { fontSize: 16, fontFamily: FONTS.medium, flex: 1 },
  stepperControls: { flexDirection: "row", alignItems: "center", gap: 14 },
  stepperBtn: {
    width: 36,
    height: 36,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperBtnText: {
    fontSize: 22,
    fontFamily: FONTS.regular,
    lineHeight: 24,
    includeFontPadding: false,
  },
  stepperValue: {
    fontSize: 20,
    fontFamily: FONTS.monoBold,
    minWidth: 34,
    textAlign: "center",
  },

  sectionHeader: {
    fontSize: 11,
    fontFamily: FONTS.semibold,
    letterSpacing: 1,
    marginTop: 22,
    marginBottom: 10,
  },

  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  fieldLabel: { fontSize: 16, fontFamily: FONTS.medium, flex: 1 },
  fieldRight: { flexDirection: "row", alignItems: "center", gap: 4 },
  fieldInput: {
    fontSize: 16,
    minWidth: 70,
    fontFamily: FONTS.mono,
    padding: Platform.OS === "web" ? 4 : 0,
  },
  fieldInputText: {
    fontSize: 16,
    minWidth: 130,
    fontFamily: FONTS.medium,
    textAlign: "right",
    padding: Platform.OS === "web" ? 4 : 0,
  },
  fieldUnit: { fontSize: 13, fontFamily: FONTS.regular },

  cardSection: {
    borderRadius: 8,
    paddingHorizontal: 16,
    borderWidth: 1,
  },

  card: {
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
  },
  cardAccent: { height: 3, width: "100%" },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 2,
  },
  cardTitle: { fontSize: 12, fontFamily: FONTS.semibold, letterSpacing: 1 },
  cardContent: { paddingHorizontal: 16, paddingVertical: 12 },

  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  buttonSm: { paddingHorizontal: 10, paddingVertical: 6 },
  buttonText: { fontSize: 14, fontFamily: FONTS.semibold },
  buttonTextSm: { fontSize: 12 },
});
