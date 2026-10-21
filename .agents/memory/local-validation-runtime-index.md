---
name: Local validation runtime index
description: Pointers for the release runner, pinned Node, local browser transport and test certificates.
---

- [Runner locks](release-runner-lock-history.md) — local lock history is private, not platform task history.
- [Pinned Node](pinned-node-nix-runner.md) — use the exact installed Node when provisioning fails.
- [Docker healthcheck exec](docker-healthcheck-setns.md) — if healthchecks and `docker exec` both fail with `setns`, preserve CI health semantics and validate on a supported runner.
- [Loopback probes](release-runner-loopback-probes.md) — bypass only local readiness probes, not TLS guards.
- [Browser routing](local-browser-suite-routing.md) — offline installs and scoped loopback exceptions.
- [Test CA subjects](openssl-test-ca-subject-uniqueness.md) — certificate subjects must be unique per fixture.
