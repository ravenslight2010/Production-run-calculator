---
name: Local CI PostgreSQL parity
description: Environment details required to reproduce PostgreSQL-backed GitHub browser workflows locally.
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
