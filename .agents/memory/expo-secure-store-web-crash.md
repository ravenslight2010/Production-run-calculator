---
name: expo-secure-store crashes the Expo web build
description: SecureStore has no web impl; calling it white-screens the mobile app in the Replit preview and test harness.
---

`expo-secure-store` has NO web implementation — its native methods
(`getItemAsync`, `setItemAsync`, `deleteItemAsync`) are undefined on web. The
mobile app's auth token persistence calls these directly, which throws
`ExpoSecureStore.default.deleteValueWithKeyAsync is not a function` and blanks the
ENTIRE app on the Expo web build. Native (iOS/Android) is fine, but the Replit
mobile preview and the Playwright UI test harness both run the web build, so the
mobile app looks completely broken there.

**Why:** the Replit preview/test path for an Expo artifact is the web bundle, not
a native device — so any native-only module silently breaks the previewed app.

**How to apply:** branch token storage on `Platform.OS === "web"` — keep
SecureStore on native, fall back to `localStorage` on web (see
`context/auth.tsx` `tokenStorage` helper). Audit other native-only modules
similarly. To UI-test an Expo app, navigate to the ABSOLUTE `$REPLIT_EXPO_DEV_DOMAIN`
URL, not `/mobile/` on the main proxy — the proxy 404s the Expo bundle assets.
