import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONTS } from "@/constants/fonts";
import {
  fetchIncidents,
  markIncidentReviewed,
  type Incident,
} from "@/context/inventoryShared";
import { useColors } from "@/hooks/useColors";
import { useMe } from "@/hooks/useRole";

function timeAgo(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function IncidentCard({ incident }: { incident: Incident }) {
  const colors = useColors();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(incident.status === "new");
  const review = useMutation({
    mutationFn: () => markIncidentReviewed(incident.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["incidents"] });
      void qc.invalidateQueries({ queryKey: ["unreviewedIncidentCount"] });
    },
  });

  const isCrash = incident.source === "auto_crash";
  const ctx = incident.context ?? {};
  const accent = isCrash ? colors.destructive : colors.primary;

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Pressable style={styles.cardHeader} onPress={() => setExpanded((v) => !v)}>
        <View style={[styles.iconBox, { backgroundColor: accent + "22" }]}>
          <Feather name={isCrash ? "alert-triangle" : "message-square"} size={16} color={accent} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.titleRow}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>
              {isCrash ? "Auto-captured crash" : "Reported issue"}
            </Text>
            {incident.status === "new" && (
              <View style={[styles.newBadge, { backgroundColor: (colors.warning ?? colors.primary) + "22" }]}>
                <Text style={[styles.newBadgeText, { color: colors.warning ?? colors.primary }]}>NEW</Text>
              </View>
            )}
          </View>
          <Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={1}>
            {(incident.reporterName ?? "Unknown") +
              (incident.reporterRole ? ` (${incident.reporterRole})` : "")}
            {" · "}
            {incident.screen} · {incident.appPlatform} · {timeAgo(incident.createdAt)}
          </Text>
        </View>
        <Feather
          name={expanded ? "chevron-up" : "chevron-down"}
          size={18}
          color={colors.mutedForeground}
        />
      </Pressable>

      {expanded && (
        <View style={[styles.body, { borderTopColor: colors.border }]}>
          {ctx.description ? (
            <Field label="What they reported" value={ctx.description} colors={colors} />
          ) : null}
          {ctx.errorMessage ? (
            <Field label="Error" value={ctx.errorMessage} colors={colors} mono />
          ) : null}
          {incident.diagnosis ? (
            <Field label="Diagnosis" value={incident.diagnosis} colors={colors} />
          ) : null}
          {incident.workaround ? (
            <Field label="Suggested workaround" value={incident.workaround} colors={colors} />
          ) : null}
          {incident.status === "new" ? (
            <Pressable
              onPress={() => review.mutate()}
              disabled={review.isPending}
              style={({ pressed }) => [
                styles.reviewBtn,
                { backgroundColor: colors.primary, opacity: pressed ? 0.9 : 1 },
              ]}
            >
              {review.isPending ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <>
                  <Feather name="check" size={16} color={colors.primaryForeground} />
                  <Text style={[styles.reviewBtnText, { color: colors.primaryForeground }]}>
                    Mark reviewed
                  </Text>
                </>
              )}
            </Pressable>
          ) : (
            <View style={styles.reviewedRow}>
              <Feather name="check" size={14} color="#34d399" />
              <Text style={[styles.reviewedText, { color: "#34d399" }]}>
                Reviewed{incident.reviewedAt ? ` ${timeAgo(incident.reviewedAt)}` : ""}
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function Field({
  label,
  value,
  colors,
  mono,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useColors>;
  mono?: boolean;
}) {
  return (
    <View style={{ gap: 2 }}>
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text
        style={[
          styles.fieldValue,
          { color: mono ? colors.destructive : colors.foreground },
          mono ? { fontFamily: FONTS.mono } : null,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

// Manager-only review queue of reported issues and auto-captured crashes, each
// with its stored AI diagnosis + workaround. Operators never see content here.
// Mirrors the web IncidentsTab.
export default function IncidentsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isManager, isLoading: roleLoading } = useMe();
  const { data, isLoading, error } = useQuery({
    queryKey: ["incidents"],
    queryFn: fetchIncidents,
    enabled: isManager,
    refetchInterval: 20_000,
  });

  if (!roleLoading && !isManager) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Feather name="lock" size={28} color={colors.mutedForeground} />
        <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
          Issue reports are visible to managers only.
        </Text>
      </View>
    );
  }

  const incidents = data ?? [];

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + 100 }]}
    >
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error ? (
        <Text style={[styles.emptyText, { color: colors.destructive }]}>
          Couldn't load reported issues.
        </Text>
      ) : incidents.length === 0 ? (
        <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
          No issues reported yet. When staff report a problem or the app hits a
          crash, it'll show up here.
        </Text>
      ) : (
        incidents.map((incident) => <IncidentCard key={incident.id} incident={incident} />)
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32 },
  emptyText: { fontSize: 14, fontFamily: FONTS.regular, textAlign: "center", padding: 24, lineHeight: 20 },
  card: { borderWidth: 1, borderRadius: 14 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  iconBox: { width: 34, height: 34, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { fontSize: 15, fontFamily: FONTS.semibold },
  newBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  newBadgeText: { fontSize: 9, fontFamily: FONTS.bold, letterSpacing: 0.5 },
  meta: { fontSize: 12, fontFamily: FONTS.regular, marginTop: 2 },
  body: { borderTopWidth: 1, padding: 14, gap: 12 },
  fieldLabel: { fontSize: 11, fontFamily: FONTS.semibold, textTransform: "uppercase", letterSpacing: 0.4 },
  fieldValue: { fontSize: 14, fontFamily: FONTS.regular, lineHeight: 20 },
  reviewBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 11,
    borderRadius: 10,
  },
  reviewBtnText: { fontSize: 14, fontFamily: FONTS.semibold },
  reviewedRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  reviewedText: { fontSize: 12, fontFamily: FONTS.medium },
});
