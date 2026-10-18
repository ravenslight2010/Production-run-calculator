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

In isolated Replit WebKit runs, a page error naming only
`fonts.googleapis.com/css2?family=` can represent a no-response from the
optional external font stylesheet. Exclude only that resource from the
page-error assertion; keep other page errors fatal and test layout in fallback
fonts.

**Why:** The isolated browser may not reach Google Fonts even though the app
flow is working. Treating that network-only failure as an app exception obscures
the responsive result, while broadly suppressing page errors would hide defects.

**How to apply:** Match the exact font stylesheet host/path in the WebKit test
listener. Do not skip other network requests or errors, and do not claim the
loaded Google font appearance was verified.