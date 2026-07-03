import { Alert, Platform } from "react-native";

// RN Alert.alert is a silent no-op on Expo web, so import summaries (e.g. the
// "already ran today, skipped" note) were invisible in the browser. This helper
// keeps native behavior identical and falls back to window.alert on web.
export function showNote(title: string, message?: string): void {
  if (Platform.OS === "web") {
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
// or "Remove staff member" did nothing in the browser. On web we fall back to
// window.confirm; on native we keep the exact Alert.alert two-button dialog.
export function showConfirm(opts: {
  title: string;
  message?: string;
  confirmText: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
}): void {
  const { title, message, confirmText, destructive, onConfirm, onCancel } = opts;
  if (Platform.OS === "web") {
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
    { text: "Cancel", style: "cancel", onPress: onCancel },
    {
      text: confirmText,
      style: destructive ? "destructive" : "default",
      onPress: onConfirm,
    },
  ]);
}
