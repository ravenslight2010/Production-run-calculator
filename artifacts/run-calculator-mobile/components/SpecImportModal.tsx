import { Feather } from "@expo/vector-icons";
import React from "react";
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
import type { SpecImportPrepared } from "@/context/specImport";

type Props = {
  visible: boolean;
  onClose: () => void;
  loading: boolean;
  error: string | null;
  prepared: SpecImportPrepared | null;
  applying: boolean;
  onConfirm: () => void;
};

// Single review/summary screen for the Excel spec-sheet importer. Per product
// decision there are NO per-item prompts: the AI parses the workbook, names are
// canonicalized against the app's known lists + learned aliases, and the user
// just sees what will be created vs overwritten before confirming. Mirrors the
// web dialog in artifacts/run-calculator/src/components/SpecImportDialog.tsx
// (replit.md parity).
export default function SpecImportModal({
  visible,
  onClose,
  loading,
  error,
  prepared,
  applying,
  onConfirm,
}: Props) {
  const colors = useColors();
  if (!visible) return null;

  const s = prepared?.summary;
  const nothing = s != null && s.totalProfiles === 0 && s.totalRecipes === 0;

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
                Import Spec Sheet
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
                  Reading the workbook and interpreting spec sheets &amp; recipes…
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
                  Review what will be applied. Existing brand/flavor profiles and
                  recipes will be{" "}
                  <Text style={{ color: colors.foreground, fontWeight: "600" }}>
                    overwritten
                  </Text>
                  ; new ones will be{" "}
                  <Text style={{ color: colors.foreground, fontWeight: "600" }}>
                    added
                  </Text>
                  .
                </Text>

                <View style={styles.cardRow}>
                  <SummaryCard
                    label="Spec profiles"
                    total={s!.totalProfiles}
                    created={s!.profilesNew}
                    updated={s!.profilesUpdated}
                  />
                  <SummaryCard
                    label="Recipes"
                    total={s!.totalRecipes}
                    created={s!.recipesNew}
                    updated={s!.recipesUpdated}
                  />
                </View>

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
                        Note from the parser
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
                      Nothing recognizable was found in this workbook. Try a
                      different file.
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
              onPress={onConfirm}
              disabled={loading || applying || !!error || !prepared || nothing}
              style={({ pressed }) => [
                styles.btn,
                styles.btnPrimary,
                {
                  backgroundColor: colors.primary,
                  opacity:
                    loading || applying || !!error || !prepared || nothing
                      ? 0.5
                      : pressed
                        ? 0.85
                        : 1,
                },
              ]}
            >
              {applying ? (
                <ActivityIndicator color={colors.primaryForeground} size="small" />
              ) : (
                <Feather name="check-circle" size={15} color={colors.primaryForeground} />
              )}
              <Text style={{ color: colors.primaryForeground, fontWeight: "600" }}>
                Apply import
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function SummaryCard({
  label,
  total,
  created,
  updated,
}: {
  label: string;
  total: number;
  created: number;
  updated: number;
}) {
  const colors = useColors();
  return (
    <View style={[styles.summaryCard, { borderColor: colors.border }]}>
      <Text style={[styles.summaryTotal, { color: colors.foreground }]}>{total}</Text>
      <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={{ flexDirection: "row", gap: 12, marginTop: 6 }}>
        <Text style={[styles.summaryStat, { color: colors.success }]}>{created} new</Text>
        <Text style={[styles.summaryStat, { color: colors.primary }]}>{updated} updated</Text>
      </View>
    </View>
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
  cardRow: { flexDirection: "row", gap: 12 },
  summaryCard: { flex: 1, borderWidth: 1, borderRadius: 10, padding: 12 },
  summaryTotal: { fontSize: 24, fontWeight: "800" },
  summaryLabel: { fontSize: 12, fontWeight: "600" },
  summaryStat: { fontSize: 12, fontWeight: "600" },
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
