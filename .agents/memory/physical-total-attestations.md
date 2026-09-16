---
name: Physical-total attestations
description: Durable evidence rules for final physical production totals that can differ from automatic progress.
---

Automatic progress and a manager-confirmed physical final total are different facts. Preserve them as separate append-only evidence streams. A manager correction appends a successor that references the current confirmation head; it never rewrites an earlier observation or attestation.

**Why:** Automatic tracking may stop before physical production ends. Planned production and the latest automatic claim therefore cannot prove the final physical total, while overwriting either stream would remove the audit trail needed for later reconciliation.

**How to apply:** For operational counters that may finish outside automatic tracking, commit accepted automatic evidence atomically with its source operation, require immutable completion before accepting a final attestation, fence duplicate/concurrent heads in the database, and reconcile by preferring the latest valid manager confirmation while retaining the automatic observation.