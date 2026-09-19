## Repository Findings

**Revision reviewed:** `b0f9d281ece0002fc0ad9543edb8dbdac84ceeb4`

- `artifacts/api-server/src/lib/syncContract.ts` measures wire size as `Buffer.byteLength(JSON.stringify(value))`; this is UTF-8 JSON body size before HTTP content encoding. Peer delta generation is currently limited to `runValues`, `runValuesUpdatedAt`, and `packagingProgress`; changed `dayState` or other sections are represented as whole changed sections.
- `artifacts/api-server/src/routes/sync.ts` emits a partial peer frame only when `syncWireBytes(delta) < syncWireBytes(complete) * 0.8`. The comparison includes the complete/partial frame objects and server live-projection fields, not only the `data` member. Initial/recovery frames are complete. Peer baselines advance only after `res.write()` succeeds.
- Incoming payloads are structurally sanitized before persistence/broadcast in `protectRunValues.ts`: unknown top-level keys are removed; run lists/maps are capped at 50; name arrays at 500 entries and 200 characters per entry; shift notes at 2,000 characters. The final sanitized UTF-8 JSON aggregate is capped at 512 KiB and rejected before persistence. The merged result is capped separately; optional bulk fields can be trimmed rather than losing run/value data.
- Existing tests provide unusually useful fixture-level measurement. `sync.integration.test.ts` has a 32-run “large day” benchmark that records complete/partial request bytes, response bytes, latency, merge time, convergence, and savings. It asserts partial request savings above 50% but does not retain a historical percentile series.
- Existing SSE integration coverage validates a 32-run synthetic full-shift sequence, reconstruction/convergence, partial versus complete frame counts, actual partial bytes, equivalent complete bytes, and lifecycle fallback behavior. It is release-test evidence, not production telemetry.
- Existing observability records bounded response bytes through `content-length`, response mode headers, retry count, queue age, and convergence markers. It does **not** currently record incoming complete/partial mode, sanitized request bytes, SSE frame bytes/mode, or aggregate partial-fallback adoption metrics.
- The code already exposes safe per-request response-size headers in tests (`X-Sync-Response-Bytes`) and bounded queue age (`X-Sync-Queue-Age-Ms`), while client timing metadata is not persisted.

## External Evidence

