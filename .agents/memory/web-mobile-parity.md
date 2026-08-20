---
name: Web-only product boundary
description: The Production Run Calculator is maintained as a responsive web application, not a separate mobile app.
---

# Web-only product boundary

The Production Run Calculator is a single responsive web app. It must remain usable in desktop, phone, and tablet browsers, but no standalone Expo/React Native app is maintained.

**Why:** maintaining an archived native client created stale routes, dependencies, and parity tests without serving a current product target.

**How to apply:** build and test web behavior only. Do not restore mobile launchers, Expo workspace packages, Metro proxy rules, or web/mobile parity fixtures. Keep generic API compatibility only when an active web path needs it.
