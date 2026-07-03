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
