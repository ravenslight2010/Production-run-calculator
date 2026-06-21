import React from "react";
import { ScrollView, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import RolesManager from "@/components/RolesManager";
import { useColors } from "@/hooks/useColors";

// Manager-only dedicated Roles management screen. Mirrors the web Roles tab:
// create, rename, edit capabilities of, and delete roles, and reassign the
// staff who hold each role — all from one place. The RolesManager card gates
// itself on the manage-staff capability and the server enforces guardrails.
export default function RolesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + 100 }]}
    >
      <RolesManager />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
});
