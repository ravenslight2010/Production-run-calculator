import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { FONTS } from "@/constants/fonts";
import type { ProactiveAlert } from "@/context/aiProactive";

// Non-intrusive, dismissible banner for a single proactive shift nudge. Floats
// just below the header; renders nothing when there's no alert. Mirrors the web
// banner in artifacts/run-calculator/src/components/ProactiveAlertBanner.tsx
// (replit.md parity).
export default function ProactiveAlertBanner({
  alert,
  onDismiss,
}: {
  alert: ProactiveAlert | null;
  onDismiss: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  if (!alert) return null;

  const icon: keyof typeof Feather.glyphMap =
    alert.category === "break" ? "coffee" : alert.category === "efficiency" ? "zap" : "alert-triangle";

  const accent = alert.impact === "high" ? colors.warning ?? colors.primary : colors.primary;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { top: insets.top + 4 }]}
    >
      <View
        accessibilityRole="alert"
        style={[
          styles.banner,
          { backgroundColor: colors.card, borderColor: accent + "66" },
        ]}
      >
        <View style={[styles.iconWrap, { backgroundColor: accent + "22" }]}>
          <Feather name={icon} size={16} color={accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={2}>
            {alert.title}
          </Text>
          <Text style={[styles.detail, { color: colors.mutedForeground }]} numberOfLines={3}>
            {alert.detail}
          </Text>
        </View>
        <Pressable
          onPress={onDismiss}
          hitSlop={10}
          accessibilityLabel="Dismiss alert"
          style={({ pressed }) => [styles.close, { opacity: pressed ? 0.5 : 1 }]}
        >
          <Feather name="x" size={18} color={colors.mutedForeground} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 100,
    paddingHorizontal: 12,
  },
  banner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  iconWrap: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 14, fontFamily: FONTS.semibold },
  detail: { fontSize: 12, marginTop: 2, fontFamily: FONTS.regular, lineHeight: 16 },
  close: { padding: 2 },
});
