---
name: Event-loop delay monitor warmup
description: Let Node's event-loop delay histogram establish a sample interval after reset before testing a deliberate stall.
---

When a test resets `monitorEventLoopDelay()` and immediately blocks the event loop, the first resulting reading may show only the monitor's normal sampling resolution instead of the stall. Let one ordinary sampling interval complete before injecting the stall, then allow a further interval for the delayed sample to be recorded.

**Why:** The histogram needs an established sampling baseline after reset; without a warm-up turn, a deliberate synchronous stall can appear to be an ordinary interval and make the regression test flaky or misleading.

**How to apply:** In tests that reset the histogram, wait at least one configured resolution interval before a synchronous stall, then yield again before reading the aggregate. Do not add a warm-up delay to production reporting.
