---
name: Headless e2e fallback when runTest can't reach the app
description: What to do when the Playwright testing subagent never reaches the dev preview — self-drive a headless Chromium instead.
---

# Headless e2e fallback

In some isolated task environments the testing subagent (runTest) never reaches the web app: its promise never resolves, no sign-in traffic appears in API logs, and no browser console logs are produced — regardless of the URL given in the plan. (Repeating GET / 404s on the API port are the platform's port prober, not the tester.)

**Fallback that works:**
1. `installSystemDependencies({ packages: ["chromium"] })` (remember to `uninstallSystemDependencies` after — it writes replit.nix, which cannot be edited/deleted by hand).
2. `npm install puppeteer-core` in a temp dir OUTSIDE the workspace (pnpm refuses adds at workspace root).
3. Drive `https://$REPLIT_DEV_DOMAIN/` headless; the script itself can edit source files mid-session to trigger real Vite HMR and assert the page survives.

**Gotchas:**
- `waitUntil: "networkidle2"` never settles on this app (sync polls every ~3s) — use `domcontentloaded`.
- The 120s bash cap kills long scripts silently (exit -1, no output); run via the code-execution notebook with `execFile` using the ABSOLUTE node path (`which node`; bare `node` is ENOENT there). Detached/nohup background processes do not survive.
- Radix dropdowns need a `pointerdown` dispatch before `click()`.
- Text assertions must respect CSS `text-transform`/actual casing in `innerText` (e.g. "Current password", "CHANGE PASSWORD").
- Screenshot every step — a "failed" assertion may be a casing bug while the UI is actually fine.
- Chrome BLOCKS cross-origin URL rewrites via request interception (`request.continue({url})` → net::ERR_BLOCKED_BY_CLIENT), so you cannot re-point the web app's relative `/api` calls at another port that way. Instead run a tiny same-origin Node reverse proxy (one `http.createServer`: `/api/*` → API port, everything else → vite port) and drive the browser at the proxy. SSE and cookies stream through naturally. Remember `proxy.close()`/`process.exit(0)` at the end or the script hangs.
- The web app auto-selects the earliest started run as the current run, but on a FIRST page load right after sign-in the form can load defaults before sync values land (live form shows 0 while localStorage has the real count) — reload the page after localStorage is confirmed seeded so the current-run form reflects synced values before exercising import flows.
