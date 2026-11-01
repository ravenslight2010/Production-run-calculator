---
name: Docker browser smoke runtime
description: Environment-specific Docker build and readiness workarounds observed in isolated Replit workspace tests.
---

In this Replit container, Docker bridge networking failed to resolve registry hostnames even when host DNS worked, and container-exec PostgreSQL health checks failed at the OCI `setns` boundary while PostgreSQL itself was ready.

**Why:** These failures came from the local Docker/runtime boundary rather than application readiness, and otherwise produced false build or container failures.

**How to apply:** Keep workarounds confined to the disposable test Compose configuration: use host networking only for image builds when registry resolution requires it, and check the test database from the host. Still run real migrations and require HTTPS API readiness before browser tests. Keep app runtime networking isolated, never change production Compose for a test-environment workaround, and report unavailable pieces as blocked.


GitHub CI must not inherit the Replit-local host-build DNS workaround. The main-only
Docker/Caddy job failed with Bake's network.host entitlement refusal at main
ff0672e. Default to isolated build networking; reject host opt-in in CI. Only an
explicit local DOCKER_CADDY_BUILD_NETWORK=host may select the documented constrained
Replit workaround. Never grant Bake host-network entitlements to make this green.
