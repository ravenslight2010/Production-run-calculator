---
name: Docker healthcheck exec limitation
description: Diagnose local Docker healthchecks that cannot start processes inside a running container.
---

When a local Docker healthcheck and a direct `docker exec` both fail with `OCI runtime exec ... setns`, treat this as a local container-runtime limitation rather than proof that the service is unhealthy. Do not weaken the committed CI check to bypass a real Compose health dependency.

**Why:** In this workspace, disposable Postgres reached “ready to accept connections,” while healthcheck and direct exec attempts failed with the same `setns` error. Compose cleanup still removed the containers, volumes, and network. This does not establish that a hosted Docker runner has the same limitation.

**How to apply:** Inspect `.State.Health.Log` and try one direct `docker exec` against the disposable container. If both show the `setns` failure, stop changing application health semantics and use a Docker runner that supports container exec for the full runtime verification.
