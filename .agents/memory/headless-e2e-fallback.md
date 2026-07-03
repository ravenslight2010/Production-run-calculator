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
