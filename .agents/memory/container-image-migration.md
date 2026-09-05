---
name: Container image migration split
description: Prebuilt Render image services run pre-deploy commands inside the pulled image, so slim runtimes need migration support or a separate service.
---

Render pre-deploy commands execute inside the same prebuilt image that serves
traffic. A separate full-builder migration image cannot be invoked by that
command. Keep a full `api-migrate` target for Compose and manual operations,
but include only the narrowly scoped migration payload needed by the slim
runtime when Render must migrate automatically.

**Why:** The API image was reduced to a bundled runtime, but Render's existing
single-service deployment still needed schema pushes before a fresh database
could serve requests. Nested Docker runners may reject every exec-based probe,
and PostgreSQL dump guards contain per-run random tokens even when the schema is
unchanged.

**How to apply:** When changing the API image stages, verify the Render
pre-deploy command against disposable Postgres and keep the long-lived API
service pointed at the slim runtime target, never the full migration target.
For portable rehearsals, probe with one-shot sibling containers rather than
`docker exec` or container health commands, and normalize only dump wrapper
tokens before comparing schema fingerprints.