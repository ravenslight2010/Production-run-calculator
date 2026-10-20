# Home opening graph measurement — 2026-10-20

## Identity and build

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

- **F-01: PASS for the current production build.** The approved preparation process produced a verified identity for the actual source revision; both required build stages and both generated boundary checks completed. This is a local build result, not a publish or deployment result.
- **F-02: the intended deferral is confirmed in the current graph.** The four named panel chunks contribute 36,088 gzip bytes outside the opening static graph. This exceeds the roadmap's 25 KiB minimum materiality floor as a current deferred payload measurement.
- This is not a same-source before/after build comparison, authenticated browser transfer capture, or Home startup timing result. Do not interpret the deferred chunk sum as an exact historical reduction in bytes or latency. No behavior, provider, live-state, or Home composition change was made in this measurement task.

## Reproduction

From the repository root, run:

```bash
pnpm run publish:ready
node docs/evidence/measure-home-opening-graph.mjs
```

The first command uses the approved identity process and builds both stages without publishing. The second reads the generated Home boundary manifest and built assets, calculates the static opening closure and four named deferred chunks, and prints per-asset gzip totals. The build's generated Home boundary check remains authoritative for the deferred-surface contract.
