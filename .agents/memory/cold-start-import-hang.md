---
name: Autoscale cold-start hangs blocking dialogs
description: Published autoscale app scales to zero; requests during wake-up can hang at the platform edge with zero app logs, freezing blocking loading dialogs.
---

# Autoscale cold-start can hang client fetches with zero server logs

**The rule:** any client fetch that gates a blocking full-screen loading state (import dialogs, spinner backdrops with no close-on-backdrop) must have a finite timeout (`AbortSignal.timeout`) and an explicit visible Cancel. Shared helper: `fetchWithTimeout` in the web app maps Timeout/Abort to a friendly "server may be waking up" message (`IMPORT_WAKE_HINT`).

**Why:** the published deployment is Autoscale and scales to zero when idle. During the ~90s cold start, requests can die/hang at the platform edge and never reach the app — production logs show NOTHING for the failing window (a cold-boot log line right at the user's failure time was the tell). To the user this looked like "second import broke the app: review window never appears, buttons unresponsive, refresh doesn't help." Once warm, the identical imports succeeded.

**How to diagnose again:** correlate the user's failure window with deployment boot timestamps in prod logs; zero app-side request logs during the window + a boot line = edge-level death, not an app bug. Rule out app causes first (incidents table, pool sizes, payload sizes, sync 200s).

**How to apply:** timeouts used — aliases GET 15s (fail-safe, importer proceeds without), AI parse 180s (legit 30-60s runtime), AI matchers 120s (callers fall back to fuzzy). Loading views also show a "server may be waking up" hint. If new import chains or other blocking-fetch dialogs are added, wire them through the same helper. A Reserved VM / min-instances deployment would remove cold starts entirely (user's cost call).
