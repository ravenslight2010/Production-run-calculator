import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONTS } from "@/constants/fonts";
import { useColors } from "@/hooks/useColors";

// Multi-step guided walkthrough that highlights each main tab in sequence. As
// each tab step becomes active it navigates to the matching route (via
// onNavigate) so the user sees the real screen while reading about it. Kept at
// copy/structure parity with the web GuidedTour.

type TourStep = {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  body: string;
  // When set, the app navigates to this route as the step is shown.
  route?: string;
};

function buildSteps(isManager: boolean): TourStep[] {
  return [
    {
      icon: "compass",
      title: "Let's take a quick tour",
      body: "We'll step through each tab so you know where everything lives. You can go back, skip, or close at any time.",
    },
    {
      icon: "bar-chart-2",
      title: "Run",
      body: "Set up the current run (brand, flavor, cases) and track live progress, timing, and stoppages.",
      route: "/(tabs)",
    },
    {
      icon: "layers",
      title: "Dough / Crusts",
      body: "See how many dough batches or crust trays you need and when to start the next batch.",
      route: "/(tabs)/dough",
    },
    {
      icon: "droplet",
      title: "Sauce",
      body: "Sauce batches and barrels required for the run.",
      route: "/(tabs)/sauce",
    },
    {
      icon: "grid",
      title: "Frontline",
      body: "Cheese, applicators, and pepperoni amounts for the line.",
      route: "/(tabs)/frontline",
    },
    {
      icon: "package",
      title: "Packaging",
      body: "Circles, shippers, and cartons needed to pack the run.",
      route: "/(tabs)/packaging",
    },
    {
      icon: "archive",
      title: "Warehouse",
      body: "Finished-goods roll-up: pizzas, cases, and pallets produced.",
      route: "/(tabs)/warehouse",
    },
    {
      icon: "more-horizontal",
      title: "More in the menu",
      body: isManager
        ? "Open the top-right menu for Stoppages & Summary, Stock, the AI Assistant, Schedule, Setup & Settings, Reported issues, and Report an issue."
        : "Open the top-right menu for Stoppages & Summary, Stock, the AI Assistant, Schedule, Setup & Settings, and Report an issue.",
    },
  ];
}

export default function GuidedTour({
  visible,
  onClose,
  onComplete,
  onNavigate,
  isManager,
}: {
  visible: boolean;
  onClose: () => void;
  // Fired when the user reaches the final step and taps "Done", so the caller
  // can record that this user finished the tour. Skipping/closing won't fire it.
  onComplete?: () => void;
  // Navigate the app to a given route as tour steps advance.
  onNavigate: (route: string) => void;
  isManager: boolean;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const steps = buildSteps(isManager);
  const [index, setIndex] = useState(0);

  // Reset to the first step every time the tour is opened.
  useEffect(() => {
    if (visible) setIndex(0);
  }, [visible]);

  // Navigate to the step's route whenever it targets one.
  useEffect(() => {
    if (!visible) return;
    const route = steps[index]?.route;
    if (route) onNavigate(route);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, index]);

  if (!visible) return null;

  const step = steps[index];
  const isFirst = index === 0;
  const isLast = index === steps.length - 1;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View
          style={[
            styles.sheet,
            { backgroundColor: colors.card, paddingBottom: 16 + insets.bottom },
          ]}
        >
          <View style={styles.titleRow}>
            <View style={[styles.icon, { backgroundColor: colors.primary + "1a" }]}>
              <Feather name={step.icon} size={20} color={colors.primary} />
            </View>
            <Text style={[styles.title, { color: colors.foreground }]}>{step.title}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close tour">
              <Feather name="x" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>

          <Text style={[styles.body, { color: colors.mutedForeground }]}>{step.body}</Text>

          <View style={styles.progressRow}>
            <View style={styles.dots}>
              {steps.map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.dot,
                    i === index
                      ? { width: 16, backgroundColor: colors.primary }
                      : { width: 6, backgroundColor: colors.mutedForeground + "55" },
                  ]}
                />
              ))}
            </View>
            <Text style={[styles.counter, { color: colors.mutedForeground }]}>
              {index + 1} / {steps.length}
            </Text>
          </View>

          <View style={styles.actions}>
            <Pressable
              onPress={isFirst ? onClose : () => setIndex((i) => Math.max(0, i - 1))}
              style={({ pressed }) => [styles.ghostBtn, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Text style={[styles.ghostText, { color: colors.mutedForeground }]}>
                {isFirst ? "Skip" : "Back"}
              </Text>
            </Pressable>
            <Pressable
              onPress={
                isLast
                  ? () => {
                      onComplete?.();
                      onClose();
                    }
                  : () => setIndex((i) => Math.min(steps.length - 1, i + 1))
              }
              style={({ pressed }) => [
                styles.primaryBtn,
                { backgroundColor: colors.primary, opacity: pressed ? 0.9 : 1 },
              ]}
            >
              <Text style={[styles.primaryText, { color: colors.primaryForeground }]}>
                {isLast ? "Done" : "Next"}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    gap: 12,
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 17, fontFamily: FONTS.bold, flex: 1 },
  body: { fontSize: 14, fontFamily: FONTS.regular, lineHeight: 20 },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dots: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { height: 6, borderRadius: 3 },
  counter: { fontSize: 12, fontFamily: FONTS.regular },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  },
  ghostBtn: { paddingVertical: 11, paddingHorizontal: 14 },
  ghostText: { fontSize: 15, fontFamily: FONTS.semibold },
  primaryBtn: {
    paddingVertical: 11,
    paddingHorizontal: 22,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { fontSize: 15, fontFamily: FONTS.semibold },
});
