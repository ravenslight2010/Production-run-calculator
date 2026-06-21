---
name: runTest Expo-web quirks
description: Gotchas when writing Playwright runTest UI tests against the Expo web build (mobile artifact).
---

# runTest on the Expo web build (mobile artifact)

Lessons from writing run-screen production-rule UI tests (bypass + checklist gating) for the mobile app.

- **React Native `Alert.alert` is a no-op on react-native-web.** Tapping a blocked
  "Start Run" pops an Alert on a real device, but on the Expo web build the harness
  sees NO dialog and the page body never contains the alert text. Do NOT assert on
  alert text in mobile runTest plans. Assert the **behavioral** signal instead:
  blocked → run does not start (a "Start Run" button is still present, no Pause/End);
  allowed → tapping Start replaces it with running controls (Pause/End/timer).

- **Production rules need a reload after login.** Rules are fetched via React Query
  with the bearer token (key `productionRules`, staleTime ~30s, refetchInterval ~60s).
  The query can fire pre-auth and cache empty; it does NOT refetch immediately on
  login. In the test plan, after signing in, navigate to the Expo URL AGAIN to force
  a fresh fetch with the stored token (token lives in localStorage on web), then wait
  ~5s. Without this, no rule loads → no gating → false pass.

- **The runTest harness has a hard 10-iteration cap.** The Expo flow (new context →
  sign-in → reload → set field → start) is iteration-heavy. Keep mobile plans MINIMAL
  (one behavior per run); split blocked-side and allowed-side into separate runs if
  needed. Judging "locked grey vs green play" button colour burns extra iterations —
  prefer the unambiguous "did the run actually start (Pause/End appear)" signal.

- **Clean the shared day-state before mobile run-screen tests.** Web+mobile share the
  `/api/sync` day-state (`daily_sync`, date PK). If an earlier test started/ended a run,
  today's row holds a non-pending run and the mobile app loads it, forcing the agent to
  waste iterations creating a fresh run. `DELETE FROM daily_sync WHERE date='<today>'`
  gives a clean pending run with "Start Run" visible immediately.

- **Test-fixture cleanup (full set):** test user rows live in `users` plus dependents
  `user_roles` and `password_reset_requests` (no cascade — delete dependents first).
  Factory-wide rules in `production_rules`. Always also delete the test-created
  `daily_sync` row for today.
