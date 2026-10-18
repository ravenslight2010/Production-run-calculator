---
name: Disposable PostgreSQL socket paths
description: Starting temporary local PostgreSQL clusters in this Replit environment.
---

Set `unix_socket_directories` to a writable per-cluster temporary directory when starting a local PostgreSQL cluster. The default `/run/postgresql` directory may be absent; PostgreSQL can bind its loopback TCP port and then immediately exit because it cannot create its Unix-socket lock file.

**Why:** The failure looks like a server-start problem even though TCP binding succeeded, and a generic `pg_ctl` retry does not address the missing socket path.

**How to apply:** For disposable local database verification, create an owned temporary data and socket directory, set `unix_socket_directories` to it at startup, and remove both during cleanup. Do not alter a shared service's socket configuration.
