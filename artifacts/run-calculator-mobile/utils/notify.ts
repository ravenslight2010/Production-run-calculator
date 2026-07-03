import { Alert, Platform } from "react-native";

import { presentWebDialog } from "@/utils/webDialog";

// RN Alert.alert is a silent no-op on Expo web, so import summaries (e.g. the
// "already ran today, skipped" note) were invisible in the browser. This helper
// keeps native behavior identical; on web it renders a styled in-app dialog
// via WebDialogHost (mounted in app/_layout.tsx), falling back to window.alert
// only if the host isn't mounted yet.
export function showNote(title: string, message?: string): void {
  if (Platform.OS === "web") {
    if (presentWebDialog({ kind: "note", title, message })) return;
    const text = message ? `${title}\n\n${message}` : title;
    if (typeof window !== "undefined" && typeof window.alert === "function") {
      window.alert(text);
    }
    return;
  }
  Alert.alert(title, message);
}

// Button-style confirmation dialogs (Cancel + one action) are also silent
// no-ops on Expo web, so destructive actions like "Undo change", "Delete run",
// or "Remove staff member" did nothing in the browser. On web we render the
// same styled in-app dialog (with a red button when destructive), falling back
// to window.confirm if the host isn't mounted; on native we keep the exact
// Alert.alert two-button dialog.
export function showConfirm(opts: {
  title: string;
  message?: string;
  confirmText: string;
  cancelText?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
}): void {
  const { title, message, confirmText, cancelText, destructive, onConfirm, onCancel } =
    opts;
  if (Platform.OS === "web") {
    const handled = presentWebDialog({
      kind: "confirm",
      title,
      message,
      confirmText,
      cancelText,
      destructive,
      onConfirm,
      onCancel,
    });
    if (handled) return;
    const text = message ? `${title}\n\n${message}` : title;
    const ok =
      typeof window !== "undefined" && typeof window.confirm === "function"
        ? window.confirm(text)
        : false;
    if (ok) onConfirm();
    else onCancel?.();
    return;
  }
  Alert.alert(title, message, [
    { text: cancelText ?? "Cancel", style: "cancel", onPress: onCancel },
    {
      text: confirmText,
      style: destructive ? "destructive" : "default",
      onPress: onConfirm,
    },
  ]);
}
