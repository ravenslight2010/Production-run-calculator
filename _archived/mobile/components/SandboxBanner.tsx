import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { FONTS } from "@/constants/fonts";

// Persistent, always-visible strip shown while signed in as the seeded sandbox
// account. It floats just below the status bar (above the navigator header) and
// offers a "Reset" action that re-copies live → sandbox. Mirrors the web
// sandbox banner in artifacts/run-calculator/src/pages/home.tsx (replit.md
// parity). Renders nothing for non-sandbox sessions.
// Format the sandbox "copied from live" ISO timestamp for the banner. Shows a
// short local date + time; falls back to the raw value if it can't be parsed.
function fmtCopiedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function SandboxBanner({
  visible,
  copiedAt,
  onReset,
}: {
  visible: boolean;
  copiedAt?: string | null;
  onReset: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const accent = colors.warning ?? colors.primary;
  if (!visible) return null;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { top: insets.top }]}
    >
      <View
        accessibilityRole="alert"
        style={[
          styles.banner,
          { backgroundColor: accent + "22", borderColor: accent + "66" },
        ]}
      >
        <Feather name="alert-triangle" size={14} color={accent} />
        <Text style={[styles.text, { color: colors.foreground }]} numberOfLines={1}>
          {copiedAt
            ? `Sandbox — copied from live at ${fmtCopiedAt(copiedAt)}.`
            : "Sandbox mode — changes never affect live data."}
        </Text>
        <Pressable
          onPress={onReset}
          hitSlop={8}
          accessibilityLabel="Reset sandbox"
          style={({ pressed }) => [
            styles.resetBtn,
            { borderColor: accent + "88", opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Feather name="rotate-ccw" size={12} color={accent} />
          <Text style={[styles.resetText, { color: accent }]}>Reset</Text>
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
    zIndex: 200,
    paddingHorizontal: 12,
    paddingTop: 4,
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  text: { flex: 1, fontSize: 12, fontFamily: FONTS.medium },
  resetBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  resetText: { fontSize: 12, fontFamily: FONTS.semibold },
});
