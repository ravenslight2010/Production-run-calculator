import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { CardSection, SectionHeader } from "@/components/UI";
import { useColors } from "@/hooks/useColors";
import { useMe } from "@/hooks/useRole";
import { FONTS } from "@/constants/fonts";
import { useRun } from "@/context/RunContext";
import {
  type FieldProposal,
  type ProposalSource,
  type FieldCategory,
  type LearnedValueRow,
  detectMissingFields,
  buildProposals,
  aiCandidates,
  buildFillMissingInput,
  requestFillMissing,
  fillMissingErrorMessage,
  makeMobileLookup,
  fetchFillMissingValues,
  saveFillMissingValues,
} from "@/context/fillMissing";
import type { ReviewVerdict } from "@workspace/ai-review";
import ReviewBadge from "@/components/ReviewBadge";

// AI suggestions may carry an advisory reviewer verdict; the shared lib's
// proposal type is value-only, so widen locally to carry it through to the UI.
type ReviewedProposal = FieldProposal & { review?: ReviewVerdict };

const CATEGORY_LABEL: Record<FieldCategory, string> = {
  identity: "Run Identity",
  line: "Line & Speed",
  packaging: "Packaging",
  sauce: "Sauce",
  applicator: "Applicators",
  pepperoni: "Pepperoni",
  dough: "Dough Supply",
};
const CATEGORY_ORDER: FieldCategory[] = [
  "identity",
  "line",
  "packaging",
  "sauce",
  "applicator",
  "pepperoni",
  "dough",
];

const SOURCE_LABEL: Record<ProposalSource, string> = {
  learned: "Remembered",
  profile: "From profile",
  spec: "From spec sheet",
  default: "Default",
  ai: "AI suggestion",
  none: "No suggestion",
};

type RowState = { draft: string; applied: boolean; skipped: boolean };

