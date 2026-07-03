---
name: Mobile module-level TDZ via import cycle
description: Module-scope consts in mobile context/sync modules can crash the whole Expo web build at startup due to circular imports; make them lazy.
---

Module-level `const X = deriveFrom(DEFAULT_SETTINGS)` in a mobile `context/sync/*` module crashed the entire Expo web build at startup with "Cannot access 'DEFAULT_SETTINGS' before initialization" — a TDZ error from the circular import between the sync mapping module and RunContext. Nothing renders (blank page), and the ErrorBoundary never mounts, so it looks like a dead server.

**Why:** In a circular import, whichever module the bundler evaluates second sees the other's exports before its top-level consts are initialized. Metro/Expo-web evaluation order differs from the vitest strip-imports harness, so tests pass while the real build crashes.

**How to apply:** In mobile modules that participate in the RunContext import cycle (context/sync/*, anything importing DEFAULT_SETTINGS or run-state constants), never compute module-scope constants from imported values — wrap them in a lazy getter (`function getX() { cached ??= ...; return cached; }`). A real-browser E2E load of the Expo web build is the only reliable smoke test for this class of bug.
