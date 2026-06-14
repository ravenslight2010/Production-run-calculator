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
  style,
}: {
  name: string;
  batches: number;
  lbs: number;
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

const styles = StyleSheet.create({
  metricCard: {
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  metricLabel: {
    fontSize: 10,
    fontWeight: "600" as const,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 4,
    textAlign: "center",
  },
  metricValue: {
    fontSize: 32,
    fontWeight: "700" as const,
    textAlign: "center",
  },
  metricSublabel: {
    fontSize: 11,
    marginTop: 3,
    textAlign: "center",
  },

  batchCard: {
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    flex: 1,
    alignItems: "flex-start",
  },
  batchName: {
    fontSize: 10,
    fontWeight: "600" as const,
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  batchCount: {
    fontSize: 40,
    fontWeight: "700" as const,
    lineHeight: 44,
  },
  batchUnit: { fontSize: 11, marginTop: 2 },

  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  stepperLabel: { fontSize: 16, fontWeight: "500" as const, flex: 1 },
  stepperControls: { flexDirection: "row", alignItems: "center", gap: 14 },
  stepperBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperBtnText: {
    fontSize: 22,
    fontWeight: "300" as const,
    lineHeight: 24,
    includeFontPadding: false,
  },
  stepperValue: {
    fontSize: 20,
    fontWeight: "600" as const,
    minWidth: 34,
    textAlign: "center",
  },

  sectionHeader: {
    fontSize: 11,
    fontWeight: "600" as const,
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
  fieldLabel: { fontSize: 16, fontWeight: "500" as const, flex: 1 },
  fieldRight: { flexDirection: "row", alignItems: "center", gap: 4 },
  fieldInput: {
    fontSize: 16,
    minWidth: 70,
    fontWeight: "500" as const,
    padding: Platform.OS === "web" ? 4 : 0,
  },
  fieldInputText: {
    fontSize: 16,
    minWidth: 130,
    fontWeight: "500" as const,
    textAlign: "right",
    padding: Platform.OS === "web" ? 4 : 0,
  },
  fieldUnit: { fontSize: 13 },

  cardSection: {
    borderRadius: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
  },
});
