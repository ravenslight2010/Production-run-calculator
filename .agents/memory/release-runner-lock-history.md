---
name: Release runner lock history
description: Privacy and retention boundaries for local validation lock-wait diagnostics.
---

Keep local validation lock history in the existing private temporary lock directory, keyed by workspace, with a small fixed retention limit and only timing, outcome, and owner identity fields. Never persist command arguments, environment values, credentials, or test output; this local evidence is not a record of Replit-managed task locks.

**Why:** The history helps identify recurring local workspace contention after transient workflow output expires, while a private temporary location avoids repository artifacts and the retained fields remain sufficient for recurrence analysis.

**How to apply:** If extending lock-wait diagnostics, preserve atomic bounded writes, restrictive file permissions, and the distinction between local filesystem locks and platform-managed task waits.
