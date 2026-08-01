import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONTS } from "@/constants/fonts";
import {
  fetchIncidents,
  markIncidentResolved,
  markIncidentReviewed,
  requestIncidentClusters,
  type Incident,
  type IncidentCluster,
  type IncidentClustersResult,
} from "@/context/inventoryShared";
import { useColors } from "@/hooks/useColors";
import { useMe } from "@/hooks/useRole";

type StatusFilter = "all" | "new" | "reviewed" | "resolved";
type PlatformFilter = "all" | "web" | "mobile";
type SourceFilter = "all" | "user_report" | "auto_crash";

const SEVERITY_COLOR: Record<IncidentCluster["severity"], string> = {
  high: "#f87171",
  medium: "#fbbf24",
  low: "#38bdf8",
};

// Manager-only AI root-cause clustering. On demand, asks the server to group the
// incident log into recurring themes; advisory and read-only. The server falls
// back to a deterministic grouping when the AI is unavailable, so this always
// returns something useful. EXACT mirror of the web ClustersPanel (replit.md parity).
function ClustersPanel({
  disabled,
  colors,
}: {
  disabled: boolean;
  colors: ReturnType<typeof useColors>;
}) {
  const [result, setResult] = useState<IncidentClustersResult | null>(null);
  const find = useMutation({
    mutationFn: () => requestIncidentClusters(),
    onSuccess: setResult,
  });

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 12,
        padding: 12,
        gap: 10,
        backgroundColor: colors.card,
        marginBottom: 12,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
          <Feather name="git-merge" size={16} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontFamily: FONTS.medium, color: colors.foreground }}>
              Find patterns
            </Text>
            <Text style={{ fontSize: 11, color: colors.mutedForeground }}>
              Group recurring reports & crashes into likely root causes. Advisory only.
            </Text>
          </View>
        </View>
        <Pressable
          onPress={() => find.mutate()}
          disabled={disabled || find.isPending}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: colors.border,
            opacity: disabled || find.isPending ? 0.5 : pressed ? 0.7 : 1,
          })}
        >
          {find.isPending ? (
            <ActivityIndicator size="small" color={colors.foreground} />
          ) : (
            <Feather name="zap" size={14} color={colors.foreground} />
          )}
          <Text style={{ fontSize: 13, fontFamily: FONTS.medium, color: colors.foreground }}>
            {result ? "Refresh" : "Analyze"}
          </Text>
        </Pressable>
      </View>

      {find.isError ? (
        <Text style={{ fontSize: 13, color: colors.destructive }}>
          Couldn&apos;t analyze the incident log.
        </Text>
      ) : null}

      {result ? (
        <View style={{ gap: 8 }} testID="incident-clusters-result">
          {result.note ? (
            <Text style={{ fontSize: 13, color: colors.mutedForeground }}>{result.note}</Text>
          ) : (
            result.clusters.map((c, i) => (
              <View
                key={i}
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 8,
                  padding: 10,
                  gap: 4,
                  backgroundColor: colors.background,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                  <View
                    style={{
                      paddingHorizontal: 6,
                      paddingVertical: 2,
                      borderRadius: 999,
                      backgroundColor: SEVERITY_COLOR[c.severity] + "26",
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 9,
                        fontFamily: FONTS.bold,
                        textTransform: "uppercase",
                        letterSpacing: 0.5,
                        color: SEVERITY_COLOR[c.severity],
                      }}
                    >
                      {c.severity}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 13, fontFamily: FONTS.medium, color: colors.foreground }}>
                    {c.theme}
                  </Text>
                  <Text style={{ fontSize: 11, color: colors.mutedForeground }}>
                    {c.incidentCount} {c.incidentCount === 1 ? "incident" : "incidents"}
                  </Text>
                </View>
                {c.rootCauseHypothesis ? (
                  <Text style={{ fontSize: 13, color: colors.mutedForeground }}>
                    {c.rootCauseHypothesis}
                  </Text>
                ) : null}
                {c.recommendedAction ? (
                  <Text style={{ fontSize: 13, color: colors.foreground }}>
                    <Text style={{ fontFamily: FONTS.medium }}>Next step: </Text>
                    {c.recommendedAction}
                  </Text>
                ) : null}
              </View>
            ))
          )}
          {!result.aiGenerated && !result.note ? (
            <Text style={{ fontSize: 10, color: colors.mutedForeground }}>
              Showing a computed grouping (AI narration unavailable).
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

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
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["incidents"] });
    void qc.invalidateQueries({ queryKey: ["unreviewedIncidentCount"] });
  };
  const review = useMutation({
    mutationFn: () => markIncidentReviewed(incident.id),
    onSuccess: invalidate,
  });
  const resolve = useMutation({
    mutationFn: () => markIncidentResolved(incident.id),
    onSuccess: invalidate,
  });
  const busy = review.isPending || resolve.isPending;

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
              <View style={[styles.statusBadge, { backgroundColor: (colors.warning ?? colors.primary) + "22" }]}>
                <Text style={[styles.statusBadgeText, { color: colors.warning ?? colors.primary }]}>NEW</Text>
              </View>
            )}
            {incident.status === "reviewed" && (
              <View style={[styles.statusBadge, { backgroundColor: colors.primary + "22" }]}>
                <Text style={[styles.statusBadgeText, { color: colors.primary }]}>REVIEWED</Text>
              </View>
            )}
            {incident.status === "resolved" && (
              <View style={[styles.statusBadge, { backgroundColor: "#34d39922" }]}>
                <Text style={[styles.statusBadgeText, { color: "#34d399" }]}>RESOLVED</Text>
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
          {incident.recurrence ? (
            <View style={styles.recurrenceBadge}>
              <Feather name="rotate-ccw" size={12} color="#fbbf24" />
              <Text style={styles.recurrenceText}>
                {incident.recurrence.count > 1
                  ? `Seen ${incident.recurrence.count}× before`
                  : "Seen before"}
              </Text>
            </View>
          ) : null}
          {incident.diagnosis ? (
            <Field label="Diagnosis" value={incident.diagnosis} colors={colors} />
          ) : null}
          {incident.workaround ? (
            <Field label="Suggested workaround" value={incident.workaround} colors={colors} />
          ) : null}
          <View style={styles.actionsRow}>
            {incident.status === "new" ? (
              <Pressable
                onPress={() => review.mutate()}
                disabled={busy}
                style={({ pressed }) => [
                  styles.actionBtn,
                  styles.actionBtnOutline,
                  { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                {review.isPending ? (
                  <ActivityIndicator color={colors.foreground} />
                ) : (
                  <>
                    <Feather name="check" size={16} color={colors.foreground} />
                    <Text style={[styles.actionBtnText, { color: colors.foreground }]}>
                      Mark reviewed
                    </Text>
                  </>
                )}
              </Pressable>
            ) : incident.status === "reviewed" ? (
              <View style={styles.statusLine}>
                <Feather name="check" size={14} color={colors.primary} />
                <Text style={[styles.statusLineText, { color: colors.primary }]}>
                  Reviewed{incident.reviewedAt ? ` ${timeAgo(incident.reviewedAt)}` : ""}
                </Text>
              </View>
            ) : null}
            {incident.status !== "resolved" ? (
              <Pressable
                onPress={() => resolve.mutate()}
                disabled={busy}
                style={({ pressed }) => [
                  styles.actionBtn,
                  { backgroundColor: colors.primary, opacity: pressed ? 0.9 : 1 },
                ]}
              >
                {resolve.isPending ? (
                  <ActivityIndicator color={colors.primaryForeground} />
                ) : (
                  <>
                    <Feather name="check-circle" size={16} color={colors.primaryForeground} />
                    <Text style={[styles.actionBtnText, { color: colors.primaryForeground }]}>
                      Mark resolved
                    </Text>
                  </>
                )}
              </Pressable>
            ) : (
              <View style={styles.statusLine}>
                <Feather name="check-circle" size={14} color="#34d399" />
                <Text style={[styles.statusLineText, { color: "#34d399" }]}>
                  Resolved{incident.resolvedAt ? ` ${timeAgo(incident.resolvedAt)}` : ""}
                </Text>
              </View>
            )}
          </View>
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
  const { hasCapability, isLoading: roleLoading } = useMe();
  const canReview = hasCapability("review-incidents");
  const { data, isLoading, error } = useQuery({
    queryKey: ["incidents"],
    queryFn: fetchIncidents,
    enabled: canReview,
    refetchInterval: 20_000,
  });

  if (!roleLoading && !canReview) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Feather name="lock" size={28} color={colors.mutedForeground} />
        <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
          Issue reports are visible to managers only.
        </Text>
      </View>
    );
  }

  const [status, setStatus] = useState<StatusFilter>("all");
  const [platform, setPlatform] = useState<PlatformFilter>("all");
  const [source, setSource] = useState<SourceFilter>("all");

  const incidents = data ?? [];
  const filtered = useMemo(
    () =>
      incidents.filter(
        (i) =>
          (status === "all" || i.status === status) &&
          (platform === "all" || i.appPlatform === platform) &&
          (source === "all" || i.source === source),
      ),
    [incidents, status, platform, source],
  );
  const hasIncidents = incidents.length > 0;

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + 100 }]}
    >
      {hasIncidents && <ClustersPanel disabled={isLoading} colors={colors} />}
      {hasIncidents && (
        <View style={styles.filters}>
          <FilterRow<StatusFilter>
            label="Status"
            value={status}
            onChange={setStatus}
            options={[
              ["all", "All"],
              ["new", "New"],
              ["reviewed", "Reviewed"],
              ["resolved", "Resolved"],
            ]}
            colors={colors}
          />
          <FilterRow<PlatformFilter>
            label="Platform"
            value={platform}
            onChange={setPlatform}
            options={[
              ["all", "All"],
              ["web", "Web"],
              ["mobile", "Mobile"],
            ]}
            colors={colors}
          />
          <FilterRow<SourceFilter>
            label="Source"
            value={source}
            onChange={setSource}
            options={[
              ["all", "All"],
              ["user_report", "Reported"],
              ["auto_crash", "Auto-crash"],
            ]}
            colors={colors}
          />
        </View>
      )}
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error ? (
        <Text style={[styles.emptyText, { color: colors.destructive }]}>
          Couldn't load reported issues.
        </Text>
      ) : !hasIncidents ? (
        <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
          No issues reported yet. When staff report a problem or the app hits a
          crash, it'll show up here.
        </Text>
      ) : filtered.length === 0 ? (
        <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
          No issues match these filters.
        </Text>
      ) : (
        filtered.map((incident) => <IncidentCard key={incident.id} incident={incident} />)
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
  card: { borderWidth: 1, borderRadius: 14 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  iconBox: { width: 34, height: 34, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { fontSize: 15, fontFamily: FONTS.semibold },
  statusBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  statusBadgeText: { fontSize: 9, fontFamily: FONTS.bold, letterSpacing: 0.5 },
  meta: { fontSize: 12, fontFamily: FONTS.regular, marginTop: 2 },
  body: { borderTopWidth: 1, padding: 14, gap: 12 },
  fieldLabel: { fontSize: 11, fontFamily: FONTS.semibold, textTransform: "uppercase", letterSpacing: 0.4 },
  fieldValue: { fontSize: 14, fontFamily: FONTS.regular, lineHeight: 20 },
  recurrenceBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "#f59e0b66",
    backgroundColor: "#f59e0b1a",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  recurrenceText: { fontSize: 12, fontFamily: FONTS.semibold, color: "#fbbf24" },
  actionsRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10 },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  actionBtnOutline: { borderWidth: 1, backgroundColor: "transparent" },
  actionBtnText: { fontSize: 14, fontFamily: FONTS.semibold },
  statusLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusLineText: { fontSize: 12, fontFamily: FONTS.medium },
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
