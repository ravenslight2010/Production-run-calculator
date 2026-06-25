import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { FONTS } from "@/constants/fonts";

// Dismissible error banner shown when a best-effort server write (an
// inventory-consume after a run finishes) ultimately failed. Previously these
// failures were swallowed silently; this surfaces them so stock counts that
// drifted out of sync don't go unnoticed. Mirrors the web red banner in
// artifacts/run-calculator/src/pages/home.tsx (replit.md parity).
export default function SyncWriteErrorBanner({
  message,
  onDismiss,
}: {
  message: string | null;
  onDismiss: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  if (!message) return null;

  const accent = colors.destructive ?? "#ef4444";

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + 4 }]}>
      <View
        accessibilityRole="alert"
        style={[styles.banner, { backgroundColor: colors.card, borderColor: accent + "66" }]}
      >
        <View style={[styles.iconWrap, { backgroundColor: accent + "22" }]}>
          <Feather name="alert-triangle" size={16} color={accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.detail, { color: colors.foreground }]} numberOfLines={4}>
            {message}
          </Text>
        </View>
        <Pressable
          onPress={onDismiss}
          hitSlop={10}
          accessibilityLabel="Dismiss"
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
  detail: { fontSize: 13, fontFamily: FONTS.regular, lineHeight: 18 },
  close: { padding: 2 },
});
