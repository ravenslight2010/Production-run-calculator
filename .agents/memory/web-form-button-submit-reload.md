---
name: Sandbox auto-reset reloads page on file-picker focus
description: Why a web spec/Excel import appears to reload the whole page, and the real fix.
---

# Import "full page reload" = sandbox auto-reset firing on window-focus refetch

Symptom: importing a spec sheet (or any file) on the WEB app blanks the screen and
rebuilds the whole app "from scratch" — a genuine `window.location.reload()` — right
when the OS file picker CLOSES (before any import work runs). Intermittent.

**Not** the cause (all disproven): form submit (all import triggers/inputs/dialogs
render OUTSIDE home.tsx's single `<form>`), ErrorBoundary crash (no incident POST),
401 bounce (no 401s), a manual reload.

**Real cause:** the sandbox auto-reset effect (home.tsx, mirrored in mobile
`(tabs)/_layout.tsx`) was *reactive* — it re-ran on every `["me"]` change. The app's
`QueryClient` uses defaults, so `refetchOnWindowFocus` is ON; closing the file picker
refocuses the window and refetches `["me"]`. If the server reports the sandbox stale
at that instant, the effect calls `resetSandboxRequest()` → `window.location.reload()`
mid-session. The effect was only ever meant to run once at app open.

**Fix:** latch the decision on the FIRST loaded identity and never re-run on later
refetches: `if (autoSandboxResetRef.current || !me) return; ref=true; if (!me.sandbox
|| !me.sandboxStale) return; …`, dep `[me]`. Do NOT reset the ref in `.catch` (that
re-armed it for the next focus refetch). A failed re-copy now retries only on the
NEXT app load, never mid-session.

**Why:** an in-session sandbox reload silently destroys unsaved UI context and looks
like a crash. Reset is a launch-time concern; the manual "Reset sandbox" button covers
the in-session case.

**How to apply:** any effect that reloads/relaunches based on `me`/`sandboxStale` must
be gated to run once per app open, not react to background `["me"]` refetches. Keep
web + mobile identical.

## Second, unrelated cause: Vite dev-server full-reloads (NOT app logic)

A separate "reloads during import" report turned out to be the **Vite dev server**, not
app code. Tells that rule out app logic: no `/sandbox/reset` in API logs, the in-flight
import request (`/api/ai/parse-spec-sheet`) shows `request aborted` / `statusCode null`
(page navigated away mid-fetch), the browser console has **only** `[vite] server
connection lost … / connecting… / connected.` lines and **zero JS errors/crashes**, and
`/api/me` reappears ~1/sec (fresh full loads, empty cache — not focus refetch which is
deduped by the 60s staleTime).

**Why:** `home.tsx` is ~500KB (Babel logs "deoptimised … exceeds max of 500KB"), so React
Fast Refresh can't hot-swap it — every HMR event becomes a full page reload. CPU-heavy
work in the same container (e.g. `tsc` typechecks) can also starve the dev server, drop
the HMR websocket, and Vite full-reloads on reconnect. Editing `home.tsx` mid-session
therefore reloads the preview.

**How to apply:** before hunting app code for a preview "reload", confirm it's not the dev
server: check for the vite connection-lost/reconnect console pattern + absence of app
reload endpoints + aborted in-flight requests. It does NOT happen in the published build
(no HMR in prod). Restarting the web workflow clears the churn.

### Root cause of the recurring drops + the real fix: HMR websocket over the proxy

The recurring `[vite] server connection lost. Polling for restart…` → `connecting… /
connected.` cycles happened with the **dev server still alive** (single "VITE ready" in the
workflow log, no restart, no OOM, CPU idle). The tell: browser shows N lost→reconnect
cycles but the server log shows exactly one startup. In Vite, when the HMR websocket drops
and later re-reaches the server, the client calls `location.reload()` **on every
reconnect** — so each flaky-socket cycle = one full page reload, which aborts any in-flight
request (e.g. `POST /api/ai/parse-spec-sheet` shows `request aborted`).

**Why the socket was flaky:** the preview is served through Replit's HTTPS proxy inside an
iframe, and the HMR websocket simply cannot stay connected through it — it drops every
~45-150s regardless of client port.

**Two config fixes that did NOT work (don't retry them):**
- `server.hmr.clientPort = 443` — 443 is already the default for an https origin, so the
  socketHost is unchanged; the proxy still drops the socket. User confirmed "still did it."
- `server.hmr = false` — in Vite 7 this does NOT stop the injected `@vite/client` from
  connecting a websocket and calling `location.reload()` on reconnect. Verified by curling
  `/@vite/client` after a confirmed-fresh restart: it still contained the connect + reload
  logic (`hmrPort = null`, `waitForSuccessfulPing().then(() => location.reload())`).

**Fix that WORKED (applied):** a dev-only Vite plugin `suppressViteClientReload` (gated on
`process.env.REPL_ID`, `apply:"serve"`) in `artifacts/run-calculator/vite.config.ts`. Its
`configureServer` middleware intercepts the `/@vite/client` response and string-replaces
every `location.reload()` with a `console.debug(...)` no-op (also forces a 200 by dropping
`if-none-match`, sets `Content-Length`/`Cache-Control:no-store`, removes ETag). Result: the
socket may still drop/reconnect (harmless console noise) but the page never full-reloads, so
in-flight imports (`POST /api/ai/parse-spec-sheet`) are no longer aborted. HMR module updates
still apply while the socket is up.

**Verify server-side (no user round-trip needed):** `curl localhost:$PORT/@vite/client` and
confirm `grep -c "location.reload()"` is 0 and the suppressed-debug line appears 3×.

**Why not just serve a production build:** `vite preview` would also remove the client, but it
kills hot-reload for ongoing dev and needs a rebuild per change — the plugin keeps dev
ergonomics while stopping the disruptive reloads. Dev-only, no parity impact (mobile = Metro).
