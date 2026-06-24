import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
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
import type { PremixImportPrepared } from "@/context/premixImport";

type Props = {
  visible: boolean;
  onClose: () => void;
  loading: boolean;
  /** Multi-file parse progress; null for a single file. */
  progress?: { done: number; total: number } | null;
  error: string | null;
  prepared: PremixImportPrepared | null;
  applying: boolean;
  /** Confirm with the ids the manager chose to apply. */
  onConfirm: (selectedIds: string[]) => void;
};

// Review screen for the Excel premix-sheet importer. Each tab/block is parsed
// deterministically into a Mix and product names are matched against the app's
// known lists (AI only disambiguates names). The manager reviews every parsed
// mix — its matched product, batch size, components and days-early note — and
// can include/exclude each one before confirming. Mirrors the web dialog in
// artifacts/run-calculator/src/components/PremixImportDialog.tsx (replit.md parity).
export default function PremixImportModal({
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
  // Selected mix ids (default: all parsed mixes are selected for apply).
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Reset the selection whenever a fresh prepared result arrives.
  useEffect(() => {
    if (prepared) setSelected(new Set(prepared.candidates.map((c) => c.mix.id)));
    else setSelected(new Set());
  }, [prepared]);

  if (!visible) return null;

  const s = prepared?.summary;
  const nothing = s != null && s.total === 0;
  const candidates = prepared?.candidates ?? [];
  const selectedCount = candidates.filter((c) => selected.has(c.mix.id)).length;
  const confirmDisabled =
    loading || applying || !!error || !prepared || nothing || selectedCount === 0;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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
                Import Premix Sheet
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
                    ? `Reading file ${Math.min(progress.done + 1, progress.total)} of ${progress.total} and reading premix sheets…`
                    : "Reading the workbook and building mixes from each tab…"}
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
                  Review each mix below and uncheck any you don't want. Checked mixes
                  marked{" "}
                  <Text style={{ color: colors.foreground, fontWeight: "600" }}>
                    update
                  </Text>{" "}
                  replace the existing mix;{" "}
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
                    of {s!.total} mixes selected
                  </Text>
                  <View style={{ flexDirection: "row", gap: 12, marginTop: 6 }}>
                    <Text style={[styles.summaryStat, { color: colors.success }]}>
                      {s!.created} new
                    </Text>
                    <Text style={[styles.summaryStat, { color: colors.primary }]}>
                      {s!.updated} updated
                    </Text>
                  </View>
                </View>

                {candidates.map((c) => {
                  const m = c.mix;
                  const isSel = selected.has(m.id);
                  const product = [m.brand, m.flavor].filter(Boolean).join(" — ");
                  const isNew = c.status === "new";
                  return (
                    <Pressable
                      key={m.id}
                      onPress={() => toggle(m.id)}
                      testID={`premix-candidate-${m.id}`}
                      style={[styles.candidate, { borderColor: colors.border }]}
                    >
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
                            {m.name}
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
                              {c.status.toUpperCase()}
                            </Text>
                          </View>
                        </View>
                        <Text style={[styles.candidateMeta, { color: colors.mutedForeground }]}>
                          {product ? `Matched to ${product}` : "No product match"}
                        </Text>
                        <Text style={[styles.candidateMeta, { color: colors.mutedForeground }]}>
                          Batch{" "}
                          {m.batchSize.toLocaleString(undefined, {
                            maximumFractionDigits: 4,
                          })}{" "}
                          lbs · {m.components.length} ingredient
                          {m.components.length === 1 ? "" : "s"}
                          {m.daysEarly > 0
                            ? ` · pull ${m.daysEarly} day${m.daysEarly === 1 ? "" : "s"} early`
                            : ""}
                        </Text>
                        {m.notes ? (
                          <Text
                            style={[
                              styles.candidateMeta,
                              { color: colors.mutedForeground, fontStyle: "italic" },
                            ]}
                          >
                            {m.notes}
                          </Text>
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })}

                {prepared.newAliases.length > 0 ? (
                  <Text style={[styles.note, { color: colors.mutedForeground }]}>
                    {prepared.newAliases.length} new name mapping
                    {prepared.newAliases.length === 1 ? "" : "s"} will be remembered
                    for future imports.
                  </Text>
                ) : null}

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
                      No premix blocks were found in this workbook. Try a different
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
              onPress={() => onConfirm([...selected])}
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
                Apply {selectedCount > 0 ? `${selectedCount} ` : ""}mix
                {selectedCount === 1 ? "" : "es"}
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
  summaryStat: { fontSize: 12, fontWeight: "600" },
  candidate: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
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
  candidateMeta: { fontSize: 12, marginTop: 2 },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 10, fontWeight: "700" },
  note: { fontSize: 12 },
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
