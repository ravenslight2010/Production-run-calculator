---
name: Rate limiter shared store
description: Why the cost-cap rate limiter is store-pluggable and the non-obvious constraints around its Postgres backing
---

# Rate limiter shared store

The cost-cap rate limiter delegates counting to a pluggable store: default
in-process Map (single instance), or a Postgres-backed store selected only when
`NODE_ENV === "production"` so the cap holds across horizontally-scaled instances.

**Window must be anchored on the app clock, not the DB clock.** The middleware
passes `now` into the store and the Postgres upsert's reset logic compares against
that JS `now`. **Why:** this keeps Postgres behavior byte-identical to the memory
store's anchored window AND keeps it deterministic under fake/test-driven timers.
Do not switch the increment logic to SQL `now()` — it desyncs from the emitted
headers and breaks determinism. (`now()` is fine for the opportunistic sweep only.)

**Fail-open on store error is intentional.** If the store throws, the limiter
logs and allows the request rather than blocking all traffic. **Why:** a DB outage
already breaks the rest of the app, so failing closed here adds no protection and
removes availability. Keep this posture unless cost-protection-during-outage
becomes a hard requirement.

**Schema push gotcha:** the isolated task DB lags the Drizzle schema, so
`db push-force` against it can hit drizzle's interactive `promptColumnsConflicts`
TTY prompt (unrelated drift, not the new table). Production/merge DBs are in sync
so the post-merge push adds the new table cleanly; integration tests push into a
fresh disposable DB and never hit the prompt.

**Integration-test teardown:** dropping the throwaway DB `WITH (FORCE)` can
terminate a connection still closing just after `pool.end()` resolved, surfacing
as an unhandled pool `error` event (intermittent, only under the full parallel
suite). Attach a no-op `pool.on("error", ...)` listener after binding the pool.

**Same weakness elsewhere:** the photo-intake limiter (inventory route) still uses
the default in-memory store — apply the shared store there too if its cap must hold
under scale.
