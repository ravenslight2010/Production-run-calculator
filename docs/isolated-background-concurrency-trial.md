# Isolated background concurrency comparison

This is an opt-in synthetic experiment, not a production tuning command.
It exercises the existing protected server-job worker at source fallback
concurrency **2** and trial concurrency **1**. It does not change that fallback,
production configuration, any other scheduler, or an outbox.

## Required fixture

Run only with a disposable PostgreSQL cluster listening on loopback. Set
`DATABASE_URL` to a parent database named `closure_trial_parent_<suffix>`.
Use a synthetic `SESSION_SECRET` and `STAFF_SIGNUP_CODE`; do not supply real
provider, account, signing, or source-capture credentials.

Using the existing pinned-runtime runner:

```sh
bash scripts/src/run-release-node.sh pnpm run trial:background-concurrency
```

The command opts in explicitly and runs only the matching integration case.
The case refuses a remote/shared parent, creates its normal disposable child,
and verifies the actual child connection, database identity, and four-slot
fixture pool before trial mutations. The normal route fixture remains one slot.
An already running application or its shared database is not a trial target.

The owning launcher must stop/remove its disposable parent cluster afterward.
The integration fixture cleans its child; a failed launcher must not assume
cleanup succeeded without confirming it.

## What is collected

The `ISOLATED_CONCURRENCY_METRICS=` output contains bounded numeric evidence
for both settings: acquisition p95/failures, maximum waiters, queue-age p95,
event-loop maximum, throughput, and synthetic reminder latency. It also records
completion, cancellation, retry, unique-effect and shutdown checks. No actual
notification is sent, and no provider or workbook is used.

The workload includes duplicate enqueue, queued cancellation, a safe pre-effect
retry, and protected effects longer than their lease. A synthetic foreground
read probe shares the disposable pool. This is not a user-load benchmark or an
observation of physical devices or the published deployment.

## Interpretation

Worsened backlog, starvation, latency, waiting, acquisition failures, throughput,
or protected-job semantics reject the candidate. Missing metrics do not become
zero: they leave the result insufficient. Even an improvement is only a
candidate for further isolated study, never production authorization.

Retain the source/test identities and bounded measurements with the owning
audit. Do not copy raw database URLs, credentials, job inputs or network traces
into evidence. Cross-scheduler/outbox ordering, shutdown under arbitrary external
effects, real reminder delivery, and provider capacity require separate
applicable evidence; this narrow trial does not certify them.
