# Home opening graph and authenticated load — 2026-10-22

> **Measured build:** The authenticated measurement below is verified for build `app-build:ada7e7f3-60a0-40a2-9b82-04229870f7ac` at source revision `7b21b045d150c9b04ac5ac3070117a3d418f9114`. This evidence is pinned to that exact build and does not claim to cover later main-branch changes.

## Earlier graph snapshot identity and build — 2026-10-20

- Source revision: `85b20fed1b40dea1a7267b11b579c6e4c5783e39` (`gitBinding: verified`)
- Application build ID: `app-build:9d208ebc-900e-41ea-9ea1-7d639152f04e`
- Source fingerprint: `5f4f944d4bc2bcd23cf3b41efc1d8f9cc5fef81894cfa5eea0ccca33951f1d2a`
- Web output fingerprint: `a8ad01f0cf6bd85aa6d3d50eef572e3063997512e4583e887430259e07d82e55`
- Preparation/build: approved `pnpm run publish:ready`; it refreshed identity from the actual source and built API and web stages. It did not publish or deploy.
- Both API and web build records, plus the independent expected record, have the same application build ID, revision, and source fingerprint.

## Boundary checks

- Production web build: **PASS**. API and web build stages completed and the production identity sealed.
- Generated workbook boundary check: **PASS** — 650 opening modules; 15 deferred workbook entry points verified.
- Generated Home deferred-boundary check: **PASS** — 650 opening modules; all 18 optional Home surfaces are deferred.
- The four named panels are absent from the opening static chunk closure and are listed as dynamic imports of the Home entry.

## Sizes

Sizes are exact bytes read from the matching production output. Gzip sizes use Node 24.13.0 `zlib.gzipSync` with its default compression level, measured per emitted asset and summed; this reflects separate asset transfers, not a concatenated bundle. Decimal kB below is bytes divided by 1,000. The opening JavaScript graph starts at both the application entry and the Home entry and follows static manifest imports only. CSS linked by the generated `index.html` is reported separately. HTML, manifest, service worker, and dynamically loaded assets are excluded from the opening graph totals.

| Asset set | Raw bytes | Gzip bytes | Raw decimal kB | Gzip decimal kB |
| --- | ---: | ---: | ---: | ---: |
| Opening static JavaScript graph (60 unique chunks) | 1,886,399 | 550,151 | 1,886.399 | 550.151 |
| Opening stylesheet | 199,811 | 30,325 | 199.811 | 30.325 |
| Opening JavaScript + stylesheet | 2,086,210 | 580,476 | 2,086.210 | 580.476 |
| Home entry chunk alone | 920,905 | 242,926 | 920.905 | 242.926 |
| Four deferred panel chunks | 126,301 | 36,088 | 126.301 | 36.088 |

| Deferred panel chunk | Raw bytes | Gzip bytes |
| --- | ---: | ---: |
| `SetupContent` | 24,902 | 7,507 |
| `WarehouseTabContent` | 21,210 | 6,054 |
| `MixesTabContent` | 21,007 | 6,232 |
| `SummaryToolsContent` | 59,182 | 16,295 |

## Conclusion

- **F-01: PASS for the 2026-10-20 production build documented here.** The verified build and boundary checks passed at that revision; this is not a result for the later current checkout.
- **F-02: the intended deferral was confirmed in that graph.** The four named panel chunks contributed 36,088 gzip bytes outside its opening static graph.
- This earlier graph snapshot is not a same-source before/after comparison or a latency estimate. The current graph and authenticated measurements follow.

## Production graph for measured build — 2026-10-22

- Build identity: `app-build:ada7e7f3-60a0-40a2-9b82-04229870f7ac`, source revision `7b21b045d150c9b04ac5ac3070117a3d418f9114`, source fingerprint `58648aead9f0f8b9ddb0b3a013ba75f76f1b4cea51e9de4952f3a86b5befa922` (`gitBinding: verified`).
- The workbook boundary passed with 659 opening modules and 15 deferred entry points. The Home boundary passed with 659 opening modules and 27 deferred surfaces.

