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
  App code must never call `Alert.alert` directly — route info alerts through
  `showNote()` and button confirmations through `showConfirm()` in
  `utils/notify.ts` (native: real Alert; web: `window.alert`/`window.confirm`).
  On web these are NATIVE browser dialogs — Playwright must handle the dialog
  event (accept/dismiss), they won't appear in the page body either.

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

- **Beat the iteration cap by pre-seeding the bearer token instead of driving the
  sign-in form.** The mobile web build restores its session from localStorage key
  `rc_auth_token` on load. Do ALL setup outside the test (mint a token via
  `POST /api/auth/sign-up`, then SQL: force role, set `users.onboarding_seen=true`
  so the Get-Started overlay never auto-opens, insert the rule, clear today's
  `daily_sync`). Then the test plan is just: navigate (signed-out) → `localStorage.setItem('rc_auth_token', <token>)`
  → navigate AGAIN (restores session + loads rules) → set field → start. localStorage
  is per-origin so the first navigation must hit the Expo origin before setting it.
  This collapsed the bypass positive-path test to ~5 browser steps, well under the cap.

- **Clean the shared day-state before mobile run-screen tests.** Web+mobile share the
  `/api/sync` day-state (`daily_sync`, date PK). If an earlier test started/ended a run,
  today's row holds a non-pending run and the mobile app loads it, forcing the agent to
  waste iterations creating a fresh run. `DELETE FROM daily_sync WHERE date='<today>'`
  gives a clean pending run with "Start Run" visible immediately.

- **The /mobile/ preview needs Metro-shaped requests proxied through the WEB app's
  Vite dev server.** The workspace router serves the Expo web page under `/mobile/`,
  but that page requests its bundle/assets via root-absolute paths
  (`/node_modules/...entry.bundle`, `/assets/?unstable_path=...`, `/symbolicate`)
  which the router forwards to the WEB app (Vite), not Metro — Vite answers with SPA
  index.html and the mobile preview renders blank. Fixed with a dev-only
  `server.proxy` in `artifacts/run-calculator/vite.config.ts` forwarding those
  patterns to the Expo dev server (localhost:20191). If /mobile/ goes blank again,
  check this proxy first.

- **At the `/mobile/` pathname expo-router matches NO route** — it renders the
  "+not-found Oops!" screen. The "Go to home screen!" link does a client-side nav
  into the real app, so test plans entering via the naked domain must click through
  it (or navigate to a real route).

- **Long multi-dialog flows do NOT fit the 10-iteration cap.** A schedule re-import
  flow (menu → Schedule → import Excel → confirm → 2 sequential custom dialogs →
  verify two runs) capped out 6 consecutive times even with token pre-seeding.
  For flows this long, verify the mobile behavior at module level instead: load the
  mobile util through the strip-imports harness (see web-test-harness.md) and drive
  its dialog chain with a stubbed `showConfirm` (e.g. `mobileCaseUpdateChoices.test.ts`).

- **When runTest keeps hitting the cap on the Expo web build, drive Playwright yourself.**
  The 12MB dev bundle takes ~20s+ to first paint per fresh context; the subagent burns
  its whole 10-iteration budget on waits/polls (six straight cap-outs, even a 6-step
  diagnostic). Escape hatch that works: `npm i playwright-core` in /tmp, install the nix
  `chromium` system package (playwright's own chromium-headless-shell fails on missing
  libglib), launch with `executablePath: $(which chromium)`, and script the whole flow
  (poll `document.body.innerText` for paint, deep-link routes like `/warehouse` via URL
  instead of clicking tabs). Uninstall the chromium system dep when done.

- **For scripted Playwright tests, prefer the full Expo dev domain**
  (`https://$REPLIT_EXPO_DEV_DOMAIN`) over the `/mobile/` proxy path — it works without
  depending on the Vite proxy above and avoids the not-found route at the naked path.

- **Playwright locator gotchas on RN-web:** `text=Foo` is substring-match — "Set up"
  also matches prose like "Set up each profile…"; use `getByText(..., { exact: true })`.
  Card rows are one big Pressable, so click the row's name text, then assert
  `location.pathname` changed (body text is NOT proof of navigation — the source screen
  often contains the same string).

- **Mobile `scheduled` runs are LOCAL-ONLY** (not pulled from the server scheduled rows);
  to make schedule-driven cards appear, seed `st.scheduled` inside the AsyncStorage web
  blob `run-calc-mobile-v2`. The app autosaves over that key on a debounce, so seed and
  reload atomically (mutate then reload immediately, or setTimeout-reload inside one eval).

- **Test-fixture cleanup (full set):** test user rows live in `users` plus dependents
  `user_roles` and `password_reset_requests` (no cascade — delete dependents first).
  Factory-wide rules in `production_rules`. Always also delete the test-created
  `daily_sync` row for today.
