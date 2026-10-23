# Home opening-graph byte guard decision — 2026-10-21

## Decision

Do not add a blocking JavaScript/CSS byte-size guard yet. The generated graph
measurement is repeatable, but the available evidence does not establish a
byte ceiling that preserves the existing authenticated-startup target. Keep the
10,000 ms first-authenticated-visit-on-slow-3G browser budget as the blocking
user-facing threshold.

Use **581,353 gzip bytes** as the current source-matched opening JavaScript +
CSS reference value, not as a CI failure limit. Revisit a byte limit after
additional evidence establishes a reproducible ceiling with headroom against
the 10,000 ms budget. The current browser sample does not support that ceiling.
Do not derive that limit from the deferred-panel materiality floor.

## Repeated production builds

Three complete `pnpm run publish:ready` builds were run serially. Each build
used Node 24.13.0, pnpm 12.8.1, and Vite 8.3.4, and completed without
publishing or deploying. All three build identities were verified against
source revision `a93e4e8f9b44722373b899bfe82c7afc08db6568` and source
fingerprint
`60101a9bd770db9f556adcd36f19b302791ef15bd25719aa2bb9a3b7bfa4afa3`.
The application build IDs were distinct per run, as expected.

The measurement uses
`docs/evidence/measure-home-opening-graph.mjs` against each newly produced
`artifacts/run-calculator/dist/public` output. Gzip is Node's default
`zlib.gzipSync`, measured per emitted asset and summed. HTML, the service
worker, and dynamically loaded assets are excluded.

| Build | Application build ID | Opening JS chunks | JS raw bytes | JS gzip bytes | CSS assets | CSS raw bytes | CSS gzip bytes | Combined gzip bytes |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | `app-build:66e33919-4fbd-408f-abf3-8ba42b08ac52` | 60 | 1,886,465 | 550,188 | 1 | 199,865 | 30,332 | 580,520 |
| 2 | `app-build:812a192d-80c6-4bc2-9fd0-e8886292a2ba` | 60 | 1,886,465 | 550,173 | 1 | 199,865 | 30,332 | 580,505 |
| 3 | `app-build:7d5b0b5a-219b-4ef8-a504-90dd19d4b07f` | 60 | 1,886,465 | 550,177 | 1 | 199,865 | 30,332 | 580,509 |

The repeated-build spread was 15 bytes for JavaScript gzip, zero bytes for CSS,
and 15 bytes for combined gzip; all raw totals were identical. Both generated
boundary checks passed on every production build. The Home checker reported
650 opening modules and 19 deferred optional surfaces.

The previous revision-bound measurement (source revision
`85b20fed1b40dea1a7267b11b579c6e4c5783e39`) reported 580,476 combined gzip
bytes. That is a different source revision, so its 29–44 byte difference from
these builds is not build-to-build noise and is not used to set a limit.

## Startup-budget and browser evidence

`artifacts/run-calculator/docs/performance-budgets.md` sets 10,000 ms for the
first authenticated calculator visit under the slow-network profile (400 ms
latency and 500 Kbps download/upload). This is a user-visible readiness target,
not a byte budget.

The retained 2026-09-05 authenticated trace is from a local development
workflow and reports a 5.4-second settled load without the current production
build or the slow-network profile. It measures a master-data response, not the
opening JavaScript/CSS transfer. The 2026-10-20 production graph report likewise
contained no authenticated browser transfer or startup timing. The
source-matched browser capture below now provides current measurements, but it
does not establish a safe byte ceiling.

## Source-matched browser capture — 2026-10-21

- Build: `app-build:c62c88fd-f567-4322-b359-f7f9b7c7753e`, source revision
  `8d334d1b8d3404a2b6accba7c57b2250b4a10146` (`gitBinding: verified`),
  source fingerprint
  `cd7c60187ee12d6021edbfa3576434d7f8d6fdd17b2da3a7811ac123ce9204e7`.
  Vite generated production assets in local development-identity mode; the
  isolated browser runner used disposable PostgreSQL data. Nothing was
  published or deployed.
- Browser runs: five clean Chromium desktop and five Pixel 5 Chromium-emulation
  contexts. Each used a new isolated account, blocked service workers, and
  disabled the browser cache before the measured sign-in navigation. The
  throttling profile was 400 ms latency and 500 Kbps download/upload.
- Transfer capture: the build manifest identified 60 opening JavaScript chunks
  and the HTML-linked stylesheet; all 61 resources had timing entries in every
  run. `encodedBodySize` summed to **585,371 bytes** and `transferSize`
  (including response headers) summed to **603,671 bytes** in each run. The
  source-matched generated-graph measurement was **2,089,576 raw bytes** and
  **581,353 gzip bytes**.
- Readiness is measured from clicking Sign in until the Run tab is visible.
  Percentiles use nearest-rank; with five samples, p95 is the maximum:

  | Chromium profile | Run-ready samples (ms) | p50 | p95 | 10,000 ms budget |
  | --- | --- | ---: | ---: | --- |
  | Desktop | 8,484.19; 7,887.94; 8,042.44; 7,912.74; 10,974.16 | 8,042.44 | 10,974.16 | **FAIL** (1/5 over) |
  | Pixel 5 emulation | 7,909.99; 7,890.47; 7,891.41; 7,887.85; 7,894.01 | 7,891.41 | 7,909.99 | PASS (5/5) |
  | Combined | 10 source-matched runs | 7,902.00 | 10,974.16 | **FAIL** (1/10 over) |

- The over-budget desktop run had no failed resources and did load the Home
  chunk; its run-ready time was 10,974.16 ms. Keep the existing 10,000 ms budget
  authoritative and carry this observed miss forward for investigation. Next
  action owner: the assigned agent on active Task #3362 should reconcile this
  sample with that task's broader current-build matrix; if the overrun is
  reproduced, request a separately scoped Home performance remediation rather
  than relaxing the budget or inferring a byte cap.
- The timing interval starts after the sign-in screen is already visible, while
  the byte total covers all opening assets from the sign-in navigation plus
  authenticated Home loading. Thus, the byte total and readiness interval do
  not form a controlled byte-versus-readiness relationship.
- With five runs per profile, nearest-rank p95 is only the largest sample; the
  result is a minimum-size calibration sample, not a stable long-term percentile
  estimate.
- Compatibility: Chromium desktop and Pixel 5 phone emulation were measured.
  Tablet portrait/landscape, WebKit/Safari, and physical Android/iOS browsers are
  not applicable to this generated-graph byte-ceiling decision.
- An initial cache-warmed instrumentation attempt reported zero network
  transfer bytes and was excluded. The retained results come from the
  cache-disabled, service-worker-blocked rerun. Evidence contains aggregate
  byte counts and timings only; no account names, cookies, headers, or
  request/response bodies are retained.

## Threshold recommendation and revisit criteria

- **Blocking byte threshold now:** none. A fixed cap would be an unsupported
  conversion from bundle size to startup time and could fail on harmless growth
  or allow an unacceptable startup.
- **Current blocking threshold:** retain the existing 10,000 ms authenticated
  slow-network browser budget.
- **Reference for future comparisons:** 581,353 gzip bytes for the combined
  opening static JavaScript and HTML-linked CSS graph from the current source.
- **When to reconsider a byte cap:** obtain evidence that varies opening-graph
  size while holding the browser and network profile comparable, then choose a
  ceiling only if the resulting p95 remains below 10,000 ms with measured
  headroom. The current p95 desktop sample exceeds the budget and cannot support
  a cap. Keep the generated deferred-boundary checks as the separate protection
  against optional panels re-entering the opening graph.
