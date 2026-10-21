# Home opening-graph byte guard decision — 2026-10-21

## Decision

Do not add a blocking JavaScript/CSS byte-size guard yet. The generated graph
measurement is repeatable, but the available evidence does not establish a
byte ceiling that preserves the existing authenticated-startup target. Keep the
10,000 ms first-authenticated-visit-on-slow-3G browser budget as the blocking
user-facing threshold.

Use **580,520 gzip bytes** as the current source-matched opening JavaScript +
CSS reference value, not as a CI failure limit. Revisit a byte limit after
current-build browser evidence includes actual encoded transfer sizes and
enough clean slow-network runs to compare graph size with the 10,000 ms budget.
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
states that it contains no authenticated browser transfer or startup timing.
Neither result can calibrate a current byte ceiling. A current first-load
measurement is being gathered separately; this decision does not assume its
result.

## Threshold recommendation and revisit criteria

- **Blocking byte threshold now:** none. A fixed cap would be an unsupported
  conversion from bundle size to startup time and could fail on harmless growth
  or allow an unacceptable startup.
- **Current blocking threshold:** retain the existing 10,000 ms authenticated
  slow-network browser budget.
- **Reference for future comparisons:** 580,520 gzip bytes for the combined
  opening static JavaScript and HTML-linked CSS graph from the current source.
- **When to reconsider a byte cap:** capture actual encoded bytes for the
  opening assets on the source-matched production build across at least five
  clean authenticated slow-network browser contexts, report p50/p95 readiness,
  and choose a cap only when the measured relationship shows that it preserves
  the 10,000 ms target with measured headroom. Keep the generated deferred
  boundary checks as the separate protection against optional panels re-entering
  the opening graph.
