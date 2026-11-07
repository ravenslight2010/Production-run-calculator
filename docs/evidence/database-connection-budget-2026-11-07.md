# Database connection budget before scaling

## Decision summary

**The current fleet-wide maximum cannot be verified from the available
read-only platform metadata. Do not treat the conditional 30-connection
calculation below as a confirmed Autoscale ceiling.**

The API's source default is **10 PostgreSQL pool connections per Node process**.
The production command starts one Node API process per service instance. Replit
reported **one active service instance** in the latest hourly metric sample
reviewed, at `2026-11-07T05:47:00.134Z`; the highest sampled value across the
preceding seven days was also one. These are sampled observations, not the
configured Autoscale maximum or a continuous peak.

An earlier evidence capture recorded an **owner-reported** Autoscale maximum of
three machines, but that setting was not independently verified and is dated
2026-10-11. If three remains the configured maximum, the source-default API
pool budget would be:

```text
10 connections/process × 1 API process/machine × 3 machines = 30 connections
```

The current configured maximum is unknown. Therefore the possible fleet-wide
API pool maximum is also **unknown**. The 30-connection figure is conditional,
not a verified ceiling.

PostgreSQL primary evidence recorded `max_connections=450`,
`superuser_reserved_connections=4`, and `reserved_connections=0`. This gives
**446 ordinary PostgreSQL slots before connected clients and any provider-side
limits or reserves**. The later 2026-11-06 capacity summary reported 433–439
ordinary slots remaining in five sparse primary samples. Neither those samples
nor the configured PostgreSQL value establish the provider's effective
application quota or peak headroom.

## Capture and provenance

- **Evidence report captured:** 2026-11-07. The existing
  `background-wake-correlation-2026-11-06.md` evidence file was last modified
  at 05:44 UTC; the deployment metric query ended at approximately 05:47 UTC.
- **Environment:** published production Autoscale deployment.
- **Deployment metadata:** active, public, latest status successful.
- **Build history:** the latest successful listed build was
  `47fc67c3-272e-4f68-bb8c-c8eb2735385f`, created
  `2026-11-06T23:55:33Z`; its reported machine shape was 2 vCPU / 4 GiB.
  `getDeploymentInfo` did not expose a serving build/revision ID, so this
  history result is not asserted to be the exact serving revision.
- **Metric source:** Replit's supported `compute_instance_count` metric,
  queried for 2026-10-31T05:47:00Z–2026-11-07T05:47:00Z in 168 hourly
  samples. Highest returned sample: 1; last returned sample: 1. A sampled
  series is not a configured cap or continuous instance census.
- **Database evidence source:** sanitized, app-owned primary-capacity reports
  retained in
  `docs/evidence/reliability-closure-supported-production-observations.json`
  (2026-11-01T15:29:53Z) and
  `docs/evidence/background-wake-correlation-2026-11-06.md` (five later
  samples during its 2026-11-06 focus window). The Nov 6 summary reported
  ordinary remaining-slot estimates only; it did not retain the corresponding
  max/reserve settings per sample.
- **Older Autoscale evidence:** `docs/evidence/sse-capacity-observation-2026-10-11.json`
  records an owner-reported maximum of three machines. This is historical and
  not a current platform-verified setting.
- **Sanitization:** this report retains only deployment/build identifiers,
  aggregate instance samples, numeric database settings, and calculated
  budgets. It contains no credentials, connection strings, customer records,
  raw logs, SQL text, host/process IDs, or database names.
- **Operations:** no secret was read, no customer records were queried, no
  production write or load test was performed, and no deployment or database
  setting was changed.

## Verified source and deployment configuration

`lib/db/src/index.ts` configures the shared `pg.Pool` with a default maximum of
10. A positive integer `DATABASE_POOL_MAX` environment value overrides that
default. The environment override is not exposed by the deployment metadata
available in this read-only investigation. The 2026-11-06 production
capacity-summary report recorded pool totals from 4 through 10, consistent
with the source default but not sufficient by itself to rule out a larger
configured maximum.

The production run command in `.replit` starts the API with one Node process
using `exec node ...`. Thus, for an Autoscale maximum of `N` machines and a
per-process maximum of `P`, the API pool allocation bound is:

