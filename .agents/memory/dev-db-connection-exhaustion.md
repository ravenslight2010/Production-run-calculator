---
name: Dev DB connection exhaustion
description: "helium" dev Postgres can hit "sorry, too many clients already" for a long time after killed test/validation runs; how to diagnose and what actually helps
---

- Symptom: every connection (psql, drizzle push, API server boot seeds/heals) fails with FATAL `sorry, too many clients already`; post-merge setup fails at `db push-force`.
- Diagnose locally first: count this container's sockets to :5432 via `/proc/net/tcp` inode→pid mapping. If the count is tiny (1-2), the exhaustion is EXTERNAL — orphaned server-side backends from SIGKILLed validation/test/drizzle runs that linger until TCP keepalive (can be hours). Killing local processes and restarting workflows won't help, and you can't `pg_terminate_backend` because you can't connect at all.
- **Why:** dead clients killed without FIN leave Postgres backends alive; the dev sidecar has a small max_connections.
- **How to apply:** don't burn time retry-looping past ~10 min. Mitigations that stick: post-merge script retries `push-force` a few times with sleeps (transient blips recover); ask the user to reboot the workspace — restarting the repl restarts the Postgres sidecar and clears orphaned backends. After recovery restart BOTH API workflows so boot seeds/data-heals rerun (they fail silently at boot when the DB is full).
- `checkDatabase()` reports "not provisioned" here even though DATABASE_URL (helium) works — do NOT call createDatabase, it could repoint DATABASE_URL.
