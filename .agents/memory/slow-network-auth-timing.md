---
name: Slow-network authenticated startup measurements
description: Measure the real sign-in-to-Home transition without mistaking session confirmation for a failed login.
---

Authenticated cold-start timing should begin at the real sign-in action and end when Home is active. Keep server-backed session confirmation inside that measured interval and allow a bounded wait calibrated to the documented network profile.

**Why:** Under throttled network conditions, a short default locator timeout can expire while the app is still showing its legitimate session-confirmation state. Treating that as a login failure produces a false test failure and omits part of the user-visible startup.

**How to apply:** For authenticated performance captures, use the real sign-in flow, preserve session confirmation in the metric, and set a timeout appropriate to the synthetic network profile. Do not bypass authentication or inject a faster session path unless the metric explicitly excludes that work.
