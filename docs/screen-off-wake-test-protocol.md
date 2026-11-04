# Background/Wake Recovery Check — Manual Test Protocol

**Task reference:** #3794, consolidated app reliability closure  
**Test name:** Background/Wake Recovery Check  
**Validates:** Case-counter catch-up, manual Packaging correction followed by auto-tracking resume, first-tap responsiveness during recovery, and peer/reload convergence.
**Relevant code:** `artifacts/run-calculator/src/hooks/useAutoTrack.ts`, `artifacts/run-calculator/src/hooks/useClock.ts`  
**Unit test coverage:** `useAutoTrack.pauseResume.test.ts` (tests 7 & 8 verify the arithmetic; browser and physical-device outcomes are separate evidence).
**Automated browser regression:** Run `bash scripts/src/run-isolated-browser-suite.sh artifacts/run-calculator/e2e/screen-off-wake.spec.ts`. The wrapper uses disposable local services and a test database; do not direct it at the published app.

> **Safety boundary:** Run state-changing scenarios only on an owner-approved isolated staging app/database with synthetic accounts and data. Do not start, edit, pause, resume, or stop a production run for this protocol. If the approved staging target is unavailable or its build identity does not match the candidate under test, record the device scenarios as **BLOCKED / NOT RUN**.

---

## Pre-conditions

| Requirement | Notes |
|---|---|
| Device | A physical Android tablet or iPad running Chrome / Safari |
| App | Local disposable test environment or owner-approved isolated staging app/database; use a synthetic **manager** test account |
| Data | Synthetic training run and recipe only; no customer workbook, facility record, or production run |
| Clean state | No active run or unresolved test edits when the session begins; use a fresh disposable scope |
| Build identity | Record the exact candidate build/source fingerprint, or mark it unknown; do not infer it from a URL |
| Run setup | cycleSpeed = **30**, crustsPerCycle = **2** (ppm = 60), pizzasPerCase = **6**, freezerTime = **5 min**, casesPerSkid = **10**, casesNeeded = **200** |

---

## Calculated expected values

With the setup above:

```
ppm = 30 × 2 = 60 pizzas/min
casePeriod = 6 pizzas / 60 ppm = 6 s per case

At t = 15 min from start:
  afterTunnel = 15 − 5 = 10 min
  expectedRaw = floor(10 × 60 / 6) = 100 cases

At t = 20 min from start:
  afterTunnel = 15 min
  expectedRaw = floor(15 × 60 / 6) = 150 cases
  delta on second wake = 150 − 100 = 50 cases
```

---

## Scenario A — Running run catches up fully on wake

### Steps

| # | Action | How |
|---|---|---|
| 1 | Open the web app, navigate to the **Run tab** | — |
| 2 | Fill in the setup form with the values from Pre-conditions above | Enter in the form fields before starting |
| 3 | Click **START RUN** | Note the exact start time (HH:MM:SS) |
| 4 | Confirm the run is active (PAUSE RUN / STOP RUN buttons appear) | — |
| 5 | Note the case counter display — should read **0** | Record: `baseline_cases = 0` |
| 6 | **Lock the screen or close the app for ≥ 15 minutes** | Use the physical device power button or OS app switcher |
| 7 | Wake the screen / return to the app tab | Note the exact clock time |
| 8 | Observe the case counter for **one tick** (≤ 2 s) | The counter must jump immediately after wake |

### Required observations

| Observation | Expected value | Pass / Fail |
|---|---|---|
| **A1.** Case counter reading immediately after wake tick | **≥ 90** (floor((elapsed−5)×60/6), allow ±10 for timing) | |
| **A2.** Time-remaining and pace gauge refresh in the same tick | Both update visibly without a separate action | |
| **A3.** Counter did NOT increase by exactly 1 or 2 during the screen-off | No incremental updates visible in the wake animation | |
| **A4.** If elapsed ≥ 20 min: lock again for ~5 min, then wake | Counter must jump by **≥ 40 cases** in a single tick | |

**Record:** elapsed time since start (minutes), counter reading after first wake tick, counter reading after second wake tick if tested.