1. **RFC 6902, IETF Standards Track, April 2013 — Tier 1** ([source](https://www.rfc-editor.org/rfc/rfc6902.html), saved at `research/sources/payload-01-rfc6902.md`). JSON Patch is an array of operation objects with `add`, `remove`, `replace`, `move`, `copy`, and `test`; operations apply sequentially and stop on an error. It is a general operation language, not merely a sparse object overlay.
2. **RFC 7396, IETF Standards Track, October 2014 — Tier 1** ([source](https://datatracker.ietf.org/doc/html/rfc7396), saved at `research/sources/payload-02-rfc7396.md`). JSON Merge Patch resembles the target object; omitted members remain unchanged, supplied members replace/add, and `null` means removal. It is primarily object-oriented, cannot patch a subpart of an array, and cannot distinguish an explicit stored null from deletion.
3. **MDN, “Compression in HTTP,” modified August 27, 2026 — Tier 2** ([source](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Compression), saved at `research/sources/payload-03-http-compression.md`). HTTP content encoding is negotiated with `Accept-Encoding`; the response identifies the selected encoding with `Content-Encoding` and should include `Vary: Accept-Encoding`. Modern browsers commonly support gzip and Brotli. Compression is end-to-end and must be evaluated separately from the uncompressed application-size limit.
4. **WHATWG HTML Standard, Server-Sent Events — Tier 1** ([source](https://html.spec.whatwg.org/multipage/server-sent-events.html), saved at `research/sources/payload-04-sse-standard.md`). SSE is UTF-8 `text/event-stream`; events are separated by blank lines and data is carried in `data:` lines. The browser reconnects when a stream closes, and comment lines can serve as keep-alives. Every frame therefore has framing overhead in addition to JSON bytes, and compression/proxy buffering can affect delivery even though they do not change the SSE grammar.
5. **Google SRE Workbook, Monitoring Systems with Advanced Analytics — Tier 2, publication date not shown on fetched page** ([source](https://sre.google/workbook/monitoring/), saved at `research/sources/payload-05-google-sre-percentiles.md`). Percentiles expose tail behavior that averages hide; p50/p95/p99 are useful for latency-like distributions. Counters support windowed rates, and histograms/heatmaps support distribution visibility. This supports retaining aggregated distributions rather than raw payload records.
6. **OpenTelemetry Metrics Data Model, stable specification — Tier 1/standards-maintainer source, current page fetched 2026-09-19** ([source](https://opentelemetry.io/docs/specs/otel/metrics/data-model/), saved at `research/sources/payload-06-otel-metrics.md`). Raw metric events should be aggregated; histograms are specifically intended to represent statistically meaningful distributions in compressed form. Temporal and spatial reaggregation, including removing unwanted/high-cardinality attributes, are supported design goals.

## Reproduction or Measurement Design

### A. Fixture baseline (safe and immediately available)

Use the existing 32-run synthetic fixture and add a measurement-only harness around the already-covered paths. Do not retain payload content.

For every complete PUT, partial PUT, partial fallback, complete peer frame, and partial peer frame record only:

```text
sync.mode = complete | partial | partial_fallback
sync.direction = put_request | put_response | sse_peer
sync.status = accepted | rejected | unchanged
sync.runs = bounded integer, 0..50
sync.bytes = UTF-8 JSON bytes before HTTP content encoding
sync.wire_bytes = actual serialized frame/body bytes where available
sync.duration_ms = bounded integer
sync.converged = boolean in fixture tests only
```

Run at least these fixture cases:

1. Empty day / one run / 32 runs / 50 runs.
2. One changed run value, one changed packaging map, one changed `dayState`, one deleted run, and a master-data-only change.
3. Partial write with valid base, stale base, malformed base, and a raced base.
4. Peer with matching baseline, missing baseline, successive disjoint edits, and a dropped write where the baseline must not advance.
5. Near the 512 KiB sanitized cap and oversized incoming payload rejection.

Calculate p50/p95/p99/max for complete request, partial request, complete SSE, partial SSE, fallback response, and savings percentage. Keep fixture output as release evidence with revision, fixture identity, date, and environment; never include actual JSON values.

### B. Production-safe telemetry

Add bounded structured metrics at the route/broadcast boundaries, sampled if volume requires it. Suggested low-cardinality dimensions:

- `mode`: `complete`, `partial`, `partial_fallback`, `unchanged`
- `direction`: `put_request`, `put_response`, `sse_peer`
- `outcome`: `accepted`, `rejected`, `sent`, `write_failed`
- `runs_bucket`: `0`, `1-5`, `6-20`, `21-50`
- `bytes`: histogram, not a raw payload
- `duration_ms`: histogram
- `fallback_count`, `partial_count`, `complete_count`, `parser_413_count`

Do not label by snapshot ID, date, device ID, user ID, facility, sender ID, recipe, or arbitrary error text. Counters plus histograms permit rates and percentiles while avoiding payload retention and high-cardinality cost. Record the sanitized candidate size and the selected frame/body size separately; do not confuse the 512 KiB product cap with compressed transport bytes.

### C. Compression experiment

Measure three values independently: application JSON bytes, compressed HTTP bytes, and end-to-end response time. Test gzip and Brotli on representative fixture bodies, especially complete responses and SSE. For normal PUT/GET responses, negotiate through standard content-coding headers. For SSE, verify that compressed chunks flush promptly and do not cause proxy/client buffering; do not enable it solely because it reduces byte count.

### D. Reproduction limitations

The existing tests use disposable databases and synthetic data. They can prove size behavior, convergence, sanitizer bounds, and frame selection. They cannot establish the distribution of real facility days, actual Wi-Fi transfer cost, deployed proxy buffering, or the percentage of production writes that are partial. Those require the bounded telemetry above or a sanitized production-like export.

## Claim Assessments

- **“Partial sync materially reduces payloads.” — verified, high confidence for tested fixtures.** The large-day test records a complete baseline and one-run partial update and asserts greater than 50% request savings. Scope is synthetic 32-run data; no production percentile claim follows.
- **“The current system has measured production partial-adoption and fallback rates.” — unsupported, high confidence.** Repository observability records some response bytes and response headers, but no retained mode/fallback/frame-size distribution was found.
- **“The 512 KiB cap is the wire-size limit.” — partially verified, high confidence.** It is the sanitized aggregate application-document limit. HTTP compression, headers, SSE framing, and parser limits are separate transport layers.
- **“The partial contract is JSON Patch.” — contradicted, high confidence.** The repository performs sparse section/map overlays, while RFC 6902 defines an ordered operation array. The current contract is closer to a purpose-built sparse merge with snapshot preconditions.
- **“JSON Merge Patch would be a drop-in replacement.” — unsupported, high confidence.** RFC 7396’s null-as-delete semantics and inability to patch inside arrays conflict with the application’s tombstones, explicit field behavior, and run-list protection unless substantial adaptation is added.
- **“SSE frame size equals JSON `data` size.” — partially verified, high confidence.** `syncWireBytes` measures JSON serialization of a frame object for threshold selection, while actual SSE adds `data:`, UTF-8 framing, blank-line delimiters, and potentially event/projection fields. The existing tests correctly compare raw received line bytes against a complete equivalent, but production frame percentiles are not retained.
- **“Compression can be enabled without protocol changes.” — partially verified, medium confidence.** HTTP content codings are standardized and browser-supported, but deployment/proxy behavior and SSE flush latency remain unverified. `Content-Encoding`/`Vary` and operational stream testing are required.
- **“Averages are sufficient for sync payload planning.” — contradicted, high confidence.** Google SRE guidance supports percentiles/distributions for tail behavior; OpenTelemetry supports histogram aggregation. Averages alone could hide near-cap complete writes or large fallback tails.
- **“The sanitizer’s comment that legitimate day-state is well under 200 KB is a measured production fact.” — partially verified, low confidence.** It is an implementation comment and historical rationale; the repository does not contain a production distribution proving it.

## Recommendations

1. **Retain the current sparse contract as the baseline.** It already provides meaningful savings for changed run maps and avoids introducing RFC 6902 operation semantics into `protectRunValues`.
2. **Add bounded mode/size histograms before expanding coverage.** Separate complete, partial, fallback, unchanged, PUT, response, and SSE-peer measurements. Use p50/p95/p99/max and rates over a defined window.
3. **Promote the existing large-day benchmark into durable evidence.** Preserve fixture identity, revision, environment, and aggregate metrics only. Add changed-section cases and a 50-run near-cap case.
4. **Do not use the 512 KiB cap as a p95 target.** Treat it as a hard sanitized-document bound; set success targets only after obtaining real distributions. The current “p95 partial body <500 KB” target is weakly framed because partial bodies should normally be far below the cap, while complete/fallback tails need separate reporting.
5. **Measure compression after structural reduction.** Test gzip/Brotli for ordinary HTTP bodies; treat SSE as a separate experiment due to flush/buffering risk. Compression cannot replace the application cap or sparse fallback rules.
6. **Defer JSON Patch unless measurements show sparse-map coverage is insufficient.** If adopted later, apply it to a reconstructed candidate before the existing merge/protection pipeline, require a snapshot precondition, and retain complete fallback. Do not patch inside `protectRunValues`.
7. **Use low-cardinality telemetry.** No payload content, IDs, dates, recipes, user/device labels, or raw request/SSE bodies. Counters and histograms are enough to answer adoption and economics questions.

## Gaps

- No production payload distribution, partial-adoption rate, fallback rate, parser-413 count, or SSE frame percentile is present in the repository evidence reviewed.
- No authenticated production stream probe was performed; deployment/proxy behavior is outside this payload-only track.
- The test suite’s benchmark logs are ephemeral unless CI/release evidence explicitly retains the aggregate output.
- Compression ratio and CPU/latency tradeoffs have not been measured on representative fixture bodies.
- Existing observability’s `content-length` can be absent for chunked/SSE responses; a dedicated frame-byte counter is needed for peer streams.
- Source retrieval dates are recorded in saved source headers; historical publication dates are available for RFCs, while Google SRE’s fetched page did not expose one. Treat it as engineering guidance, not a time-sensitive benchmark.

## Sources

1. RFC 6902, “JavaScript Object Notation (JSON) Patch,” IETF Standards Track, April 2013. https://www.rfc-editor.org/rfc/rfc6902.html — saved: `research/sources/payload-01-rfc6902.md` — Tier 1.
2. RFC 7396, “JSON Merge Patch,” IETF Standards Track, October 2014. https://datatracker.ietf.org/doc/html/rfc7396 — saved: `research/sources/payload-02-rfc7396.md` — Tier 1.
3. MDN, “Compression in HTTP,” modified August 27, 2026. https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Compression — saved: `research/sources/payload-03-http-compression.md` — Tier 2.
4. WHATWG, “HTML Standard — Server-sent events.” https://html.spec.whatwg.org/multipage/server-sent-events.html — saved: `research/sources/payload-04-sse-standard.md` — Tier 1.
5. Google SRE Workbook, “Monitoring Systems with Advanced Analytics.” https://sre.google/workbook/monitoring/ — saved: `research/sources/payload-05-google-sre-percentiles.md` — Tier 2.
6. OpenTelemetry, “Metrics Data Model,” stable specification. https://opentelemetry.io/docs/specs/otel/metrics/data-model/ — saved: `research/sources/payload-06-otel-metrics.md` — Tier 1/maintainer specification.
7. Repository evidence at revision `b0f9d281ece0002fc0ad9543edb8dbdac84ceeb4`: `artifacts/api-server/src/lib/syncContract.ts`, `artifacts/api-server/src/lib/protectRunValues.ts`, `artifacts/api-server/src/lib/observability.ts`, `artifacts/api-server/src/routes/sync.ts`, `artifacts/api-server/src/routes/sync.integration.test.ts`, and `artifacts/api-server/src/routes/sync.convergence.integration.test.ts`. These are implementation/test sources, not external sources and not production proof.