| Current asset set | Raw bytes | Gzip bytes |
| --- | ---: | ---: |
| Opening static JavaScript graph (54 chunks) | 1,920,327 | 558,680 |
| Opening stylesheet | 201,155 | 30,553 |
| Opening JavaScript + stylesheet | 2,121,482 | 589,233 |
| Four deferred panel chunks | 126,139 | 36,057 |

| Current deferred panel chunk | Raw bytes | Gzip bytes |
| --- | ---: | ---: |
| `SetupContent` | 24,900 | 7,501 |
| `WarehouseTabContent` | 21,243 | 6,065 |
| `MixesTabContent` | 20,942 | 6,221 |
| `SummaryToolsContent` | 59,054 | 16,270 |

All four named panel chunks remain outside the current opening static graph and load through Home dynamic imports. The current deferred total is 36,057 gzip bytes. The static graph's CSS figure is the stylesheet linked from generated `index.html`; it is not a browser total of transitive CSS or font requests. The authenticated capture below separately reports same-origin JavaScript and CSS bytes observed by the browser.

## Authenticated browser measurement — 2026-10-22

### Build identity

- Source revision: `7b21b045d150c9b04ac5ac3070117a3d418f9114` (`gitBinding: verified`, `buildMode: publish`)
- Application build ID: `app-build:ada7e7f3-60a0-40a2-9b82-04229870f7ac`
- Source fingerprint: `58648aead9f0f8b9ddb0b3a013ba75f76f1b4cea51e9de4952f3a86b5befa922`
- `pnpm run publish:ready` prepared and built the local production output for this exact source revision. The API build record and independently prepared expected-source record matched; the web build used the same application build ID. Both boundary checks passed. The app was not published or deployed.

### Method and network profile

- The timing run used the isolated test database and fixture accounts only. Each of five samples per viewport used a new browser context and fixture account and signed in through the app UI.
- Home first-view time starts at the Sign in submission mark and ends when the Run tab is active, including server-backed session confirmation.
- Chromium desktop viewport: 1280 × 800. Chromium phone viewport: 390 × 844 with mobile and touch emulation.
- Chromium network emulation: 400 ms latency, 64,000 bytes/s upload and download (500 Kibit/s each), with the `cellular3g` connection hint. HTTP cache was disabled.
- Service workers were blocked in timing contexts to isolate page-initiated transfers. This excludes service-worker installation and PWA precache traffic; results are not whole-install PWA byte totals.
- JavaScript and CSS bytes are summed from same-origin `PerformanceResourceTiming.transferSize` entries completed by the Home first-view mark. The resource window includes JavaScript/CSS loaded during the initial `/sign-in` navigation before the submit mark, so the byte totals represent all same-origin JS/CSS transferred by the time Home first appears, not only bytes downloaded after sign-in submission. Transfer sizes include response headers; HTML, API data, fonts, other origins, and service-worker traffic are excluded.
- p50 is the median. p95 uses nearest-rank over five samples, so it equals the largest observed sample and is not a stable population estimate.
- The full matrix run collected timing and smoke evidence against this same sealed build. Each desktop and phone timing project used five new authenticated contexts.

### Home first-view timing and transferred bytes

| Viewport | Samples | First view p50 / p95 (ms) | JavaScript p50 / p95 (bytes) | CSS p50 / p95 (bytes) |
| --- | ---: | ---: | ---: | ---: |
| Chromium desktop, 1280 × 800 | 5 | 11,316 / 11,350 | 789,823 / 789,823 | 30,877 / 30,877 |
| Chromium phone, 390 × 844 | 5 | 11,349 / 11,382 | 789,823 / 789,823 | 30,877 / 30,877 |

### Deferred panel first use

