# Screen-Off / Wake Case-Counter Catch-Up — Manual Test Protocol

**Task reference:** Task 727  
**Validates:** After the 2-case-per-tick cap was removed from `useAutoTrack.ts`, the case counter on a real tablet catches up to the correct expected total in a single wake tick — not capped at `priorValue + 2`.  
**Relevant code:** `artifacts/run-calculator/src/hooks/useAutoTrack.ts`, `useClock.ts`  
**Unit test coverage:** `useAutoTrack.pauseResume.test.ts` (tests 7 & 8 pass the math; this protocol proves the lifecycle in a real browser).

---

## Pre-conditions

| Requirement | Notes |
|---|---|
| Device | Any Android tablet or iPad running Chrome / Safari (or Chrome DevTools device emulation) |
| App | Web app deployed or running locally — logged in as a **manager** account |
| Clean state | No active run when the session begins |
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
| 6 | **Lock the screen or close the app for ≥ 15 minutes** | Tablet power button; or navigate away / use Chrome "Task Manager" to suspend; or use Chrome DevTools → More Tools → Performance monitor → CPU throttle while switching tabs |
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

## Scenario C — Device emulation via Chrome DevTools (no physical screen-off)

Use this approach in a desktop browser when a physical tablet is not available.

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

## Result recording template

```
Protocol version: 2025-08 (task 727)
Device: _______________________________
Browser: _______________________________
App URL: _______________________________
Tester: _______________________________
Date: _______________________________

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

Overall result: PASS / FAIL
Notes: _______________________________
```

---

## Acceptance criteria (all must be PASS)

- **A1**: Case counter jumps to the full expected value on first wake (≥ 90 cases for 15-min screen-off).  
- **A4**: Second wake delta ≥ 40 cases in a single tick (not capped at 2).  
- **B1**: Paused run counter is exactly unchanged after wake.  
- **C** (or A4): A DevTools-simulated 30-s screen-off produces ≥ 5-case single-tick delta (not 2).

---

## Connection to unit tests

The unit tests **tests 7 and 8** in  
`artifacts/run-calculator/src/hooks/__tests__/useAutoTrack.pauseResume.test.ts`  
verify the arithmetic in an isolated JSDOM environment:

- **Test 7** (`screen-off wake: no cap on catch-up`) — After `setNowTime` advances by 50 case-periods (5 min) in one shot, the counter jumps directly from 16 to 66, not 18 (16+2).  
- **Test 8** (`paused run: counter stays frozen on wake`) — Same clock advance while paused → counter stays at 16.

This protocol confirms those same invariants hold in a real browser's tab-lifecycle events.
