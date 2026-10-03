---
name: WebKit compatibility lane boundary
description: Responsive WebKit lifecycle/report coverage is stable at phone and tablet sizes; failed-pull recovery remains a dedicated focused gate.
---

Responsive WebKit projects should use the stable Desktop Safari engine with
resized phone/tablet viewports for the bounded compatibility lane. Keep the
failed-pull/reconnect case in the dedicated WebKit smoke until its synthetic
foreground-event timing is reliable across WebKit.

**Why:** WebKit can acknowledge synthetic focus/online activity and complete
the recovery while Playwright response waiters still race route teardown, so
including that case in the bounded matrix produces timeout evidence without
adding layout coverage.

**How to apply:** Count lifecycle/report cases as compatibility evidence, and
run the dedicated WebKit command for sync recovery. Never describe responsive
WebKit emulation as physical iOS Safari/PWA evidence.