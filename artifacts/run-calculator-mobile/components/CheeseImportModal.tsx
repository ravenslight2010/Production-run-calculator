import { Feather } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useColors } from "@/hooks/useColors";
import {
  cheeseRecipeTotalLbs,
  type CheeseRecipe,
} from "@workspace/cheese-recipes";
import type { CheeseImportPrepared } from "@/context/cheeseImport";

type Props = {
  visible: boolean;
  onClose: () => void;
  loading: boolean;
  /** Multi-file parse progress; null for a single file. */
  progress?: { done: number; total: number } | null;
  error: string | null;
  prepared: CheeseImportPrepared | null;
  applying: boolean;
  /** Confirm with the reviewed cheese recipes the manager chose to apply. */
  onConfirm: (recipesToApply: CheeseRecipe[]) => void;
};

// Review screen for the "Cheese Mix Recipe Specs" workbook importer. Each
// customer tab is parsed DETERMINISTICALLY into cheese recipes (shredder
// setting, per-flavor assignments, per-batch component pounds). The manager
// reviews every parsed recipe — its customer, flavors, shredder setting and
// ingredient count — and can include/exclude each one before confirming.
// Mirrors the web dialog in
// artifacts/run-calculator/src/components/CheeseImportDialog.tsx (replit.md parity).
export default function CheeseImportModal({
  visible,
  onClose,
  loading,
  progress,
  error,
  prepared,
  applying,
  onConfirm,
}: Props) {
  const colors = useColors();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Reset the review state whenever a fresh prepared result arrives.
  useEffect(() => {
    if (prepared) {
      setSelected(new Set(prepared.candidates.map((c) => c.recipe.id)));
    } else {
      setSelected(new Set());
    }
  }, [prepared]);

  const existing = useMemo(() => new Set(prepared?.existingIds ?? []), [prepared]);

  if (!visible) return null;

  const s = prepared?.summary;
  const nothing = s != null && s.total === 0;
  const candidates = prepared?.candidates ?? [];
  const selectedCount = candidates.filter((c) => selected.has(c.recipe.id)).length;
  const confirmDisabled =
    loading || applying || !!error || !prepared || nothing || selectedCount === 0;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const confirm = () => {
    const included = candidates
      .filter((c) => selected.has(c.recipe.id))
      .map((c) => c.recipe);
    onConfirm(included);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View
          style={[
            styles.sheet,
            { backgroundColor: colors.background, borderColor: colors.border },
          ]}
        >
          <View style={styles.header}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Feather name="file-text" size={18} color={colors.primary} />
              <Text style={[styles.title, { color: colors.foreground }]}>
                Import Cheese Recipes
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} disabled={applying}>
              <Feather name="x" size={22} color={colors.mutedForeground} />
            </Pressable>
          </View>

          <ScrollView
            style={{ maxHeight: 460 }}
            contentContainerStyle={{ paddingBottom: 12, gap: 14 }}
          >
            {loading ? (
              <View style={styles.center}>
                <ActivityIndicator color={colors.primary} />
                <Text style={[styles.help, { color: colors.mutedForeground, textAlign: "center" }]}>
                  {progress && progress.total > 1
                    ? `Reading file ${Math.min(progress.done + 1, progress.total)} of ${progress.total} and building cheese recipes…`
                    : "Reading the workbook and building cheese recipes from each tab…"}
                </Text>
              </View>
            ) : null}

            {!loading && error ? (
              <View style={[styles.errorBox, { borderColor: colors.destructive }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Feather name="alert-triangle" size={15} color={colors.destructive} />
                  <Text style={[styles.errorTitle, { color: colors.destructive }]}>
                    Could not import
                  </Text>
                </View>
                <Text style={[styles.help, { color: colors.destructive }]}>{error}</Text>
              </View>
            ) : null}

            {!loading && !error && prepared ? (
              <>
                <Text style={[styles.help, { color: colors.mutedForeground }]}>
                  Review each cheese recipe below. Uncheck any you don't want.
                  Checked recipes marked{" "}
                  <Text style={{ color: colors.foreground, fontWeight: "600" }}>
                    update
                  </Text>{" "}
                  replace the existing recipe;{" "}
                  <Text style={{ color: colors.foreground, fontWeight: "600" }}>
                    new
                  </Text>{" "}
                  ones are added.
                </Text>

                <View style={[styles.summaryCard, { borderColor: colors.border }]}>
                  <Text style={[styles.summaryTotal, { color: colors.foreground }]}>
                    {selectedCount}
                  </Text>
                  <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>
                    of {s!.total} cheese recipe{s!.total === 1 ? "" : "s"} selected
                  </Text>
                </View>

                {candidates.map((c) => {
                  const r = c.recipe;
                  const isSel = selected.has(r.id);
                  const isNew = !existing.has(r.id);
                  const total = cheeseRecipeTotalLbs(r);
                  return (
                    <Pressable
                      key={r.id}
                      testID={`cheese-candidate-${r.id}`}
                      onPress={() => toggle(r.id)}
                      style={[styles.candidate, { borderColor: colors.border }]}
                    >
                      <View style={styles.candidateRow}>
                        <View
                          style={[
                            styles.checkbox,
                            {
                              borderColor: isSel ? colors.primary : colors.border,
                              backgroundColor: isSel ? colors.primary : "transparent",
                            },
                          ]}
                        >
                          {isSel ? (
                            <Feather name="check" size={13} color={colors.primaryForeground} />
                          ) : null}
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <View style={styles.candidateHead}>
                            <Text
                              style={[styles.candidateName, { color: colors.foreground }]}
                              numberOfLines={1}
                            >
                              {r.name}
                            </Text>
                            <View
                              style={[
                                styles.badge,
                                {
                                  backgroundColor: isNew
                                    ? "rgba(34,197,94,0.15)"
                                    : "rgba(59,130,246,0.15)",
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.badgeText,
                                  { color: isNew ? colors.success : colors.primary },
                                ]}
                              >
                                {isNew ? "NEW" : "UPDATE"}
                              </Text>
                            </View>
                          </View>
                          <Text style={[styles.candidateMeta, { color: colors.mutedForeground }]}>
                            {r.brand || "No customer"}
                            {r.shredderSetting ? ` · shredder ${r.shredderSetting}` : ""}
                            {` · ${r.components.length} ingredient${r.components.length === 1 ? "" : "s"}`}
                            {total > 0
                              ? ` · ${total.toLocaleString(undefined, { maximumFractionDigits: 2 })} lbs/batch`
                              : ""}
                          </Text>
                          {r.flavors.length > 0 ? (
                            <Text style={[styles.candidateMeta, { color: colors.mutedForeground }]}>
                              Flavors: {r.flavors.join(", ")}
                            </Text>
                          ) : (
                            <Text
                              style={[
                                styles.candidateMeta,
                                { color: colors.mutedForeground, fontStyle: "italic" },
                              ]}
                            >
                              All varieties
                            </Text>
                          )}
                        </View>
                      </View>
                    </Pressable>
                  );
                })}

                {prepared.note ? (
                  <View style={[styles.noteBox, { borderColor: colors.border }]}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Feather name="info" size={14} color={colors.mutedForeground} />
                      <Text style={[styles.errorTitle, { color: colors.foreground }]}>
                        Note
                      </Text>
                    </View>
                    <Text style={[styles.help, { color: colors.mutedForeground }]}>
                      {prepared.note}
                    </Text>
                  </View>
                ) : null}

                {nothing ? (
                  <View style={[styles.noteBox, { borderColor: colors.border }]}>
                    <Text style={[styles.help, { color: colors.mutedForeground }]}>
                      No cheese recipes were found in this workbook. Try a different
                      file.
                    </Text>
                  </View>
                ) : null}
              </>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              onPress={onClose}
              disabled={applying}
              style={({ pressed }) => [
                styles.btn,
                { borderColor: colors.border, opacity: applying ? 0.5 : pressed ? 0.7 : 1 },
              ]}
            >
              <Text style={{ color: colors.foreground, fontWeight: "600" }}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={confirm}
              disabled={confirmDisabled}
              style={({ pressed }) => [
                styles.btn,
                styles.btnPrimary,
                {
                  backgroundColor: colors.primary,
                  opacity: confirmDisabled ? 0.5 : pressed ? 0.85 : 1,
                },
              ]}
            >
              {applying ? (
                <ActivityIndicator color={colors.primaryForeground} size="small" />
              ) : (
                <Feather name="check-circle" size={15} color={colors.primaryForeground} />
              )}
              <Text style={{ color: colors.primaryForeground, fontWeight: "600" }}>
                Apply {selectedCount > 0 ? `${selectedCount} ` : ""}recipe
                {selectedCount === 1 ? "" : "s"}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    padding: 16,
  },
  sheet: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { fontSize: 16, fontWeight: "700" },
  center: { alignItems: "center", gap: 12, paddingVertical: 28 },
  help: { fontSize: 13, lineHeight: 18 },
  summaryCard: { borderWidth: 1, borderRadius: 10, padding: 12 },
  summaryTotal: { fontSize: 24, fontWeight: "800" },
  summaryLabel: { fontSize: 12, fontWeight: "600" },
  candidate: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  candidateRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  candidateHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  candidateName: { fontSize: 14, fontWeight: "600", flexShrink: 1 },
  candidateMeta: { fontSize: 12 },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 10, fontWeight: "700" },
  noteBox: { borderWidth: 1, borderRadius: 10, padding: 12, gap: 6 },
  errorBox: { borderWidth: 1, borderRadius: 10, padding: 12, gap: 6 },
  errorTitle: { fontSize: 13, fontWeight: "700" },
  footer: { flexDirection: "row", justifyContent: "flex-end", gap: 10 },
  btn: {
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  btnPrimary: { borderWidth: 0 },
});