Each panel's chunk was absent from the measured Home first-view resource list. After selection, the test waited for the panel heading and chunk response. All 40 selected chunk requests across the 10 timing samples returned HTTP 200.

| Deferred panel | Desktop p50 / p95 (ms) | Phone p50 / p95 (ms) | Successful selections |
| --- | ---: | ---: | ---: |
| Setup | 2,223 / 2,261 | 2,235 / 2,261 | 10 / 10 |
| Warehouse | 1,889 / 2,045 | 1,876 / 1,880 | 10 / 10 |
| Mix Plan | 1,223 / 1,717 | 1,197 / 1,218 | 10 / 10 |
| Summary | 1,667 / 1,687 | 1,147 / 1,665 | 10 / 10 |

### Browser matrix and result scope

| Browser | Viewport | Evidence |
| --- | --- | --- |
| Chromium | Desktop | Timing: 5 clean samples; functional smoke: PASS |
| Chromium | Phone | Timing: 5 clean samples; functional smoke: PASS |
| Chromium | Tablet portrait | Functional smoke only: PASS |
| Chromium | Tablet landscape | Functional smoke only: PASS |
| WebKit | Desktop | Functional smoke only: PASS |
| WebKit | Phone | Functional smoke only: PASS |
| WebKit | Tablet portrait | Functional smoke only: PASS |
| WebKit | Tablet landscape | Functional smoke only: PASS |

The full run on this build completed with **10 passed, 6 skipped (9.9 minutes)**: eight functional smoke cases passed across the matrix; the two Chromium desktop/phone timing captures passed; timing was intentionally skipped for the other six configurations. All 10 timing samples confirmed the four panel chunks were absent from the Home first-view resource list; after selection, all 40 chunk requests returned HTTP 200 and the panel headings appeared. The smoke checks treat only HTTP 4xx/5xx as script-response errors, while network request failures and page errors remain failures; valid `304 Not Modified` responses are not classified as errors. Physical Android Chrome and iOS Safari/PWA were not required and were not tested.

The measurement spec is `artifacts/run-calculator/e2e/home-opening-measurement.spec.ts`; the matrix and isolated runner are configured in `artifacts/run-calculator/playwright.home-opening-measurement.config.ts`. Only aggregate timings, byte counts, panel names, and response statuses are retained here. No HAR, cookies, authentication headers, request bodies, screenshots, traces, or videos are retained.

To repeat on a newly prepared local production build, run `pnpm run publish:ready`, then:

```bash
BROWSER_TEST_INSTALL_WEBKIT=1 \
  bash scripts/src/run-release-node.sh \
  env npm_config_offline=true \
  bash scripts/src/run-isolated-browser-suite.sh \
  --playwright-config=playwright.home-opening-measurement.config.ts
```

## Reproduction

From the repository root, run:

```bash
pnpm run publish:ready
node docs/evidence/measure-home-opening-graph.mjs
```

The first command uses the approved identity process and builds both stages without publishing. The second reads the generated Home boundary manifest and built assets, calculates the static opening closure and four named deferred chunks, and prints per-asset gzip totals. Its CSS total is limited to the generated-index stylesheet link; it does not include all transitive CSS/font requests. The build's generated Home boundary check remains authoritative for the deferred-surface contract.

## Rebase source-input restoration — 2026-10-22

- The rebase removed the source-library audit directory still required by the build identity check and API reconciliation code. With the user's approval, the 11 retained files in that directory were restored byte-for-byte from the previously verified source snapshot and recommitted during the rebase. No other deleted attachments were restored.
- The restored inputs allowed `publish:ready` to produce a verified source identity and local production build for revision `7b21b045d150c9b04ac5ac3070117a3d418f9114`, followed by the full browser matrix above. A later main sync advanced the workspace head and included Line Map and graph-evidence-helper changes after this capture; this report remains bound to the measured build above. No production publish or deployment occurred.
