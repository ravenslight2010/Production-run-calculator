import { Feather } from "@expo/vector-icons";
import { useMutation } from "@tanstack/react-query";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONTS } from "@/constants/fonts";
import {
  InventoryApiError,
  reportIncident,
  type IncidentDiagnosis,
} from "@/context/inventoryShared";
import { useColors } from "@/hooks/useColors";

function serverMessage(error: unknown, fallback: string): string {
  return error instanceof InventoryApiError && error.serverMessage
    ? error.serverMessage
    : fallback;
}

// Any signed-in user can describe a problem and get an immediate plain-language
// diagnosis + workaround back. The report is also stored server-side so managers
// can review it. `screen` records where the user was. Mirrors the web
// ReportIssueDialog.
export default function ReportIssueModal({
  visible,
  onClose,
  screen,
}: {
  visible: boolean;
  onClose: () => void;
  screen: string;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [description, setDescription] = useState("");
  const [result, setResult] = useState<IncidentDiagnosis | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      reportIncident({
        source: "user_report",
        screen,
        appPlatform: "mobile",
        description: description.trim(),
        userAgent: `${Platform.OS} ${Platform.Version}`,
      }),
    onSuccess: (data) => setResult(data),
  });

  function reset() {
    setDescription("");
    setResult(null);
    mutation.reset();
  }

  function handleClose() {
    reset();
    onClose();
  }

  const canSubmit = description.trim().length > 0 && !mutation.isPending;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <Pressable style={styles.overlay} onPress={handleClose}>
        <Pressable
          style={[
            styles.sheet,
            { backgroundColor: colors.card, paddingBottom: 24 + insets.bottom },
          ]}
          onPress={() => {}}
        >
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <View style={styles.titleRow}>
            <Feather name="life-buoy" size={20} color={colors.primary} />
            <Text style={[styles.title, { color: colors.foreground }]}>
              Report an issue
            </Text>
          </View>

          {result ? (
            <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ gap: 12 }}>
              <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
                Here's what's likely happening and what to try.
              </Text>
              <View style={[styles.resultCard, { borderColor: colors.border, backgroundColor: colors.secondary }]}>
                <Text style={[styles.resultLabel, { color: colors.foreground }]}>
                  What's happening
                </Text>
                <Text style={[styles.resultBody, { color: colors.mutedForeground }]}>
                  {result.diagnosis}
                </Text>
              </View>
              <View style={[styles.resultCard, { borderColor: colors.border, backgroundColor: colors.secondary }]}>
                <Text style={[styles.resultLabel, { color: colors.foreground }]}>
                  What to try
                </Text>
                <Text style={[styles.resultBody, { color: colors.mutedForeground }]}>
                  {result.workaround}
                </Text>
              </View>
              <Text style={[styles.note, { color: colors.mutedForeground }]}>
                This report was sent to your manager for review.
              </Text>
              <View style={styles.btnRow}>
                <Pressable
                  onPress={reset}
                  style={({ pressed }) => [
                    styles.btn,
                    styles.btnOutline,
                    { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <Text style={[styles.btnText, { color: colors.foreground }]}>
                    Report another
                  </Text>
                </Pressable>
                <Pressable
                  onPress={handleClose}
                  style={({ pressed }) => [
                    styles.btn,
                    { backgroundColor: colors.primary, opacity: pressed ? 0.9 : 1 },
                  ]}
                >
                  <Text style={[styles.btnText, { color: colors.primaryForeground }]}>
                    Done
                  </Text>
                </Pressable>
              </View>
            </ScrollView>
          ) : (
            <View style={{ gap: 12 }}>
              <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
                Describe what went wrong. We'll explain it in plain language and
                suggest a workaround.
              </Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="e.g. I tapped Save on the run and nothing happened…"
                placeholderTextColor={colors.mutedForeground}
                multiline
                style={[
                  styles.input,
                  {
                    color: colors.foreground,
                    borderColor: colors.border,
                    backgroundColor: colors.background,
                  },
                ]}
              />
              {mutation.isError && (
                <Text style={[styles.error, { color: colors.destructive }]}>
                  {serverMessage(
                    mutation.error,
                    "Couldn't send your report. Please try again.",
                  )}
                </Text>
              )}
              <View style={styles.btnRow}>
                <Pressable
                  onPress={handleClose}
                  style={({ pressed }) => [
                    styles.btn,
                    styles.btnOutline,
                    { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <Text style={[styles.btnText, { color: colors.foreground }]}>
                    Cancel
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => mutation.mutate()}
                  disabled={!canSubmit}
                  style={({ pressed }) => [
                    styles.btn,
                    {
                      backgroundColor: colors.primary,
                      opacity: !canSubmit ? 0.5 : pressed ? 0.9 : 1,
                    },
                  ]}
                >
                  {mutation.isPending ? (
                    <ActivityIndicator color={colors.primaryForeground} />
                  ) : (
                    <Text style={[styles.btnText, { color: colors.primaryForeground }]}>
                      Get help
                    </Text>
                  )}
                </Pressable>
              </View>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 10 },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 8 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  title: { fontSize: 18, fontFamily: FONTS.bold },
  subtitle: { fontSize: 13, fontFamily: FONTS.regular, lineHeight: 19 },
  input: {
    minHeight: 110,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 15,
    fontFamily: FONTS.regular,
    textAlignVertical: "top",
  },
  error: { fontSize: 13, fontFamily: FONTS.medium },
  resultCard: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 4 },
  resultLabel: { fontSize: 13, fontFamily: FONTS.semibold },
  resultBody: { fontSize: 14, fontFamily: FONTS.regular, lineHeight: 20 },
  note: { fontSize: 12, fontFamily: FONTS.regular },
  btnRow: { flexDirection: "row", gap: 10, marginTop: 4 },
  btn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  btnOutline: { borderWidth: 1 },
  btnText: { fontSize: 15, fontFamily: FONTS.semibold },
});
