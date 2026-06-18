import { Feather } from "@expo/vector-icons";
import React from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONTS } from "@/constants/fonts";
import { useColors } from "@/hooks/useColors";

// Plain-language overview of the app shown automatically on a user's first
// login and reopenable any time from the header menu. The copy and structure
// are kept identical to the web "Get Started" dialog for parity.

type Entry = { icon: keyof typeof Feather.glyphMap; label: string; desc: string };

const TABS: Entry[] = [
  {
    icon: "bar-chart-2",
    label: "Run",
    desc: "Set up the current run (brand, flavor, cases) and track live progress, timing, and stoppages.",
  },
  {
    icon: "layers",
    label: "Dough / Crusts",
    desc: "See how many dough batches or crust trays you need and when to start the next batch.",
  },
  {
    icon: "droplet",
    label: "Sauce",
    desc: "Sauce batches and barrels required for the run.",
  },
  {
    icon: "grid",
    label: "Frontline",
    desc: "Cheese, applicators, and pepperoni amounts for the line.",
  },
  {
    icon: "package",
    label: "Packaging",
    desc: "Circles, shippers, and cartons needed to pack the run.",
  },
  {
    icon: "archive",
    label: "Warehouse",
    desc: "Finished-goods roll-up: pizzas, cases, and pallets produced.",
  },
];

const MENU: Entry[] = [
  { icon: "bar-chart-2", label: "Stoppages & Summary", desc: "Log downtime and review shift totals and exports." },
  { icon: "clipboard", label: "Stock", desc: "On-hand inventory, lots, and restocks." },
  { icon: "zap", label: "AI Assistant", desc: "Run, break, and efficiency recommendations." },
  { icon: "calendar", label: "Schedule", desc: "Plan future production days." },
  { icon: "settings", label: "Setup & Settings", desc: "Run configuration, recipes, and app options." },
  { icon: "life-buoy", label: "Report an issue", desc: "Get instant help and alert your manager." },
];

export default function GetStartedModal({
  visible,
  onDismiss,
  isManager,
}: {
  visible: boolean;
  // Called whenever the overview is dismissed (button, swipe, or back), so the
  // caller can mark it seen and close it.
  onDismiss: () => void;
  isManager: boolean;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const renderEntry = (e: Entry) => (
    <View key={e.label} style={styles.entry}>
      <View style={[styles.entryIcon, { backgroundColor: colors.primary + "1a" }]}>
        <Feather name={e.icon} size={16} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.entryLabel, { color: colors.foreground }]}>{e.label}</Text>
        <Text style={[styles.entryDesc, { color: colors.mutedForeground }]}>{e.desc}</Text>
      </View>
    </View>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <Pressable style={styles.overlay} onPress={onDismiss}>
        <Pressable
          style={[
            styles.sheet,
            { backgroundColor: colors.card, paddingBottom: 16 + insets.bottom },
          ]}
          onPress={() => {}}
        >
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <View style={styles.titleRow}>
            <Feather name="box" size={20} color={colors.primary} />
            <Text style={[styles.title, { color: colors.foreground }]}>
              Welcome to Production Run Calculator
            </Text>
          </View>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Plan, run, and track your pizza production line — from dough and sauce
            to packaging and warehouse — all in one place.
          </Text>

          <ScrollView
            style={{ maxHeight: 420 }}
            contentContainerStyle={{ gap: 16, paddingVertical: 8 }}
            showsVerticalScrollIndicator={false}
          >
            <View style={{ gap: 12 }}>
              <Text style={[styles.section, { color: colors.mutedForeground }]}>
                THE MAIN TABS
              </Text>
              {TABS.map(renderEntry)}
            </View>
            <View style={{ gap: 12 }}>
              <Text style={[styles.section, { color: colors.mutedForeground }]}>
                MORE IN THE MENU
              </Text>
              {MENU.map(renderEntry)}
              {isManager &&
                renderEntry({
                  icon: "life-buoy",
                  label: "Reported issues",
                  desc: "Managers can review reported problems and crashes.",
                })}
            </View>
          </ScrollView>

          <Pressable
            onPress={onDismiss}
            style={({ pressed }) => [
              styles.btn,
              { backgroundColor: colors.primary, opacity: pressed ? 0.9 : 1 },
            ]}
          >
            <Text style={[styles.btnText, { color: colors.primaryForeground }]}>
              Get started
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 8 },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 8 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 18, fontFamily: FONTS.bold, flex: 1 },
  subtitle: { fontSize: 13, fontFamily: FONTS.regular, lineHeight: 19 },
  section: { fontSize: 11, fontFamily: FONTS.semibold, letterSpacing: 0.5 },
  entry: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  entryIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  entryLabel: { fontSize: 14, fontFamily: FONTS.semibold },
  entryDesc: { fontSize: 12, fontFamily: FONTS.regular, lineHeight: 17, marginTop: 1 },
  btn: {
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  btnText: { fontSize: 15, fontFamily: FONTS.semibold },
});
