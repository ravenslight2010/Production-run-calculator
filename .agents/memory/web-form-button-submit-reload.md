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
