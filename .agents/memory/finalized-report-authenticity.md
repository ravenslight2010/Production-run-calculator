---
name: Finalized report authenticity
description: Durable rules for keyed finalized-report proofs, safe key rotation, and unsigned legacy compatibility.
---

New finalized records must use a versioned keyed proof over the canonical payload and immutable audit metadata. Keep signing keys in a dedicated external secret keyring, retain old keys by ID during rotation, and never reuse authentication/session keys as a silent fallback.

**Why:** An unkeyed content hash can be replaced alongside a rewritten payload by anyone with database write access. A missing old key must be distinguishable from a valid proof, and a create response must not certify values that database-side rewriting changed during storage.

**How to apply:** Re-read and verify persisted values before reporting finalization success. Treat partial/unknown proofs, missing retained keys, and mismatched signatures as untrusted; keep pre-proof records readable only with an explicit unsigned-legacy status.