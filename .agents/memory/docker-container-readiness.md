---
name: Docker container readiness in Replit
description: Environment-specific limits around Docker exec, healthchecks, and build networking.
---

Do not assume `docker exec`, Docker `HEALTHCHECK`, or bridge-network traffic works in this Replit environment. The runtime may reject exec operations with an OCI `setns` error, and same-network containers may receive addresses but still be unable to connect. Prefer dynamic host-network ports with host-side TCP/HTTP probes.

**Why:** Manual execs and container healthchecks failed before their commands started. After a workspace restart, a protocol-aware probe container also could not reach a healthy Postgres peer on the same bridge. Host-network containers and host-side probes remained reliable. Docker's default build network separately produced registry DNS failures while host-network builds succeeded.

**How to apply:** For local container smoke tests, use dynamically allocated host ports and observe services externally instead of entering containers or depending on bridge networking. Keep host build networking configurable and use it when the default build network cannot resolve registries.