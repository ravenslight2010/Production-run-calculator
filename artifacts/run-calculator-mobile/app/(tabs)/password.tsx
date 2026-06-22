import React from "react";
import { ScrollView, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import ChangePasswordCard from "@/components/ChangePasswordCard";
import { useColors } from "@/hooks/useColors";

// Account self-service: change your own password. Reachable from the header
// menu on every screen (any signed-in user). Mirrors the web "Password" menu
// item, which opens the same ChangePasswordCard in a small dialog.
export default function PasswordScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + 100 }]}
    >
      <ChangePasswordCard />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
});
