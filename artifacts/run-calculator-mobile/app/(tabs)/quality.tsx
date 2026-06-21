import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import React, { useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONTS } from "@/constants/fonts";
import {
  fetchQualityChecks,
  type QualityCheckRecord,
  type QualityProductType,
  type QualityStatus,
} from "@/context/inventoryShared";
import { useColors } from "@/hooks/useColors";
import { useMe } from "@/hooks/useRole";

type ProductFilter = "all" | QualityProductType;
type StatusFilter = "all" | QualityStatus;

function statusMeta(
  status: QualityStatus,
  colors: ReturnType<typeof useColors>,
): { label: string; color: string; icon: keyof typeof Feather.glyphMap } {
  switch (status) {
    case "pass":
      return { label: "Looks good", color: colors.success ?? colors.primary, icon: "check-circle" };
    case "warn":
      return { label: "Minor issues", color: colors.warning ?? colors.primary, icon: "alert-triangle" };
    case "fail":
      return { label: "Defects found", color: colors.destructive, icon: "alert-triangle" };
  }
}

function formatWhen(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function QualityCard({ check }: { check: QualityCheckRecord }) {
  const colors = useColors();
  const [expanded, setExpanded] = useState(false);
  const meta = statusMeta(check.status, colors);

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Pressable style={styles.cardHeader} onPress={() => setExpanded((v) => !v)}>
        {check.thumbnail ? (
          <Image source={{ uri: check.thumbnail }} style={styles.thumb} />
        ) : (
          <View style={[styles.thumb, styles.thumbEmpty, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
            <Feather name="image" size={16} color={colors.mutedForeground} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <View style={styles.titleRow}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>{check.productType}</Text>
            <View style={[styles.statusBadge, { backgroundColor: meta.color + "22" }]}>
              <Feather name={meta.icon} size={10} color={meta.color} />
              <Text style={[styles.statusBadgeText, { color: meta.color }]}>{meta.label}</Text>
            </View>
          </View>
          <Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={1}>
            {formatWhen(check.createdAt)}
            {check.reviewerName ? ` · ${check.reviewerName}` : ""}
            {` · ${Math.round(check.confidence * 100)}% conf.`}
          </Text>
          {check.summary ? (
            <Text style={[styles.summary, { color: colors.foreground }]} numberOfLines={expanded ? undefined : 2}>
              {check.summary}
            </Text>
          ) : null}
        </View>
        <Feather
          name={expanded ? "chevron-up" : "chevron-down"}
          size={18}
          color={colors.mutedForeground}
        />
      </Pressable>

      {expanded && (
        <View style={[styles.body, { borderTopColor: colors.border }]}>
          {check.thumbnail ? (
            <Image source={{ uri: check.thumbnail }} style={styles.bigImage} resizeMode="contain" />
          ) : null}
          {check.issues.length > 0 ? (
            <View style={{ gap: 8 }}>
              {check.issues.map((issue, i) => (
                <View
                  key={i}
                  style={[styles.issueRow, { backgroundColor: colors.secondary, borderColor: colors.border }]}
                >
                  <Feather name="alert-triangle" size={13} color={colors.warning ?? colors.primary} />
                  <Text style={[styles.issueText, { color: colors.foreground }]}>
                    <Text style={{ fontFamily: FONTS.semibold }}>{issue.type}</Text>{" "}
                    <Text style={{ color: colors.mutedForeground }}>({issue.severity})</Text> — {issue.detail}
                  </Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>No issues noted.</Text>
          )}
          {check.notes ? (
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>
              <Text style={{ fontFamily: FONTS.semibold }}>Context: </Text>
              {check.notes}
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

// Manager-only browsable history of confirmed quality checks. Mirrors the web
// QualityHistoryTab; filter by product type and status. Operators never reach
// this screen.
export default function QualityScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isManager, isLoading: roleLoading } = useMe();
  const [product, setProduct] = useState<ProductFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");

  const { data, isLoading, error } = useQuery({
    queryKey: ["qualityChecks", product, status],
    enabled: isManager,
    queryFn: () =>
      fetchQualityChecks({
        productType: product === "all" ? undefined : product,
        status: status === "all" ? undefined : status,
      }),
  });

  if (!roleLoading && !isManager) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Feather name="lock" size={28} color={colors.mutedForeground} />
        <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
          Quality history is visible to managers only.
        </Text>
      </View>
    );
  }

  const checks = data ?? [];

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + 100 }]}
    >
      <Text style={[styles.intro, { color: colors.mutedForeground }]}>
        Every quality check a manager reviews and confirms is logged here so you can spot trends and
        audit outcomes over time.
      </Text>
      <View style={styles.filters}>
        <FilterRow<ProductFilter>
          label="Product"
          value={product}
          onChange={setProduct}
          options={[
            ["all", "All"],
            ["pizza", "Pizza"],
            ["crust", "Crust"],
            ["other", "Other"],
          ]}
          colors={colors}
        />
        <FilterRow<StatusFilter>
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            ["all", "All"],
            ["pass", "Looks good"],
            ["warn", "Minor"],
            ["fail", "Defects"],
          ]}
          colors={colors}
        />
      </View>
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error ? (
        <Text style={[styles.emptyText, { color: colors.destructive }]}>
          Couldn't load quality history.
        </Text>
      ) : checks.length === 0 ? (
        <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
          No quality checks recorded yet. Run a check from the Stock tab and confirm the outcome to
          start the history.
        </Text>
      ) : (
        checks.map((check) => <QualityCard key={check.id} check={check} />)
      )}
    </ScrollView>
  );
}

// A labelled row of mutually-exclusive filter chips.
function FilterRow<T extends string>({
  label,
  value,
  onChange,
  options,
  colors,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: [T, string][];
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.filterRow}>
      <Text style={[styles.filterLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={styles.filterChips}>
        {options.map(([val, text]) => {
          const active = value === val;
          return (
            <Pressable
              key={val}
              onPress={() => onChange(val)}
              style={[
                styles.chip,
                {
                  backgroundColor: active ? colors.primary : "transparent",
                  borderColor: active ? colors.primary : colors.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  { color: active ? colors.primaryForeground : colors.mutedForeground },
                ]}
              >
                {text}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32 },
  emptyText: { fontSize: 14, fontFamily: FONTS.regular, textAlign: "center", padding: 24, lineHeight: 20 },
  intro: { fontSize: 13, fontFamily: FONTS.regular, lineHeight: 19 },
  card: { borderWidth: 1, borderRadius: 14 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  thumb: { width: 44, height: 44, borderRadius: 9 },
  thumbEmpty: { alignItems: "center", justifyContent: "center", borderWidth: 1 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  cardTitle: { fontSize: 15, fontFamily: FONTS.semibold, textTransform: "capitalize" },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
  },
  statusBadgeText: { fontSize: 10, fontFamily: FONTS.bold, letterSpacing: 0.3 },
  meta: { fontSize: 12, fontFamily: FONTS.regular, marginTop: 2, lineHeight: 17 },
  summary: { fontSize: 13, fontFamily: FONTS.regular, marginTop: 4, lineHeight: 18 },
  body: { borderTopWidth: 1, padding: 14, gap: 12 },
  bigImage: { width: "100%", height: 200, borderRadius: 10 },
  issueRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  issueText: { fontSize: 13, fontFamily: FONTS.regular, flex: 1, lineHeight: 18 },
  filters: { gap: 8, paddingBottom: 4 },
  filterRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  filterLabel: {
    fontSize: 11,
    fontFamily: FONTS.semibold,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    width: 64,
  },
  filterChips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1 },
  chipText: { fontSize: 12, fontFamily: FONTS.medium },
});
