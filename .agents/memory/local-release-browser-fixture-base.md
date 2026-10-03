---
name: Local release browser fixture base URL
description: Focused release-browser runs must point fixture API requests at the local API when local servers are enabled.
---

When `RELEASE_BROWSER_LOCAL_SERVERS=1`, also set `PLAYWRIGHT_BASE_URL` to the local
API port for browser specs whose fixture helpers derive `API_BASE` from that
variable. The release config uses its own local web port for the browser, while
fixture writes otherwise fall back to the external dev domain and can return a
misleading 502.

**Why:** The browser web server and fixture API base are configured independently;
starting local servers alone does not redirect fixture setup requests.

**How to apply:** Use the local API URL for focused release-debug runs, then
investigate any remaining UI failure separately from fixture startup.

## Deterministic browser clocks and server projections

When a browser test mocks `Date` but the API process keeps real time, keep the
projection's calculation time separate from its server capture time. Fixture
counters may be calculated at simulated time, but each synthetic projection
must be stamped with the current server time. For server-owned lifecycle
commands, do not assume that advancing only the browser clock also advances the
canonical run timeline; make any nonzero drain projection an explicit,
consistent fixture and verify real server drain math separately.

**Why:** A future synthetic server timestamp can hide stale-frame ordering
problems, while the API's periodic frames continue on wall time and may replace
a fixture-time calculation after the browser clock is restored.

**How to apply:** Keep screen-off/wake browser clock jumps independent from
server timestamps. Before the final wake after a simulated future interval,
restore the browser clock to current server time, capture the wake GET's
projection, and compare the visible calculation with that response. Do not
publish a future synthetic frame, loosen counter assertions, or let client
progress replace canonical server state.

Do not make lifecycle timestamps future-dated relative to the API clock by
advancing only browser `Date`.

**Why:** The server can retain a future pause timestamp and require manager
review before the run can resume.

**How to apply:** Keep lifecycle commands on the server's time base; when a
test needs synthetic elapsed time, mock projections separately from canonical
run transitions.