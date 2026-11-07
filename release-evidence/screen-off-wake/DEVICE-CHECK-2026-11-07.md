# Wake recovery device-check outcome

- **Recorded:** 2026-11-07 05:36 UTC
- **Overall physical-device result:** BLOCKED / NOT RUN
- **Published-device behavior:** UNVERIFIED
- **Protocol:** `docs/screen-off-wake-test-protocol.md`, version 2026-11
- **Candidate source revision:** `b1e2a5874edbd426fc0040d78e16e513ceb08f08`
- **Installed Android build identity:** Unknown; no Android build was installed or tested.
- **Data boundary:** The supplemental browser run used a disposable local PostgreSQL database and synthetic fixtures. No production run or production inventory was touched.

## Why the physical check was blocked

The owner-approved isolated local app/database sandbox is available and was
used for the supplemental browser run. The configured Android device readiness
check returned **BLOCKED** because `PLAYWRIGHT_REAL_MOBILE_WS_ENDPOINT` is not
configured. No `adb` executable or USB device was available to connect a phone
to that sandbox. The shared development app was not used for state-changing run
tests.

The next step is to connect physical Android Chrome to the existing approved
local sandbox and identify the installed candidate build. A separate staging
app or database is not needed. Do not use a published production target.

## Supplemental browser evidence

- **Result:** PASS — all 16 cases passed in 4.7 minutes.
- **Command:**
  `bash scripts/src/run-isolated-browser-suite.sh --playwright-config=playwright.release-debug.config.ts e2e/screen-off-wake.spec.ts`
- **Browser:** Playwright Chromium, desktop configuration; selected cases also used a 390 × 844 phone-sized viewport.
- **Covered in browser only:** running counter catch-up and paused freeze; single Pause/Resume/Stop recovery; two-session wake convergence; manual Packaging correction through wake and reload; canonical values after reload.
- **Not established:** Android screen-off behavior, installed-PWA behavior, OS process-kill recovery, an idle-between-runs phone wake, or a physical second device.
- **Cleanup:** The successful runner stopped and removed its disposable database. A stopped disposable database left by the first, misconfigured attempt was checked for a running server and then removed.

The passing runner output contained no application error. It did contain
non-blocking build warnings about chunk size, deprecated inline dynamic imports,
and the `NO_COLOR`/`FORCE_COLOR` environment combination. The passing test
configuration does not retain browser-console output, so this report does not
claim a separately verified clean browser console.

## Attempts and failure classification

1. The first isolated-suite invocation used the default full-release config for
   the wake-only file. It expected the 241-case full suite, rejected the
   selected cases, and reported an unknown browser-attempt case. That attempt
   was stopped and is **not** counted as test evidence. Rerunning with the
   focused `playwright.release-debug.config.ts` completed all 16 cases.
2. An initial Android readiness command used a nonexistent script name. No
   device test started. The existing
   `check:e2e:ai-outage:phone:device` check was then run and correctly reported
   **BLOCKED** because the physical-device endpoint was absent.

## Compatibility matrix

| Surface | Result |
|---|---|
| Desktop Chromium | PASS — isolated browser suite |
| Phone-sized Chromium emulation | PASS — selected responsive wake cases at 390 × 844 |
| Tablet portrait / landscape | NOT RUN — no tablet viewport/device check in this run |
| WebKit / Safari | NOT RUN — no WebKit run |
| Physical Android Chrome / installed PWA | BLOCKED — no physical device service attached to the approved local sandbox |
| Physical iOS Safari / PWA | NOT RUN — outside this Android check; no iOS device service was configured |