---

## Scenario B — Paused run stays frozen on wake

### Steps

| # | Action | How |
|---|---|---|
| 1 | (Same setup as Scenario A, steps 1–5) | Start with counter at 0 |
| 2 | Let the run tick for **≥ 15 min** (or complete Scenario A first) | Counter should reach ≥ 90 cases |
| 3 | Click **PAUSE RUN** | Confirm "paused" state indicator appears |
| 4 | Note the exact counter value | Record: `paused_at_cases` |
| 5 | Lock the screen for **≥ 5 minutes** | Same methods as Scenario A |
| 6 | Wake the screen / return to the tab | — |
| 7 | Observe the case counter | Must remain unchanged for ≥ 2 s after wake |

### Required observations

| Observation | Expected value | Pass / Fail |
|---|---|---|
| **B1.** Case counter value immediately after wake | Exactly **`paused_at_cases`** | |
| **B2.** Counter does NOT tick for at least 2 seconds | No change observed | |
| **B3.** After RESUME RUN, counter resumes ticking | Next tick within 2 s | |

---

## Scenario C — Browser-only regression aid (not hardware evidence)

Use this approach in a desktop browser when a physical tablet is not available.
Its result must remain browser-observed and must not be recorded as a hardware confirmation.

1. Open Chrome DevTools (F12) → **Application** tab → **Service Workers** → tick "Offline" (or use Network → Offline preset). This is NOT a real screen-off but simulates the page losing activity.

Preferred alternative using the **Visibility API** shim:
1. Open Chrome DevTools → **Console**
2. Paste the following snippet to simulate screen-off then wake after 30 s:

```javascript
// Simulate screen-off
Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
document.dispatchEvent(new Event('visibilitychange'));
console.log('Screen-off simulated. Waking in 30 s…');

setTimeout(() => {
  Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('focus'));
  console.log('Wake simulated. Check case counter.');
}, 30_000);
```

3. Observe the case counter 1–2 s after the "Wake simulated" message appears.  
4. With **ppm = 60** and a **30-second screen-off** (freezerTime already elapsed), expected delta = floor(30 / 6) = **5 cases in one tick**.  
5. If the old 2-case cap were still active, the counter would increment by only **2**. A jump of **5** proves the cap is gone.

---

## Scenario D — One-tap Stop Run while recovery is in progress

This Android installed-PWA and iPad Safari/PWA journey is state-changing, so it
must use the isolated synthetic scope described above. The foreground pull must
be allowed to finish before the lifecycle command is applied; do not tap Stop a
second time.

### Steps

| # | Action | How |
|---|---|---|
| 1 | Open the approved isolated app in an installed Android PWA, or Safari/PWA on iPad, and use the Run tab | Use a synthetic manager account; use a second isolated client for peer checks |
| 2 | Start a configured run and confirm the run identity | Record the brand/flavor and run ID if available |
| 3 | Leave the app idle or lock the screen for at least 2 minutes | Prefer a real screen-off interval; DevTools visibility simulation is acceptable for repeatability |
| 4 | Return to the app and immediately tap **STOP RUN once** | Do not repeat the tap |
| 5 | Observe the recovery status | It must show **Stop requested** / **STOP REQUESTED**, then either **Stop applied after recovery** or a clear remote outcome |
| 6 | If a peer changes the original run during recovery, repeat with a remote PAUSE or STOP | The local result must say the run was already paused/ended/changed; it must not stop the peer's newly selected run |
| 7 | Reload the recovering device after the result is shown | The original run's final lifecycle must remain unchanged |
| 8 | Inspect the connected peer | It must converge to the same ended/paused/canonical result; no duplicate inventory finalization should appear |

### Required observations

| Observation | Expected value | Pass / Fail |
|---|---|---|
| **D1.** First Stop tap feedback | Visible pending recovery state; no silent no-op | |
| **D2.** Same-run completion | If the run remains running, it ends once after the pull | |
| **D3.** Remote lifecycle outcome | Pause/end/switch is adopted and explained; no different run is ended | |
| **D4.** Failed pull | Local work is retained, tracking/lifecycle writes stay fenced, and **Retry recovery** is visible | |
| **D5.** Persistence | Reload and peer show the same final lifecycle and counters/skids | |
| **D6.** Diagnostics | Sync status/history shows the recovery attempt and any failure/ack without payload details | |

