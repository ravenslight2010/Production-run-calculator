// Manager-only "Run Insights" card (Setup tab — mobile parity with the web
// RunInsightsCard). Shows ONE pending suggestion at a time — a deterministic,
// pattern-based recommendation to adjust a setting after recent runs
// consistently diverged from it. Accept applies the change via the provided
// onAccept callback; Dismiss suppresses the pattern until it recurs. Also
// surfaces post-accept follow-up notes with a Got-it clear action.
// Nothing is ever auto-applied.

import { Feather } from "@expo/vector-icons";
import { useMutation } from "@tanstack/react-query";
import React, { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { FONTS } from "@/constants/fonts";
import { useColors } from "@/hooks/useColors";
import { updateRunSuggestion, type RunSuggestion } from "@/context/runInsights";
import { useRunSuggestions, RUN_SUGGESTIONS_QUERY_KEY } from "@/hooks/useRunSuggestions";

export default function RunInsightsCard({
  onAccept,
}: {
  /** Applies the accepted setting change; resolves to a confirmation line. */
  onAccept: (s: RunSuggestion) => Promise<string>;
}) {
  const colors = useColors();
  const { current, followUps, isLoading, isFetching, refetch, qc } = useRunSuggestions();
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const acceptMutation = useMutation({
    mutationFn: async (s: RunSuggestion) => {
      const message = await onAccept(s);
      const updated = await updateRunSuggestion(s.id, { status: "accepted" });
      return { message, updated };
    },
    onSuccess: ({ message, updated }) => {
      setError(null);
      setConfirmation(message);
      qc.setQueryData(RUN_SUGGESTIONS_QUERY_KEY, updated);
    },
    onError: (err) => {
      setConfirmation(null);
      setError(err instanceof Error ? err.message : "Couldn't apply the suggestion.");
    },
  });

  const dismissMutation = useMutation({
    mutationFn: (s: RunSuggestion) => updateRunSuggestion(s.id, { status: "dismissed" }),
    onSuccess: (updated) => {
      setError(null);
      qc.setQueryData(RUN_SUGGESTIONS_QUERY_KEY, updated);
    },
    onError: (err) =>
      setError(err instanceof Error ? err.message : "Couldn't dismiss the suggestion."),
  });

  const clearFollowUpMutation = useMutation({
    mutationFn: (s: RunSuggestion) => updateRunSuggestion(s.id, { clearFollowUp: true }),
    onSuccess: (updated) => qc.setQueryData(RUN_SUGGESTIONS_QUERY_KEY, updated),
  });

  // Nothing to show → render nothing (keeps the Setup tab clean).
  if (!isLoading && !current && followUps.length === 0 && !confirmation && !error) {
    return null;
  }

  const busy = acceptMutation.isPending || dismissMutation.isPending;

  const settingLabel = (s: RunSuggestion) =>
    s.type === "speed-target" ? "Cycle speed" : "Tunnel time";
  const productLabel = (s: RunSuggestion) =>
    [s.brand, s.flavor].filter(Boolean).join(" ") || "Unnamed product";

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: colors.primary + "4D", // ~30% opacity
        borderRadius: 12,
        marginBottom: 12,
        overflow: "hidden",
        backgroundColor: colors.card,
      }}
      testID="card-run-insights"
    >
      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 14,
          paddingTop: 12,
          paddingBottom: 4,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
          <Feather name="zap" size={14} color={colors.primary} />
          <Text style={{ fontFamily: FONTS.semibold, fontSize: 14, color: colors.foreground }}>
            Run Insights
          </Text>
        </View>
        <Pressable
          onPress={() => refetch()}
          disabled={isFetching}
          hitSlop={8}
          style={({ pressed }) => ({ opacity: pressed || isFetching ? 0.4 : 1 })}
          accessibilityLabel="Refresh"
          testID="button-run-insights-refresh"
        >
          <Feather name="refresh-cw" size={14} color={colors.mutedForeground} />
        </Pressable>
      </View>
      <Text
        style={{
          fontFamily: FONTS.regular,
          fontSize: 12,
          color: colors.mutedForeground,
          paddingHorizontal: 14,
          paddingBottom: 10,
        }}
      >
        Pattern-based setting suggestions from completed runs. Nothing changes unless you accept it.
      </Text>

      {/* Body */}
      <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 10 }}>
        {/* Error */}
        {error ? (
          <Text
            style={{ fontFamily: FONTS.regular, fontSize: 12, color: "#ef4444" }}
            testID="text-run-insights-error"
          >
            {error}
          </Text>
        ) : null}

        {/* Confirmation banner */}
        {confirmation ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              gap: 8,
              borderWidth: 1,
              borderColor: "#10b981" + "4D",
              backgroundColor: "#10b981" + "1A",
              borderRadius: 8,
              paddingHorizontal: 12,
              paddingVertical: 8,
            }}
            testID="text-run-insights-confirmation"
          >
            <Text
              style={{ flex: 1, fontFamily: FONTS.regular, fontSize: 12, color: "#10b981" }}
            >
              {confirmation}
            </Text>
            <Pressable
              onPress={() => setConfirmation(null)}
              hitSlop={8}
              style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
            >
              <Feather name="x" size={13} color="#10b981" />
            </Pressable>
          </View>
        ) : null}

        {/* Follow-up notes */}
        {followUps.map((s) => (
          <View
            key={`fu-${s.id}`}
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              gap: 8,
              borderWidth: 1,
              borderColor: "#0ea5e9" + "4D",
              backgroundColor: "#0ea5e9" + "1A",
              borderRadius: 8,
              paddingHorizontal: 12,
              paddingVertical: 8,
            }}
            testID={`text-run-insights-followup-${s.type}`}
          >
            <Text style={{ flex: 1, fontFamily: FONTS.regular, fontSize: 12, color: "#38bdf8" }}>
              <Text style={{ fontFamily: FONTS.semibold }}>{productLabel(s)}: </Text>
              {s.followUpNote}
            </Text>
            <Pressable
              onPress={() => clearFollowUpMutation.mutate(s)}
              disabled={clearFollowUpMutation.isPending}
              style={({ pressed }) => ({
                backgroundColor: "#0ea5e9" + "33",
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 6,
                opacity: pressed ? 0.6 : 1,
              })}
              testID="button-run-insights-followup-clear"
            >
              <Text style={{ fontFamily: FONTS.semibold, fontSize: 11, color: "#38bdf8" }}>
                Got it
              </Text>
            </Pressable>
          </View>
        ))}

        {/* Loading */}
        {isLoading ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <ActivityIndicator size="small" color={colors.mutedForeground} />
            <Text style={{ fontFamily: FONTS.regular, fontSize: 12, color: colors.mutedForeground }}>
              Loading…
            </Text>
          </View>
        ) : current ? (
          <View style={{ gap: 8 }} testID={`suggestion-${current.type}`}>
            {/* Product + die */}
            <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 4 }}>
              <Text style={{ fontFamily: FONTS.semibold, fontSize: 14, color: colors.foreground }}>
                {productLabel(current)}
              </Text>
              {current.dieType ? (
                <Text style={{ fontFamily: FONTS.regular, fontSize: 13, color: colors.mutedForeground }}>
                  · {current.dieType}
                </Text>
              ) : null}
            </View>

            {/* Narrative / stats */}
            <Text style={{ fontFamily: FONTS.regular, fontSize: 13, color: colors.foreground }}>
              {current.narrative || current.statsLine}
            </Text>

            {/* Three-column stat grid */}
            <View style={{ flexDirection: "row", gap: 6 }}>
              <View
                style={{
                  flex: 1,
                  backgroundColor: colors.muted + "80",
                  borderRadius: 8,
                  paddingHorizontal: 8,
                  paddingVertical: 8,
                }}
              >
                <Text style={{ fontFamily: FONTS.regular, fontSize: 10, color: colors.mutedForeground }}>
                  Configured
                </Text>
                <Text style={{ fontFamily: FONTS.semibold, fontSize: 13, color: colors.foreground, marginTop: 2 }}>
                  {current.configuredValue} {current.unit}
                </Text>
              </View>
              <View
                style={{
                  flex: 1,
                  backgroundColor: colors.muted + "80",
                  borderRadius: 8,
                  paddingHorizontal: 8,
                  paddingVertical: 8,
                }}
              >
                <Text style={{ fontFamily: FONTS.regular, fontSize: 10, color: colors.mutedForeground }}>
                  Observed ({current.runCount} runs)
                </Text>
                <Text style={{ fontFamily: FONTS.semibold, fontSize: 13, color: colors.foreground, marginTop: 2 }}>
                  {current.observedValue} {current.unit}
                </Text>
              </View>
              <View
                style={{
                  flex: 1,
                  backgroundColor: colors.primary + "1A",
                  borderRadius: 8,
                  paddingHorizontal: 8,
                  paddingVertical: 8,
                }}
              >
                <Text style={{ fontFamily: FONTS.regular, fontSize: 10, color: colors.mutedForeground }}>
                  Suggested {settingLabel(current).toLowerCase()}
                </Text>
                <Text style={{ fontFamily: FONTS.semibold, fontSize: 13, color: colors.primary, marginTop: 2 }}>
                  {current.recommendedValue} {current.unit}
                </Text>
              </View>
            </View>

            {/* Accept / Dismiss buttons */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 2 }}>
              <Pressable
                onPress={() => acceptMutation.mutate(current)}
                disabled={busy}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  backgroundColor: colors.primary,
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  borderRadius: 8,
                  opacity: busy ? 0.5 : pressed ? 0.75 : 1,
                })}
                testID="button-run-insights-accept"
              >
                {acceptMutation.isPending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Feather name="check" size={13} color="#fff" />
                )}
                <Text style={{ fontFamily: FONTS.semibold, fontSize: 13, color: "#fff" }}>
                  Accept
                </Text>
              </Pressable>
              <Pressable
                onPress={() => dismissMutation.mutate(current)}
                disabled={busy}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  borderWidth: 1,
                  borderColor: colors.border,
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  borderRadius: 8,
                  opacity: busy ? 0.5 : pressed ? 0.75 : 1,
                })}
                testID="button-run-insights-dismiss"
              >
                {dismissMutation.isPending ? (
                  <ActivityIndicator size="small" color={colors.foreground} />
                ) : (
                  <Feather name="x" size={13} color={colors.foreground} />
                )}
                <Text style={{ fontFamily: FONTS.semibold, fontSize: 13, color: colors.foreground }}>
                  Dismiss
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}