```text
API pool allocation = N × 1 process/machine × P
```

Using the source default (`P=10`) gives 10 connections per process. An
environment override could change `P`; its production value remains unknown.

## Database ceiling and conditional arithmetic

The retained primary snapshot reports:

| Item | Observed value | Interpretation |
| --- | ---: | --- |
| PostgreSQL `max_connections` | 450 | Observed server setting in the 2026-11-01 primary sample |
| `superuser_reserved_connections` | 4 | Known reserved slots |
| `reserved_connections` | 0 | Known role-reserved slots in that sample |
| Ordinary slots before clients | 446 | `450 - 4 - 0` |
| Ordinary slots remaining | 439 | Same sample, after visible client backends |
| Later ordinary slots remaining | 433–439 | Five sparse primary samples summarized for 2026-11-06 |
| Provider-specific quota/reserves | Unknown | Replit documentation does not publish a fixed connection quota |
| Peak non-API client demand | Unknown | Sparse samples are not a peak measurement |

Conditional on all of the following—three machines still being the configured
maximum, one API process per machine, the effective pool max being 10, and no
tighter provider-side limit—the API could allocate at most **30** connections
and leave **416** of the 446 ordinary PostgreSQL slots for all other clients:

```text
446 ordinary slots - (3 machines × 1 process × 10 connections) = 416
```

This is arithmetic, not proof of safe headroom. It does not account for
provider-specific restrictions, other database clients, connection proxies or
multiplexing, or a production `DATABASE_POOL_MAX` override.

## Autoscale bounds and unavailable evidence

- Official Replit documentation says the maximum machine count is configurable
  in **Publishing → Adjust settings → Machine configuration**. The current
  configured value was not returned by deployment metadata or build details.
- `compute_instance_count` is available as a sampled active-instance metric.
  It describes observations, not the configured maximum.
- The deployment build detail exposes machine CPU and memory shape, not
  Autoscale minimum/maximum instance settings.
- Replit's database documentation says connection management is handled by the
  database and does not publish fixed `max_connections` or
  `reserved_connections` quotas. Provider-side reservations or a stricter
  connection policy remain unknown.
- The serving build ID was not directly bound to current deployment metadata.
  Prior Nov 6 runtime evidence also noted more than one runtime build identity,
  so source-to-serving-build identity should not be inferred from build
  recency alone.
- A fresh deployment-log read was unavailable through the `getDeploymentLogs`
  callback in this execution context. The database figures above therefore
  cite the already-retained, sanitized reports rather than claiming a new
  live primary query.

## Sources

- Replit official docs, [Machine configuration](https://docs.replit.com/features/publishing/machine-configuration):
  maximum Autoscale machine count is configured in the Publishing settings.
- Replit official docs, [Database](https://docs.replit.com/features/data-and-storage/sql-database):
  connection management is handled automatically; fixed provider quotas are
  not published.
- `lib/db/src/index.ts`: source pool maximum and environment override.
- `.replit`: Autoscale target and one-process API run command.
- `artifacts/api-server/src/lib/databaseCapacity.ts`: read-only capacity
  sample fields and explicit unknown provider/Autoscale bounds.
- `docs/evidence/reliability-closure-supported-production-observations.json`:
  sanitized 2026-11-01 primary snapshot.
- `docs/evidence/background-wake-correlation-2026-11-06.md`: later sparse
  primary remaining-slot samples and pool-pressure summary.
- `docs/evidence/sse-capacity-observation-2026-10-11.json`: historical,
  owner-reported Autoscale maximum; not current verification.

## Completion assessment

- **Per-process source default:** 10; production environment override remains
  unknown.
- **Current sampled service instances:** 1 in the last hourly sample; observed
  seven-day sampled maximum 1. Not a fleet maximum.
- **Current configured Autoscale maximum:** unknown.
- **Database PostgreSQL settings:** 450 maximum, 4 superuser-reserved, 0
  role-reserved in the latest fully enumerated retained primary snapshot.
- **Provider-specific connection limit/reserves:** unknown.
- **Fleet budget:** unknown overall; historical three-machine scenario yields
  30 API pool connections only if its assumptions still hold.
- **Changes made:** none to pool sizes, timeouts, scaling settings, database
  limits, or worker schedules.
