---
name: Repair definition fingerprints
description: Release rule for detecting silent edits to historical automatic repairs.
---

Released automatic repairs are fingerprinted from immutable definition metadata and explicit source-owned data contracts. Runtime callbacks are never serialized or hashed.

**Why:** Function serialization is unstable and can accidentally couple release checks to build output, while reviewed predicates, ownership, safety metadata, and checked-in datasets need an explicit version or manifest decision when they change.

**How to apply:** Give new source-backed repairs an immutable data contract and include it in the released-definition fingerprint projection. Keep repairs with an existing independent payload digest, such as the source-library plan, under that digest rather than duplicating the payload in this fingerprint.