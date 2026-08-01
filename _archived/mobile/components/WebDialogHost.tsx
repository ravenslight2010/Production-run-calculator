import React, { useCallback, useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { FONTS } from "@/constants/fonts";
import { useColors } from "@/hooks/useColors";
import {
  registerWebDialogPresenter,
  type WebDialogRequest,
} from "@/utils/webDialog";

// In-app replacement for window.alert / window.confirm on Expo web, so notes
// and confirmations render in the app's own styling (dark card, amber action,
// red destructive button) instead of the unstyled browser boxes. Mounted once
// in app/_layout.tsx; notify.ts routes web requests here via utils/webDialog.
// Requests are queued so back-to-back calls (e.g. two notes in a row) each get
// shown instead of the second clobbering the first.
export default function WebDialogHost() {
  const colors = useColors();
  const [queue, setQueue] = useState<WebDialogRequest[]>([]);

  useEffect(() => {
    return registerWebDialogPresenter((req) => {
      setQueue((q) => [...q, req]);
    });
  }, []);

  const current = queue[0] ?? null;

  const dismiss = useCallback(() => {
    setQueue((q) => q.slice(1));
  }, []);

  const handleCancel = useCallback(() => {
    const req = queue[0];
    dismiss();
    req?.onCancel?.();
  }, [queue, dismiss]);

  const handleConfirm = useCallback(() => {
    const req = queue[0];
    dismiss();
    req?.onConfirm?.();
  }, [queue, dismiss]);

  if (!current) return null;

  const isConfirm = current.kind === "confirm";
  const actionBg = current.destructive ? colors.destructive : colors.primary;
  const actionFg = current.destructive
    ? colors.destructiveForeground
    : colors.primaryForeground;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      // Browser Esc / back: treat as cancel for confirms, dismiss for notes.
      onRequestClose={isConfirm ? handleCancel : handleConfirm}
    >
      <Pressable
        style={styles.overlay}
        // Tapping the backdrop cancels a confirm but never triggers the action.
        onPress={isConfirm ? handleCancel : handleConfirm}
      >
        <Pressable
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: colors.radius * 2,
            },
          ]}
          // Swallow taps inside the card so they don't hit the backdrop.
          onPress={() => {}}
        >
          <Text style={[styles.title, { color: colors.foreground }]}>
            {current.title}
          </Text>
          {current.message ? (
            // Long notes (e.g. multi-line import summaries) scroll instead of
            // pushing the buttons off-screen on small browser windows.
            <ScrollView style={styles.messageScroll}>
              <Text style={[styles.message, { color: colors.mutedForeground }]}>
                {current.message}
              </Text>
            </ScrollView>
          ) : null}
          <View style={styles.buttonRow}>
            {isConfirm ? (
              <Pressable
                onPress={handleCancel}
                style={({ pressed }) => [
                  styles.button,
                  {
                    backgroundColor: colors.secondary,
                    borderColor: colors.border,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderRadius: colors.radius,
                    opacity: pressed ? 0.75 : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.buttonText,
                    { color: colors.secondaryForeground },
                  ]}
                >
                  {current.cancelText ?? "Cancel"}
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={handleConfirm}
              style={({ pressed }) => [
                styles.button,
                {
                  backgroundColor: actionBg,
                  borderRadius: colors.radius,
                  opacity: pressed ? 0.75 : 1,
                },
              ]}
            >
              <Text style={[styles.buttonText, { color: actionFg }]}>
                {isConfirm ? current.confirmText ?? "OK" : "OK"}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 400,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 20,
  },
  title: {
    fontFamily: FONTS.semibold,
    fontSize: 17,
    lineHeight: 22,
  },
  messageScroll: {
    marginTop: 8,
    maxHeight: 320,
  },
  message: {
    fontFamily: FONTS.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  buttonRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 20,
  },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    minWidth: 84,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: {
    fontFamily: FONTS.semibold,
    fontSize: 14,
  },
});
