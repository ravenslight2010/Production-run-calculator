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