export default function FillMissingPanel() {
  const colors = useColors();
  const { hasCapability } = useMe();
  const isManager = hasCapability("use-ai-tools");
  const { run, brandProfiles, updateSettings } = useRun();
  const [proposals, setProposals] = useState<ReviewedProposal[] | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  // Server-persisted learned values (factory-wide). Fetched once on mount;
  // best-effort, so any failure just leaves the list empty.
  const [learnedValues, setLearnedValues] = useState<LearnedValueRow[]>([]);

  const s = run.settings;

  useEffect(() => {
    let cancelled = false;
    fetchFillMissingValues()
      .then((vals) => {
        if (!cancelled) setLearnedValues(vals);
      })
      .catch(() => {
        /* best-effort: proceed without learned values */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const sourceColor = (src: ProposalSource): string => {
    switch (src) {
      case "learned":
        return "#f59e0b";
      case "profile":
        return "#10b981";
      case "spec":
        return "#0ea5e9";
      case "default":
        return colors.mutedForeground;
      case "ai":
        return "#8b5cf6";
      case "none":
        return "#f59e0b";
    }
  };

  // The shared detection logic reads the dough-supply mode from `subTab`
  // (dough vs crusts) so mode-specific supply fields are only flagged when
  // they apply; settings alone don't carry it, so merge it in from progress.
  function scanRecord(): Record<string, unknown> {
    return {
      ...(s as unknown as Record<string, unknown>),
      subTab: run.progress.subTab,
    };
  }

  function scan() {
    const rec = scanRecord();
    const missing = detectMissingFields(rec);
    const props = buildProposals(
      missing,
      makeMobileLookup(brandProfiles, s.brand, s.flavor, learnedValues),
    );
    setProposals(props);
    setAiError(null);
    setAiNote(null);
    const next: Record<string, RowState> = {};
    for (const p of props) {
      next[p.key] = { draft: p.value == null ? "" : String(p.value), applied: false, skipped: false };
    }
    setRows(next);
    Haptics.selectionAsync();
  }

  async function getAiSuggestions() {
    if (!proposals) return;
    const candidates = aiCandidates(proposals);
    if (candidates.length === 0) return;
    setAiLoading(true);
    setAiError(null);
    setAiNote(null);
    try {
      const input = buildFillMissingInput(
        s.brand,
        s.flavor,
        s.dieType,
        candidates,
        scanRecord(),
      );
      const res = await requestFillMissing(input);
      const byKey = new Map(res.suggestions.map((x) => [x.key, x]));
      setProposals((prev) =>
        (prev ?? []).map((p) => {
          const sug = byKey.get(p.key);
          if (!sug || p.source !== "none") return p;
          return { ...p, value: sug.value, source: "ai", rationale: sug.rationale, review: sug.review };
        }),
      );
      setRows((prev) => {
        const next = { ...prev };
        for (const [key, sug] of byKey) {
          if (next[key] && !next[key].applied && !next[key].skipped) {
            next[key] = { ...next[key], draft: sug.value };
          }
        }
        return next;
      });
      if (res.note) setAiNote(res.note);
    } catch (e) {
      setAiError(fillMissingErrorMessage(e));
    } finally {
      setAiLoading(false);
    }
  }

  function apply(p: FieldProposal) {
    const row = rows[p.key];
    if (!row) return;
    const raw = row.draft.trim();
    if (raw === "") return;
    let value: string | number = raw;
    if (p.kind === "number") {
      const n = parseFloat(raw.replace(",", "."));
      if (!Number.isFinite(n) || n < 0) return;
      value = n;
    }
    updateSettings({ [p.key]: value } as never);
    setRows((prev) => ({ ...prev, [p.key]: { ...prev[p.key], applied: true, skipped: false } }));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // Remember this confirmed value factory-wide so future scans of the same
    // product propose it as a "learned" source. Needs a product key (brand +
    // flavor); best-effort, so failures are swallowed. Mirrors the web panel.
    if (s.brand.trim() && s.flavor.trim()) {
      const learnedRow: LearnedValueRow = {
        brand: s.brand.trim(),
        flavor: s.flavor.trim(),
        fieldKey: p.key,
        value: String(value),
      };
      setLearnedValues((prev) => {
        const others = prev.filter(
          (v) =>
            !(
              v.fieldKey === learnedRow.fieldKey &&
              v.brand.trim().toLowerCase() === learnedRow.brand.toLowerCase() &&
              v.flavor.trim().toLowerCase() === learnedRow.flavor.toLowerCase()
            ),
        );
        return [...others, learnedRow];
      });
      void saveFillMissingValues([learnedRow]).catch(() => {
        /* best-effort */
      });
    }
  }

  function skip(key: string) {
    setRows((prev) => ({ ...prev, [key]: { ...prev[key], skipped: true } }));
  }

  const pending = (proposals ?? []).filter((p) => {
    const r = rows[p.key];
    return r && !r.applied && !r.skipped;
  });
  const hasAiCandidates = (proposals ?? []).some(
    (p) => p.source === "none" && p.fillable && !rows[p.key]?.applied && !rows[p.key]?.skipped,
  );

  return (
    <>
      <SectionHeader title="Fill in Missing Data" />
      <CardSection style={{ paddingVertical: 12 }}>
        <Text style={[styles.intro, { color: colors.mutedForeground }]}>
          Find blank fields this run needs and propose values from your profile, the spec sheet,
          documented defaults, or AI. Nothing is applied until you confirm each one.
        </Text>

        <View style={styles.actions}>
          <Pressable
            onPress={scan}
            style={({ pressed }) => [
              styles.btn,
              { backgroundColor: colors.muted ?? colors.border, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Feather name="clipboard" size={14} color={colors.foreground} />
            <Text style={[styles.btnText, { color: colors.foreground }]}>
              {proposals ? "Re-scan" : "Scan for missing data"}
            </Text>
          </Pressable>
          {proposals && hasAiCandidates && isManager ? (
            <Pressable
              onPress={getAiSuggestions}
              disabled={aiLoading}
              style={({ pressed }) => [
                styles.btn,
                { backgroundColor: colors.primary, opacity: aiLoading ? 0.6 : pressed ? 0.7 : 1 },
              ]}
            >
              {aiLoading ? (
                <ActivityIndicator size="small" color={colors.primaryForeground} />
              ) : (
                <Feather name="zap" size={14} color={colors.primaryForeground} />
              )}
              <Text style={[styles.btnText, { color: colors.primaryForeground }]}>
                {aiLoading ? "Asking AI…" : "Get AI suggestions"}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {proposals && hasAiCandidates && !isManager ? (
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>
            AI suggestions require a manager.
          </Text>
        ) : null}

        {aiError ? (
          <View style={[styles.banner, { backgroundColor: "#ef444422", borderColor: "#ef444455" }]}>
            <Text style={[styles.bannerText, { color: "#ef4444" }]}>{aiError}</Text>
          </View>
        ) : null}
        {aiNote ? (
          <View style={[styles.banner, { backgroundColor: "#f59e0b22", borderColor: "#f59e0b55" }]}>
            <Text style={[styles.bannerText, { color: "#f59e0b" }]}>{aiNote}</Text>
          </View>
        ) : null}

        {proposals && pending.length === 0 ? (
          <View style={styles.empty}>
            <Feather name="check-circle" size={22} color="#10b981" />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Nothing left to fill</Text>
            <Text style={[styles.emptyHint, { color: colors.mutedForeground }]}>
              Every required field for this run has a value.
            </Text>
          </View>
        ) : null}

        {proposals
          ? CATEGORY_ORDER.map((cat) => {
              const inCat = pending.filter((p) => p.category === cat);
              if (inCat.length === 0) return null;
              return (
                <View key={cat} style={{ marginTop: 10 }}>
                  <Text style={[styles.catLabel, { color: colors.mutedForeground }]}>
                    {CATEGORY_LABEL[cat]}
                  </Text>
                  {inCat.map((p) => {
                    const row = rows[p.key];
                    return (
                      <View
                        key={p.key}
                        style={[styles.item, { backgroundColor: colors.background, borderColor: colors.border }]}
                      >
                        <View style={styles.itemHead}>
                          <Text style={[styles.itemLabel, { color: colors.foreground }]}>{p.label}</Text>
                          <Text style={[styles.badge, { color: sourceColor(p.source), borderColor: sourceColor(p.source) }]}>
                            {SOURCE_LABEL[p.source]}
                          </Text>
                        </View>
                        {p.rationale ? (
                          <Text style={[styles.rationale, { color: colors.mutedForeground }]}>{p.rationale}</Text>
                        ) : null}
                        {p.source === "ai" && p.review ? (
                          <View style={{ marginTop: 4 }}>
                            <ReviewBadge review={p.review} />
                          </View>
                        ) : null}
                        {!p.fillable ? (
                          <Text style={[styles.notFillable, { color: "#f59e0b" }]}>
                            Set this on the run itself before configuring — it can&apos;t be filled here.
                          </Text>
                        ) : (
                          <View style={styles.itemActions}>
                            <TextInput
                              style={[styles.input, { color: colors.foreground, borderColor: colors.border }]}
                              value={row?.draft ?? ""}
                              onChangeText={(t) =>
                                setRows((prev) => ({ ...prev, [p.key]: { ...prev[p.key], draft: t } }))
                              }
                              placeholder={p.source === "none" ? "No suggestion" : ""}
                              placeholderTextColor={colors.mutedForeground}
                              keyboardType={p.kind === "number" ? "decimal-pad" : "default"}
                              selectTextOnFocus
                            />
                            <Pressable
                              onPress={() => apply(p)}
                              disabled={!(row?.draft ?? "").trim()}
                              style={({ pressed }) => [
                                styles.smallBtn,
                                {
                                  backgroundColor: colors.primary,
                                  opacity: !(row?.draft ?? "").trim() ? 0.4 : pressed ? 0.7 : 1,
                                },
                              ]}
                            >
                              <Feather name="check" size={13} color={colors.primaryForeground} />
                              <Text style={[styles.smallBtnText, { color: colors.primaryForeground }]}>Apply</Text>
                            </Pressable>
                            <Pressable
                              onPress={() => skip(p.key)}
                              style={({ pressed }) => [styles.smallBtnGhost, { opacity: pressed ? 0.6 : 1 }]}
                            >
                              <Text style={[styles.smallBtnText, { color: colors.mutedForeground }]}>Skip</Text>
                            </Pressable>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              );
            })
          : null}
      </CardSection>
    </>
  );
}

const styles = StyleSheet.create({
  intro: { fontSize: 12, lineHeight: 17, fontFamily: FONTS.regular, marginBottom: 10 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  btnText: { fontSize: 13, fontFamily: FONTS.semibold },
  hint: { fontSize: 11, fontFamily: FONTS.regular, marginTop: 8 },
  banner: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginTop: 10 },
  bannerText: { fontSize: 12, fontFamily: FONTS.regular, lineHeight: 16 },
  empty: { alignItems: "center", gap: 6, paddingVertical: 24 },
  emptyTitle: { fontSize: 14, fontFamily: FONTS.semibold },
  emptyHint: { fontSize: 12, fontFamily: FONTS.regular, textAlign: "center", maxWidth: 240 },
  catLabel: { fontSize: 11, fontFamily: FONTS.bold, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 6 },
  item: { borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 8 },
  itemHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 },
  itemLabel: { fontSize: 14, fontFamily: FONTS.semibold, flexShrink: 1 },
  badge: {
    fontSize: 10,
    fontFamily: FONTS.bold,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
    overflow: "hidden",
  },
  rationale: { fontSize: 12, lineHeight: 16, fontFamily: FONTS.regular, marginTop: 4 },
  notFillable: { fontSize: 11, fontFamily: FONTS.regular, marginTop: 8 },
  itemActions: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 13,
    fontFamily: FONTS.regular,
  },
  smallBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
  },
  smallBtnGhost: { paddingHorizontal: 8, paddingVertical: 7, borderRadius: 8 },
  smallBtnText: { fontSize: 12, fontFamily: FONTS.semibold },
});
