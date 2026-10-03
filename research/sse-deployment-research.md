## Repository Findings

- **Route contract:** `GET /sync/events` sets `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, and calls `res.flushHeaders()` before its database reads (`artifacts/api-server/src/routes/sync.ts:2210-2233`). This is correct for establishing an SSE response promptly, but the route does not set `X-Accel-Buffering: no`.
- **Initial baseline:** The handler sends an initial complete frame, including an empty-day frame, then registers the client baseline (`sync.ts:2239-2269`). A requested matching snapshot can produce an unchanged initial frame while still preserving the complete framing contract.
- **Heartbeats:** A configurable heartbeat defaults to 15 seconds and writes either a server-calculated heartbeat frame or the SSE comment `: heartbeat\n\n` (`sync.ts:2271-2307`). This is frequent enough to test an idle-timeout boundary, but the deployed proxy’s timeout is not visible in the repository.
- **Disconnect cleanup:** A response `close` listener deletes the client and clears both heartbeat and live-calc timers (`sync.ts:2219-2227`). This avoids retaining the response in the process-local client set after disconnect.
- **Peer fanout:** `clients` is a process-local `Set<SseClient>`. Broadcasts are filtered by scope and local date; the sender is excluded from its own SSE echo; a peer baseline advances only after `res.write` succeeds (`sync.ts:480-553`). This is correct for one process, but it cannot deliver a write made on process A to a client connected to process B without an external bus or another shared fanout mechanism.
- **Partial peer frames:** The complete initial/recovery frame is followed by a partial peer frame only when `buildSyncPeerDelta` is materially smaller; integration coverage asserts the initial complete frame and partial peer convergence (`sync.integration.test.ts:3573-3630`, `3734-3943`).
- **Existing tests:** Integration tests cover date-scoped delivery, initial complete baselines, partial-frame adoption, heartbeat schedule refresh, and deterministic abort of open streams. Cache-control tests confirm SSE uses streaming headers rather than the global `no-store` triplet (`cacheControl.integration.test.ts:279-293`).
- **Deployment metadata:** The supplied sanitized metadata reports an active successful public Autoscale deployment. `.replit:3-6` independently configures `deploymentTarget = "autoscale"`. This proves the selected target, not proxy buffering, active instance count, stream duration, or cross-instance fanout.

## External Evidence

1. **Replit deployment guidance — Tier 1, current documentation.** Replit describes Autoscale for variable-traffic web apps/APIs and Reserved VM for applications that must remain always-on. The deployment-types page does not itself promise SSE support; this is a compatibility warning, not proof that the current stream fails. Saved: `research/sources/sse-01-replit-deployment-types.md`.
2. **WHATWG HTML Standard — Tier 1 specification, living standard.** EventSource requires a successful response with `text/event-stream`, parses UTF-8 line-oriented events, dispatches on a blank line, automatically reconnects after connection loss, honors the server’s `retry` field, and stops reconnecting on HTTP 204. Saved: `research/sources/sse-02-whatwg-eventsource.md`.
3. **MDN SSE guidance — Tier 2 maintained technical reference.** SSE responses should use `text/event-stream` and commonly `Cache-Control: no-cache`; the example includes `X-Accel-Buffering: no`. MDN documents the browser’s non-HTTP/2 limit of roughly six simultaneous SSE connections per browser/domain and negotiated stream limits under HTTP/2. Saved: `research/sources/sse-03-mdn-using-sse.md`.
4. **NGINX proxy module — Tier 1 vendor reference.** `proxy_buffering` controls whether upstream responses are buffered; disabled buffering passes data to the client immediately. `proxy_read_timeout` applies between successive upstream reads, so a heartbeat must arrive before that interval or the proxy can close an otherwise healthy stream. Saved: `research/sources/sse-04-nginx-proxy-module.md`.
5. **Node.js HTTP API — Tier 1 runtime documentation.** `flushHeaders()` sends headers before the first body chunk; `ServerResponse` is a writable stream; `response.write()` can queue data and returns whether the kernel buffer accepted it. Saved: `research/sources/sse-05-node-http.md`.
6. **Redis Pub/Sub — Tier 1 vendor documentation.** Redis Pub/Sub is at-most-once: a disconnected subscriber permanently misses a message. It can provide cross-instance fanout, but it is not by itself a durable replay mechanism. Saved: `research/sources/sse-06-redis-pubsub.md`.

## Reproduction or Measurement Design

### Safe live verification protocol

Use an authenticated, non-destructive account and a synthetic or empty watch date. Never record response bodies, `data:` contents, cookies, authorization headers, production identifiers, or URLs containing credentials.

Record only:

- UTC start/end timestamps;
- HTTP status;
- response headers limited to `content-type`, `cache-control`, `connection`, `content-encoding`, `transfer-encoding`, `via`, `server`, and `x-accel-buffering` if present;
- time to headers, time to first frame, and inter-arrival times for comment/data frames without retaining frame contents;
- close reason category (client abort, server close, timeout, network error);
- whether reconnect occurred and elapsed reconnect delay;
- deployment revision if the platform exposes a non-sensitive build identifier.

Protocol:

1. Open one SSE stream and verify status 200, `text/event-stream`, and prompt headers.
2. Read and discard the initial frame; record only arrival time and whether it was complete/initial from a parser that does not persist content.
3. Leave the stream idle for at least two heartbeat intervals and record heartbeat arrival gaps.
4. Repeat with two and then several tabs/clients to identify browser connection-limit behavior.
5. Trigger one synthetic write from a second authenticated client; record whether the first stream receives a frame and whether the frame remains connected after receipt.
6. Abort and reconnect the stream; record recovery timing and whether the initial complete frame is received again.
7. If platform controls allow a second serving instance, repeat with clients opened over a scale event. A write must be sent through the application’s normal API, and only frame timing/status/mode may be retained.
8. Repeat through the published endpoint and an equivalent isolated local/staging endpoint. A local success is not production proof.

### Development/integration test additions

- Add a stream-header assertion for `X-Accel-Buffering` only if deployment evidence demonstrates it is required; do not add the header speculatively.
- Add a bounded heartbeat-gap test with an injected fake timer/clock rather than waiting 15 seconds.
- Add a multi-process fanout test that deliberately writes on process A and connects on process B; expected result under the current architecture is **no cross-process delivery**, documenting the boundary. Then test the selected external bus/replay design if one is introduced.
- Add a slow-consumer/backpressure test that checks bounded behavior without retaining frame bodies.

## Claim Assessments

- **“The application emits an SSE stream with correct basic framing.” — verified, high confidence.** Route headers, `flushHeaders()`, blank-line framing, and integration tests support this.
- **“Heartbeats prevent all deployed idle disconnects.” — partially verified, high confidence.** The application emits a default 15-second heartbeat, but proxy/server timeout and buffering settings are unavailable.
- **“The published Autoscale deployment reliably supports long-lived SSE.” — needs-human, medium confidence.** Current metadata proves Autoscale and build success only. Replit’s deployment guidance distinguishes always-on workloads from variable Autoscale behavior; an authenticated live timing test and platform-specific confirmation are required.
- **“Peer writes reach every connected device.” — partially verified, high confidence.** This is true for peers in the same process, scope, and date. It is unsupported across multiple serving instances because the registry is process-local.
- **“The sender does not receive a duplicate SSE echo.” — verified, high confidence.** The broadcast loop explicitly excludes the sender and advances its baseline from the canonical HTTP response.
- **“Proxy buffering is currently breaking the stream.” — unsupported, high confidence.** No deployment trace or live measurement was inspected; this remains a hypothesis.
- **“Redis Pub/Sub alone would make fanout reliable.” — contradicted, high confidence.** Redis documentation specifies at-most-once delivery; reconnect replay or authoritative recovery is still required.
- **“The six-connection browser limit will affect this application.” — partially verified, medium confidence.** MDN documents the limit for non-HTTP/2 SSE, but actual browser/protocol negotiation and tab count for this deployment were not measured.

## Recommendations

1. Treat the current Autoscale + process-local SSE combination as a **deployment compatibility risk requiring evidence**, not as a confirmed outage.
2. Run the sanitized live protocol above before changing heartbeat cadence or adding `X-Accel-Buffering: no`.
3. Keep the current complete initial/recovery frame and client recovery path; they are the safety net for stream gaps and at-most-once fanout.
4. If Autoscale can create multiple serving instances for this workload, move fanout to a shared event bus or use a deployment mode documented for continuously connected workloads. The bus must be paired with snapshot/revision recovery because Pub/Sub alone drops messages for disconnected subscribers.
5. Add bounded stream telemetry: client count, first-frame latency, heartbeat-gap percentile, reconnect count, close category, frame mode, and frame byte length. Never log SSE payloads.
6. Add a deployment runbook requiring verification of upstream read timeout, buffering, compression behavior, HTTP/2 negotiation, and scale-out behavior. Do not infer those values from local NGINX configuration.

## Gaps

- No authenticated live SSE probe was performed; no credentials were requested or retained.
- Deployment metadata does not expose active instance count, proxy implementation, buffering policy, idle timeout, compression, HTTP/2 negotiation, or cross-instance routing.
- Repository tests prove same-process behavior and protocol handling, not production network behavior.
- The Replit deployment-types source describes target classes but does not explicitly guarantee or reject SSE; the Autoscale compatibility concern therefore needs a platform-specific live test or support confirmation.
- No production trace was available to establish a reported reconnect or stale-update incident.

## Sources

1. Replit, “Deployment types,” current documentation — `https://docs.replit.com/features/publishing/deployment-types`; saved at `research/sources/sse-01-replit-deployment-types.md`; Tier 1 platform documentation.
2. WHATWG, “Server-sent events,” living HTML Standard — `https://html.spec.whatwg.org/multipage/server-sent-events.html`; saved at `research/sources/sse-02-whatwg-eventsource.md`; Tier 1 specification.
3. MDN Web Docs, “Using server-sent events,” current reference — `https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events`; saved at `research/sources/sse-03-mdn-using-sse.md`; Tier 2 maintained technical reference.
4. NGINX, “Module ngx_http_proxy_module,” current reference — `https://nginx.org/en/docs/http/ngx_http_proxy_module.html`; saved at `research/sources/sse-04-nginx-proxy-module.md`; Tier 1 vendor documentation.
5. Node.js, “HTTP,” v26.9.0 documentation — `https://nodejs.org/api/http.html#class-httpserverresponse`; saved at `research/sources/sse-05-node-http.md`; Tier 1 runtime documentation.
6. Redis, “Redis Pub/Sub,” current documentation — `https://redis.io/docs/latest/develop/pubsub/`; saved at `research/sources/sse-06-redis-pubsub.md`; Tier 1 vendor documentation.