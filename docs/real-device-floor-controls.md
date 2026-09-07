# Real-device floor-control validation

## Status

**Hardware trial: BLOCKED in this workspace on September 7, 2026.**

The physical-device Playwright connection variable
`PLAYWRIGHT_REAL_MOBILE_WS_ENDPOINT` was not configured, so Android Chrome on a
real phone could not be reached. No production or shared-development data was
used. The browser workflow and the device-specific acceptance plan are ready
for a connected device.

## Safe fixture plan

Run only with the isolated E2E database:

```sh
pnpm --filter @workspace/run-calculator run test:e2e:phone:device
```

The command now requires the physical Android Chrome endpoint and sets
`E2E_TEST_DB=1` plus `E2E_APPROVED_DESTRUCTIVE_MODE=1`. The test creates:

- one uniquely named sign-up account and one disposable same-day run;
- one uniquely named inventory item with one intake lot;
- one uniquely named manager action-queue item.

The run, inventory item, queue item, and test account are removed during cleanup.
The scenario never targets the production URL and must not be pointed at a shared
development database.

## Physical-device journey

The `@real-mobile-browser` scenario in
`artifacts/run-calculator/e2e/phone-layout.spec.ts` uses real touch dispatch
(`locator.tap()`) for:

1. Run start and Floor Mode launch.
2. Case correction down/up.
3. Skid completion.
4. Log Stop, confirm a stop reason path, and End Stop.
5. Pause, dismiss the pause-tunnel decision if present, and Resume.
6. Complete Run and confirm the completion dialog.
7. Inventory intake: add a disposable item, expand it, enter quantity, and Add stock.
8. Manager queue: Claim, open Details, Add note, and Save note.

Capture the test screenshots and the `physical-floor-device-evidence` attachment
for the device/browser user agent, viewport, visual viewport, DPR, and touch-point
count.

## Required manual observations

The automated physical journey proves touch dispatch and visible feedback. The
operator or tester must additionally record these observations for each device:

| Scenario | Portrait | Landscape | One hand | Glove | Software keyboard |
| --- | --- | --- | --- | --- | --- |
| Floor controls | [ ] | [ ] | [ ] | [ ] | n/a |
| Inventory intake | [ ] | [ ] | [ ] | [ ] | [ ] |
| Manager queue | [ ] | [ ] | [ ] | [ ] | [ ] |

For every observation, record device model, OS, browser version, viewport, and
one of: missed tap, ambiguous action, blocked control, keyboard overlap, viewport
issue, accidental activation, or pass. Attach a screenshot for failures.

## Current automated evidence

The existing isolated Chromium phone suite covers 375×812 and 390×844 portrait,
568×320 narrow landscape, 768×1024 tablet, and 1280×800 desktop Floor Mode
geometry, touch-style activation, keyboard-safe focus modeling, inventory add-item
layout, and manager setup navigation. Those checks are responsive-browser
evidence, not a substitute for the blocked hardware trial.

The complete Chromium phone run on September 7, 2026 passed 16 tests and skipped
the three physical-device scenarios because no device endpoint was configured.
During that run it found and fixed one application layout defect: the bottom tab
bar intercepted the Floor Mode completion control at 375×812 because the overlay
stacked below it. The overlay now owns the higher touch layer, and the four
Floor Mode viewport checks pass. The test harness also freezes the intentional
burn-in drift animation for stable geometry assertions; this does not change
runtime behavior.

## Acceptance constraints

- A real-device result is not PASS until `test:e2e:phone:device` runs against a
  connected physical Android Chrome endpoint.
- A device-specific limitation that is not reproducible in the isolated browser
  suite is recorded as a device-configuration acceptance constraint, not silently
  changed in the product.
- Any reproducible UI defect should become a focused phone test or a focused
  control-level regression test before the hardware trial is closed.