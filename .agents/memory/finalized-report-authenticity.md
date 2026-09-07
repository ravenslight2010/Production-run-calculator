---
name: Finalized report authenticity
description: Durable rules for keyed finalized-report proofs, safe key rotation, and unsigned legacy compatibility.
---

New finalized records must use a versioned keyed proof over the canonical payload and immutable audit metadata. Keep signing keys in a dedicated external secret keyring, retain old keys by ID during rotation, and never reuse authentication/session keys as a silent fallback.

**Why:** An unkeyed content hash can be replaced alongside a rewritten payload by anyone with database write access. A missing old key must be distinguishable from a valid proof, and a create response must not certify values that database-side rewriting changed during storage.

**How to apply:** Re-read and verify persisted values before reporting finalization success. Treat partial/unknown proofs, missing retained keys, and mismatched signatures as untrusted; keep pre-proof records readable only with an explicit unsigned-legacy status.

Rotation must be preceded by a target-environment audit that proves the active
keyring is valid, every distinct retained proof key ID is available, and the
bounded scan completed without truncation. A blocked audit must stop rotation.

**Why:** Rotating away an old key can make immutable archived reports
unverifiable, while a truncated or unavailable audit can falsely appear
healthy.

**How to apply:** Run the report-key rotation preflight before changing the
external keyring. Persist only its safe evidence (key IDs, status, scan
completeness, and remediation), never key values.