---

## Scenario E — Manual Packaging correction, Resume, next case, then background/wake

This reproduces the reported sequence without using live production data. Run
both the single-device path and, when an isolated peer is available, the
peer-wake path. Do not reload during the observation; a full reload is a
separate recovery control and can hide the failure being measured.

### Steps

| # | Action | How |
|---|---|---|
| 1 | Start a synthetic run with Packaging auto-tracking enabled | Record a short run alias, initial packaging count, and next-case countdown |
| 2 | Make one manual Packaging count edit | Record the before/after display values; wait for the app's normal acknowledgment |
| 3 | Tap **Resume Auto Tracking** once | Record whether the control gives feedback and whether auto-tracking visibly returns to its active state |
| 4 | Keep the app foregrounded through the next-case timer reaching zero | Record the timer transition and the resulting count; do not tap another counter control |
| 5 | Background the app or lock the screen for about two minutes | Record the local time and timezone; do not close the app |
| 6 | Return to the same tab without refreshing | Record sync/recovery status and whether the first intended tap responds |
| 7 | Observe the next automatic tracking tick | Compare the displayed count and run status with the synthetic server-confirmed state |
| 8 | If using a peer, wake the second isolated client while the first remains foregrounded | Record whether either client changes the other's accepted Packaging value or blocks its controls |
| 9 | After observations are saved, perform one authorized reload as a separate check | Verify the accepted manual edit and final canonical state persist; do not treat reload recovery as a pass for wake |

### Required observations

| Observation | Pass condition |
|---|---|
| **E1. Manual edit acknowledgment** | The edited count is accepted once; a rejected or pending edit remains visible and is not silently overwritten |
| **E2. Resume and next-case tick** | Auto-tracking remains active and the timer transition applies one correctly bounded update without a conflict loop |
| **E3. Wake responsiveness** | The app becomes interactive after recovery; the first intended control tap has a visible, matching outcome |
| **E4. State convergence** | The confirmed server state, foreground display, and peer (if used) agree without oscillation or repeated stale writes |
| **E5. Reload control** | A separate reload preserves the accepted canonical state; it does not substitute for E3 or E4 |

If a control visibly receives a tap but its action does not occur, record that
as a failure. Do not keep tapping, stop the run to force recovery, or refresh
before saving the visible status and sanitized diagnostics. Preserve unsent work;
use only the app's explicit retry after confirming connectivity.

---

## Hardware-only guided checks

Run these on a physical Android phone, Android tablet, or iPad connected to the
approved isolated test environment. Use synthetic data only. Production data
must not be changed to obtain hardware evidence.

1. **Touch accuracy:** Tap the normal navigation and non-destructive setup
   controls once each. Pass only when the intended control responds without an
   adjacent control activating.
2. **Keyboard clearance:** Open ordinary text and number inputs. Pass only when
   the focused input and its label remain visible above the physical on-screen
   keyboard without changing saved production values.
3. **OS process-kill recovery:** With no unsaved production work, fully close
   the app from the OS app switcher and reopen it. Pass only when authentication
   and the previously saved screen state recover without a crash or blank page.

Immediately record each result in **Reported issues → Field checks**. The stored
confirmation is intentionally limited to device category, protocol version,
Pass/Fail/Incomplete outcome, and timestamp. Browser-observed checks remain a
separate evidence source and cannot create hardware confirmations.

## Result recording template

