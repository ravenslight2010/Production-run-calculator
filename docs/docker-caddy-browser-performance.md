# Docker/Caddy browser-check timing

Measured on the configured workspace runner on 2026-10-22. These measurements
are local verification, not a hosted GitHub Actions run or a production release
check. All successful runs used real disposable PostgreSQL migrations,
HTTPS/API readiness, all 8 Chromium/WebKit cases, and cleanup. Phone and tablet
coverage means emulated layouts, not physical-device evidence.

## Result and measurement scope

The original baseline was about 17 minutes through cleanup and exported a
2.09 GB migration image. The focused migration builder produces an image of
272,483,463 bytes (about 273 MB) in the final verification.

The final fresh-source measured run completed in **4:51 wall time**, and its
warm repeat in **1:49**, below the 12-minute configured-runner goal. These are explicitly
**uncached migration-image / normal API-and-web-cache** measurements:
`DOCKER_CADDY_NO_CACHE=1` rebuilds the test-only migration image without cache.
API/web still execute Docker builds and rebuild on misses. Browser binaries and
some normal Docker layers were available. An entirely empty cache for every
image has **not** been measured; do not describe these numbers as that result.

| Stage | Before focused builder (seconds) | Fresh source, uncached migration image (seconds) | Warm repeat (seconds) |
| --- | ---: | ---: | ---: |
| Browser preflight | 80.8 | 57.4 | 4.6 |
| Compose validation | 0.6 | 0.1 | 0.1 |
| Database/helper startup | 7.8 | 6.2 | 3.8 |
| Docker build/export | 499.7 | 71.4 | 15.6 |
| Database migration | 80.2 | 18.5 | 5.7 |
| API/Caddy startup | 12.7 | 18.3 | 1.2 |
| HTTPS/API readiness | 6.7 | 5.1 | 1.1 |
| Browser matrix | 195.7 | 105.6 | 73.8 |
| Cleanup | 7.9 | 6.0 | 2.6 |
| Instrumented total | 892.3 | 288.8 | 108.4 |
| Shell wall time | 903 | 291 | 109 |

Browser durations varied with runner load; no browser cases, viewports, TLS
checks, or readiness gates were removed to improve them. The build change
isolates the migration dependency closure from the full application builder,
keeps exact Node/pnpm pins and the frozen lockfile, and narrows the Docker
context. Production migration targets and runtime networking are unchanged.
No global image, volume, or cache pruning was used.

## Fresh-source reproduction

The source tree came from a Git archive plus the candidate changes, without
retained `node_modules` or the reconciliation report. Frozen dependency
installation took 26.4 seconds before the timed runner. All 8 input-contract
tests and workflow lint across 12 workflows passed in that tree.

The report was restored through the same hash-pinned CLI used by CI, using
the exact owner-approved bytes uploaded to the protected environment secret.
Only secret existence and access-policy metadata were read back from GitHub;
this was not a hosted CI execution. Browser binaries were reused from the
configured runner's tool cache using an explicit `PLAYWRIGHT_BROWSERS_PATH`,
not copied into source or substituted with mocks.

Both final runs passed all 8 browser cases. Their isolated containers, volumes,
and networks were removed, and the verified source report/checksum pair was
removed from the temporary source tree. Earlier retained-workspace samples
were 206 and 169 seconds wall time; they are not fresh-checkout evidence.

## Failed approaches and remaining limits

One earlier optimized uncached-migration attempt exited during Drizzle's
“Pulling schema” step after about 139 seconds without an actionable database
error. It is a failed run, not part of the success totals. The same image
subsequently passed both a normal run and another uncached-migration run.

A runner-only source edit also invalidated the application `COPY` layer,
raising one repeat's build/export time to 74.7 seconds. Deterministic layer
inputs still include the full relevant source context; there is no unsafe
cache shortcut on a miss.

The first fresh-source attempt built all images in 263.2 seconds but failed
during the real schema pull after about 146 seconds (469.2 seconds total).
WebKit was also initially unavailable because its source-relative cache path
changed in the new tree; explicitly selecting the existing configured-runner
cache passed both engine preflights without a browser/runtime code change.
That failed attempt is not counted as a successful matrix. The final paired
runs passed migrations without changing or bypassing migration behavior.

Initial local successes retained the reviewed operational reconciliation
report. A clean Git checkout cannot build without it. The approved protected
input mechanism is documented in [reviewed CI inputs](docker-caddy-reviewed-inputs.md);
it does not commit operational bytes or expose them to PR code. Hosted CI
execution and fully empty all-image-cache timing remain separate evidence.
