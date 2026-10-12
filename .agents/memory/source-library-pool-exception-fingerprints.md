---
name: Source-library pool-exception fingerprints
description: Preserve old owner-approved exception evidence and require field-value fingerprints for any later active exception.
---

Keep the 2026-10-08 v1 owner-approved pool-exception manifest and review record byte-for-byte immutable. Treat v1 as historical evidence only; it cannot authorize current recipe-field differences.

**Why:** The manifest pins hashes of the owner review, diagnostics, and production capture. Editing any of those bytes changes what the owner approved, and the old descriptor records field names but not the approved values.

**How to apply:** A later active exception needs a new manifest version with a one-way fingerprint for every approved field, built from a fresh published-production diagnostic and capture. Bind the review to those exact evidence paths and hashes, verify matching revision/time and descriptor fingerprints, and pin the new manifest digest in both the verifier and release gate. Do not fabricate fingerprints or owner approval from historical data.

Keep the reviewed pre-approval failed capture unchanged. Owner approval creates a new exception policy, not a replacement for current runtime evidence.

**Why:** Rewriting a failed capture's approval counts would claim that the published runtime applied a policy it had not loaded.

**How to apply:** Publish the pinned exception policy, then obtain a new runtime capture for import. Retain the original failed capture as the immutable reviewed baseline. Preparing this policy is not a production GO or permission to repair recipes.
