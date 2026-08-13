import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { showConfirm } from "@/utils/notify";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CardSection, SectionHeader } from "@/components/UI";
import { FONTS } from "@/constants/fonts";
import { useRun, runLabel } from "@/context/RunContext";
import { useColors } from "@/hooks/useColors";
import { useMe } from "@/hooks/useRole";
import { useFactoryTimes } from "@/hooks/useFactoryTimes";
/** Validate an HH:MM time string (24-hour). */
function isValidTime(s: string): boolean {
  return /^\d{2}:\d{2}$/.test(s) && (() => {
    const [h, m] = s.split(":").map(Number);
    return h >= 0 && h <= 23 && m >= 0 && m <= 59;
  })();
}

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { run, runIndex, autoTrack, setAutoTrack, floorModeEnabled, setFloorModeEnabled, resetRun } = useRun();
  const { hasCapability } = useMe();
  const canManageFactorySettings = hasCapability("manage-factory-settings");
  const { times, saveShiftStart, saveProductionStart } = useFactoryTimes();

  // Local draft state so the user can type freely before committing on blur.
  const [shiftDraft, setShiftDraft] = useState<string | null>(null);
  const [prodDraft, setProdDraft] = useState<string | null>(null);

  const webTop = Platform.OS === "web" ? 67 : 0;
  const webBottom = Platform.OS === "web" ? 34 : 0;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: webTop + 8, paddingBottom: 90 + webBottom + insets.bottom },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Auto-track */}
        <SectionHeader title="Tracking" />
        <CardSection>
          <View style={styles.row}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={[styles.rowLabel, { color: colors.foreground }]}>
                Auto-track progress
              </Text>
              <Text style={[styles.rowHint, { color: colors.mutedForeground }]}>
                Update skids &amp; cases automatically from run time.
              </Text>
            </View>
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                setAutoTrack(!autoTrack);
              }}
              style={({ pressed }) => [
                styles.autoPill,
                {
                  backgroundColor: autoTrack ? colors.primary : colors.secondary,
                  borderColor: autoTrack ? colors.primary : colors.border,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Feather
                name="zap"
                size={12}
                color={autoTrack ? "#000" : colors.mutedForeground}
              />
              <Text
                style={[
                  styles.autoPillText,
                  { color: autoTrack ? "#000" : colors.mutedForeground },
                ]}
              >
                Auto {autoTrack ? "On" : "Off"}
              </Text>
            </Pressable>
          </View>
        </CardSection>

        {/* Floor Mode */}
        <SectionHeader title="Display" />
        <CardSection>
          <View style={styles.row}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={[styles.rowLabel, { color: colors.foreground }]}>
                Floor Mode
              </Text>
              <Text style={[styles.rowHint, { color: colors.mutedForeground }]}>
                Big-number idle monitor. Turn off to hide it and stop it
                auto-opening.
              </Text>
            </View>
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                setFloorModeEnabled(!floorModeEnabled);
              }}
              style={({ pressed }) => [
                styles.autoPill,
                {
                  backgroundColor: floorModeEnabled ? colors.primary : colors.secondary,
                  borderColor: floorModeEnabled ? colors.primary : colors.border,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Feather
                name="maximize"
                size={12}
                color={floorModeEnabled ? "#000" : colors.mutedForeground}
              />
              <Text
                style={[
                  styles.autoPillText,
                  { color: floorModeEnabled ? "#000" : colors.mutedForeground },
                ]}
              >
                {floorModeEnabled ? "On" : "Off"}
              </Text>
            </Pressable>
          </View>
        </CardSection>

        {/* Factory Shift Times */}
        <SectionHeader title="Factory Schedule" />
        <CardSection>
          {([
            {
              label: "Shift Start",
              value: times.shiftStartTime,
              draft: shiftDraft,
              setDraft: setShiftDraft,
              onSave: saveShiftStart,
            },
            {
              label: "Production Start",
              value: times.productionStartTime,
              draft: prodDraft,
              setDraft: setProdDraft,
              onSave: saveProductionStart,
            },
          ] as {
            label: string;
            value: string;
            draft: string | null;
            setDraft: (v: string | null) => void;
            onSave: (v: string) => void;
          }[]).map(({ label, value, draft, setDraft, onSave }, idx) => (
            <View
              key={label}
              style={[styles.timeRow, idx > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowLabel, { color: colors.foreground }]}>{label}</Text>
                <Text style={[styles.rowHint, { color: colors.mutedForeground }]}>
                  HH:MM (24-hour){!canManageFactorySettings ? " — managers can edit" : ""}
                </Text>
              </View>
              {canManageFactorySettings ? (
                <TextInput
                  value={draft ?? value}
                  onChangeText={setDraft}
                  onBlur={() => {
                    const v = (draft ?? value).trim();
                    if (isValidTime(v)) onSave(v);
                    setDraft(null);
                  }}
                  placeholder="HH:MM"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="numbers-and-punctuation"
                  maxLength={5}
                  style={[
                    styles.timeInput,
                    {
                      color: colors.foreground,
                      borderColor: colors.border,
                      backgroundColor: colors.background,
                    },
                  ]}
                />
              ) : (
                <Text style={[styles.timeDisplay, { color: colors.foreground }]}>
                  {value}
                </Text>
              )}
            </View>
          ))}
        </CardSection>

        {/* Master data */}
        <SectionHeader title="Data" />
        <Pressable
          onPress={() => router.push("/master-data")}
          style={({ pressed }) => [
            styles.linkBtn,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Feather name="database" size={16} color={colors.foreground} />
          <Text style={[styles.linkText, { color: colors.foreground }]}>
            Manage Master Data &amp; PIN
          </Text>
          <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
        </Pressable>

        {/* Setup Profiles editor (supervisor PIN-gated on the screen itself; mirrors web Settings) */}
        <Pressable
          onPress={() => router.push("/setup-profiles")}
          style={({ pressed }) => [
            styles.linkBtn,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              opacity: pressed ? 0.7 : 1,
              marginTop: 10,
            },
          ]}
        >
          <Feather name="sliders" size={16} color={colors.foreground} />
          <Text style={[styles.linkText, { color: colors.foreground }]}>
            Setup Profiles
          </Text>
          <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
        </Pressable>

        {/* Mixes make-day plan (open to all signed-in users; mirrors web) */}
        <Pressable
          onPress={() => router.push("/mixes")}
          style={({ pressed }) => [
            styles.linkBtn,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              opacity: pressed ? 0.7 : 1,
              marginTop: 10,
            },
          ]}
        >
          <Feather name="layers" size={16} color={colors.foreground} />
          <Text style={[styles.linkText, { color: colors.foreground }]}>
            Mixes
          </Text>
          <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
        </Pressable>

        {/* Reset */}
        <Pressable
          onPress={() => {
            showConfirm({
              title: "Reset This Run",
              message: `Reset "${runLabel(run, runIndex)}" to defaults? This clears its settings and progress.`,
              confirmText: "Reset",
              destructive: true,
              onConfirm: () => {
                resetRun();
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              },
            });
          }}
          style={({ pressed }) => [
            styles.resetBtn,
            { borderColor: "#ef4444", opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={[styles.resetBtnText, { color: "#ef4444" }]}>
            Reset This Run
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 16 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 13,
  },
  rowLabel: { fontSize: 16, fontWeight: "500" as const, fontFamily: FONTS.medium },
  rowHint: { fontSize: 12, marginTop: 3, lineHeight: 16, fontFamily: FONTS.regular },

  autoPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  autoPillText: { fontSize: 12, fontWeight: "700" as const, fontFamily: FONTS.bold },

  linkBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  linkText: { flex: 1, fontSize: 15, fontWeight: "600" as const, fontFamily: FONTS.semibold },

  resetBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 24,
    borderWidth: 1,
  },
  resetBtnText: { fontSize: 16, fontWeight: "600" as const, fontFamily: FONTS.semibold },

  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 13,
  },
  timeInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 15,
    fontFamily: FONTS.medium,
    minWidth: 70,
    textAlign: "center",
  },
  timeDisplay: {
    fontSize: 15,
    fontFamily: FONTS.medium,
    minWidth: 70,
    textAlign: "right",
  },
});
