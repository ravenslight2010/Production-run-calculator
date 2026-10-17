---
name: Local CI PostgreSQL parity
description: Local disposable PostgreSQL lifecycle and role/socket requirements for API and browser verification.
---

When reproducing a GitHub Actions PostgreSQL service locally, initialize the
disposable cluster with the same database superuser expected by the workflow and
place its Unix socket in a writable directory.

**Why:** A default local cluster may inherit the Linux account as its only role
and may target a missing system socket directory. Those harness failures happen
before application startup and can be mistaken for the CI readiness defect under
investigation.

**How to apply:** For an isolated temporary cluster, explicitly select the
workflow's database role during initialization and select a writable socket
directory such as `/tmp`; keep application connections on the workflow-equivalent
TCP host and port.

Standalone integration verification must own a reachable disposable database
lifecycle; an existing connection-string variable does not prove its service is
running.

**Why:** A focused pre-workflow test stalled in database setup when no local
service was listening. An explicitly started private cluster completed verification
without relying on application startup or risking application data.

**How to apply:** Use the repository's disposable harness where applicable, or
an isolated temporary cluster with cleanup on exit. Do not treat a setup timeout
as a failed application assertion or redirect destructive fixtures at app data.
