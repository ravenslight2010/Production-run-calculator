---
name: Android keyboard avoidance (KeyboardAvoidingView)
description: Why the mobile app uses behavior=undefined on Android, not "height".
---

# Android: don't use KeyboardAvoidingView behavior="height"

On Android, set `KeyboardAvoidingView` `behavior={Platform.OS === "ios" ? "padding" : undefined}`.
Do NOT use `behavior="height"` on Android.

**Why:** Android already avoids the keyboard natively via `windowSoftInputMode`
adjustResize (Expo default). Layering `behavior="height"` on top double-handles
it and makes the soft keyboard flicker/dismiss on every keystroke when typing in
a field inside a ScrollView (reported as "keyboard kept closing" while adding a
die type on the Master Data screen).

**How to apply:** The shared `components/KeyboardAwareScrollViewCompat.tsx` and the
auth screens all use the iOS-padding / Android-undefined pattern. Any new
KeyboardAvoidingView must follow it. This is a mobile-only platform fix with no
web equivalent, so it is not a web/mobile parity concern.
