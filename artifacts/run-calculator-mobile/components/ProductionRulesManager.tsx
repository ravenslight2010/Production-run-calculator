// Manager-only editor for factory-wide production rules (mobile parity with the
// web ProductionRulesManager). Rules are persisted server-side and evaluated on
// the Run/Configure tabs — "flexible" rules warn, "strict" rules block starting
// a run. The server enforces the manager role on writes; this card is only
// rendered for managers.

import { Feather } from "@expo/vector-icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import React from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import {
  defaultRuleName,
  newRule,
  RULE_ATTRIBUTES,
  RULE_FIELDS,
  ruleAttributeDef,
  type ProductionRule,
  type RuleType,
} from "@workspace/production-rules";
import { SelectField } from "@/components/UI";
import { FONTS } from "@/constants/fonts";
import { useColors } from "@/hooks/useColors";
import { useProductionRules } from "@/hooks/useProductionRules";
import {
  deleteProductionRules,
  saveProductionRules,
} from "@/context/productionRules";

const TYPE_LABELS: Record<RuleType, string> = {
  "required-field": "Required field",
  "numeric-range": "Numeric range",
  sequence: "Sequence (allergen-style)",
};

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export default function ProductionRulesManager() {
  const colors = useColors();
  const qc = useQueryClient();
  const { rules, isLoading } = useProductionRules();
  const [addType, setAddType] = React.useState<RuleType>("required-field");
  const [error, setError] = React.useState<string | null>(null);

  const numberFieldKeys = RULE_FIELDS.filter((f) => f.kind === "number").map(
    (f) => f.key,
  );

  const saveMutation = useMutation({
    mutationFn: (next: ProductionRule[]) => saveProductionRules(next),
    onSuccess: (saved) => {
      qc.setQueryData(["productionRules"], saved);
      setError(null);
    },
    onError: () => setError("Could not save the rule. Check your connection."),
  });

  const deleteMutation = useMutation({
    mutationFn: (ids: string[]) => deleteProductionRules(ids),
    onSuccess: (saved) => {
      qc.setQueryData(["productionRules"], saved);
      setError(null);
    },
    onError: () => setError("Could not delete the rule. Check your connection."),
  });

  const busy = saveMutation.isPending || deleteMutation.isPending;
  const upsert = (rule: ProductionRule) => saveMutation.mutate([rule]);

  return (
    <View style={{ gap: 12 }}>
      <Text
        style={{ fontFamily: FONTS.regular, fontSize: 12, color: colors.mutedForeground }}
      >
        Factory-wide checks on each run. Flexible rules warn the operator; Strict
        rules block starting the run until fixed.
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
          Loading rules…
        </Text>
      ) : rules.length === 0 ? (
        <Text style={{ fontFamily: FONTS.regular, fontSize: 12, color: colors.mutedForeground }}>
          No rules yet. Add one below.
        </Text>
      ) : (
        <View style={{ gap: 10 }}>
          {rules.map((rule) => (
            <RuleEditor
              key={rule.id}
              rule={rule}
              disabled={busy}
              numberFieldKeys={numberFieldKeys}
              onChange={upsert}
              onDelete={() => deleteMutation.mutate([rule.id])}
            />
          ))}
        </View>
      )}

      <View style={{ gap: 8, paddingTop: 4 }}>
        <SelectField
          label="New rule type"
          value={addType}
          onChange={(v) => setAddType(v as RuleType)}
          options={Object.keys(TYPE_LABELS)}
          optionLabel={(v) => TYPE_LABELS[v as RuleType]}
          allowAdd={false}
        />
        <Pressable
          onPress={() => upsert(newRule(genId(), addType))}
          disabled={busy}
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            paddingVertical: 10,
            borderRadius: 8,
            backgroundColor: colors.primary,
            opacity: busy ? 0.5 : 1,
          }}
        >
          <Feather name="plus" size={16} color={colors.primaryForeground} />
          <Text style={{ fontFamily: FONTS.bold, fontSize: 13, color: colors.primaryForeground }}>
            Add rule
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function RuleEditor({
  rule,
  disabled,
  numberFieldKeys,
  onChange,
  onDelete,
}: {
  rule: ProductionRule;
  disabled: boolean;
  numberFieldKeys: string[];
  onChange: (rule: ProductionRule) => void;
  onDelete: () => void;
}) {
  const colors = useColors();
  const attr = ruleAttributeDef(rule.attribute) ?? RULE_ATTRIBUTES[0];
  const patch = (p: Partial<ProductionRule>) => onChange({ ...rule, ...p });

  const strict = rule.enforcement === "strict";

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
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <TextInput
          style={{
            flex: 1,
            fontFamily: FONTS.bold,
            fontSize: 13,
            color: colors.foreground,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 8,
            paddingHorizontal: 10,
            paddingVertical: 8,
          }}
          value={rule.name}
          placeholder={defaultRuleName(rule.type)}
          placeholderTextColor={colors.mutedForeground}
          onChangeText={(t) => patch({ name: t })}
          editable={!disabled}
        />
        <Pressable onPress={onDelete} disabled={disabled} hitSlop={6}>
          <Feather name="trash-2" size={16} color="#f87171" />
        </Pressable>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Pressable
          onPress={() => patch({ enforcement: strict ? "flexible" : "strict" })}
          disabled={disabled}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: strict ? "#dc2626" : "#d97706",
            backgroundColor: strict ? "#dc262622" : "#d9770622",
          }}
        >
          <Feather
            name={strict ? "alert-octagon" : "shield"}
            size={13}
            color={strict ? "#fca5a5" : "#fcd34d"}
          />
          <Text
            style={{
              fontFamily: FONTS.bold,
              fontSize: 12,
              color: strict ? "#fca5a5" : "#fcd34d",
            }}
          >
            {strict ? "Strict (blocks start)" : "Flexible (warn)"}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => patch({ enabled: !rule.enabled })}
          disabled={disabled}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Feather
            name={rule.enabled ? "check-square" : "square"}
            size={13}
            color={rule.enabled ? colors.primary : colors.mutedForeground}
          />
          <Text style={{ fontFamily: FONTS.regular, fontSize: 12, color: colors.foreground }}>
            {rule.enabled ? "On" : "Off"}
          </Text>
        </Pressable>
      </View>

      {rule.type === "required-field" ? (
        <SelectField
          label="Field must be set"
          value={rule.field ?? RULE_FIELDS[0].key}
          onChange={(v) => patch({ field: v })}
          options={RULE_FIELDS.map((f) => f.key)}
          optionLabel={(v) => RULE_FIELDS.find((f) => f.key === v)?.label ?? v}
          allowAdd={false}
        />
      ) : null}

      {rule.type === "numeric-range" ? (
        <View style={{ gap: 8 }}>
          <SelectField
            label="Field"
            value={
              numberFieldKeys.includes(rule.field ?? "")
                ? (rule.field as string)
                : numberFieldKeys[0]
            }
            onChange={(v) => patch({ field: v })}
            options={numberFieldKeys}
            optionLabel={(v) => RULE_FIELDS.find((f) => f.key === v)?.label ?? v}
            allowAdd={false}
          />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: FONTS.regular, fontSize: 11, color: colors.mutedForeground, marginBottom: 4 }}>
                Min
              </Text>
              <TextInput
                style={{
                  fontFamily: FONTS.mono,
                  fontSize: 13,
                  color: colors.foreground,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 8,
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                }}
                value={rule.min == null ? "" : String(rule.min)}
                onChangeText={(t) => patch({ min: t === "" ? null : Number(t) })}
                placeholder="—"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="numeric"
                editable={!disabled}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: FONTS.regular, fontSize: 11, color: colors.mutedForeground, marginBottom: 4 }}>
                Max
              </Text>
              <TextInput
                style={{
                  fontFamily: FONTS.mono,
                  fontSize: 13,
                  color: colors.foreground,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 8,
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                }}
                value={rule.max == null ? "" : String(rule.max)}
                onChangeText={(t) => patch({ max: t === "" ? null : Number(t) })}
                placeholder="—"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="numeric"
                editable={!disabled}
              />
            </View>
          </View>
        </View>
      ) : null}

      {rule.type === "sequence" ? (
        <View style={{ gap: 8 }}>
          <SelectField
            label={`${attr.label}: don't run (after)`}
            value={rule.after ?? attr.values[0].value}
            onChange={(v) => patch({ after: v })}
            options={attr.values.map((x) => x.value)}
            optionLabel={(v) => attr.values.find((x) => x.value === v)?.label ?? v}
            allowAdd={false}
          />
          <SelectField
            label="Right after (before)"
            value={rule.before ?? attr.values[0].value}
            onChange={(v) => patch({ before: v })}
            options={attr.values.map((x) => x.value)}
            optionLabel={(v) => attr.values.find((x) => x.value === v)?.label ?? v}
            allowAdd={false}
          />
        </View>
      ) : null}
    </View>
  );
}