```
Protocol version: 2026-11
Test name: Background/Wake Recovery Check
Environment/build identity: _______________________________
Test scope: isolated synthetic / BLOCKED: __________________
Device: _______________________________
Browser: _______________________________
Date/time/timezone: _______________________________

Scenario A
  Run started at: _______
  Screen locked at: _______
  Screen woken at: _______
  Elapsed (min): _______
  Case counter on wake: _______
  Time-remaining updated on same tick? Y/N: _______
  Pace gauge updated on same tick? Y/N: _______
  [If second lock test]
    Locked again at: _______ Woke at: _______
    Delta in one tick: _______

Scenario B
  Paused at (cases): _______
  Screen locked at: _______
  Screen woken at: _______
  Case counter after wake: _______
  Matches paused_at_cases? Y/N: _______
  Counter ticked after RESUME? Y/N: _______

Scenario C (DevTools)
  30-second simulated screen-off delta: _______
  Expected (≥ 5, old cap = 2): PASS/FAIL: _______

Scenario D (one-tap Stop Run recovery)
  Device/browser (Android PWA or iPad Safari/PWA): _______
  Run identity: _______
  Stop tapped once at: _______
  Pending recovery shown? Y/N: _______
  Final recovery outcome: applied / remote-paused / remote-ended / changed / failed: _______
  Retry recovery shown after failure? Y/N/NA: _______
  Reload retained final lifecycle? Y/N: _______
  Connected peer converged? Y/N: _______
  Diagnostics exported/reviewed? Y/N: _______

Scenario E (manual Packaging edit → Resume → next case → background/wake)
  Synthetic run alias: _______
  Initial count / manual before / manual after: _______
  Resume feedback and auto-tracking state: _______
  Next-case timer reached zero at: _______
  Count after next-case tick: _______
  Backgrounded at / foregrounded at: _______ / _______
  First intended tap and visible outcome: _______
  Auto-tracking state after wake: _______
  Count after wake: _______
  Confirmed server state matches? Y/N/unknown: _______
  Peer-wake outcome (if tested): _______
  Reload control preserved canonical state? Y/N/NA: _______

Overall result: PASS / FAIL / BLOCKED / NOT RUN
Notes: _______________________________
```

Record only a synthetic run alias, device category, build identity, timestamps,
outcomes, and sanitized incident reference. Do not retain account names,
passwords, live run identifiers, request bodies, or customer/production data.

---

## Acceptance criteria (all must be PASS)

- **A1**: Case counter jumps to the full expected value on first wake (≥ 90 cases for 15-min screen-off).  
- **A4**: Second wake delta ≥ 40 cases in a single tick (not capped at 2).  
- **B1**: Paused run counter is exactly unchanged after wake.  
- **C** (or A4): A DevTools-simulated 30-s screen-off produces ≥ 5-case single-tick delta (not 2). Scenario C is browser evidence only.
- **D1–D5**: A single Stop tap is visible, run-bound, safely resolved, and retained across reload/peer sync.
- **E1–E5**: The manual Packaging correction is acknowledged once, auto-tracking survives the next-case tick and background/wake, controls remain responsive, and isolated peers converge. A reload-only recovery does not pass this scenario.

---

## Connection to unit tests

The unit tests **tests 7 and 8** in  
`artifacts/run-calculator/src/hooks/__tests__/useAutoTrack.pauseResume.test.ts`  
verify the arithmetic in an isolated JSDOM environment:

- **Test 7** (`screen-off wake: no cap on catch-up`) — After `setNowTime` advances by 50 case-periods (5 min) in one shot, the counter jumps directly from 16 to 66, not 18 (16+2).  
- **Test 8** (`paused run: counter stays frozen on wake`) — Same clock advance while paused → counter stays at 16.

This protocol checks the same invariants in browser tab-lifecycle events.
Physical Android/iOS outcomes must be recorded separately; browser emulation is
not hardware evidence.

## Field verification boundary

The Production Run Calculator passively records browser-observed evidence for
startup, foreground recovery, sync acknowledgements, peer convergence, reload
boot, online recovery, PWA update readiness, and bounded performance timing.
That evidence appears in the manager **Reported issues → Field checks** panel
and is scoped to the current facility. It is intentionally not a replacement
for this protocol: touch accuracy, keyboard clearance, screen-off behavior, and
OS process-kill recovery remain **Unsupported** until a person confirms them
with guided physical-device steps. The observer never taps controls, changes
run data, or creates synthetic production state.
