---
name: Import Gold source-owner authorization
description: Approval evidence and retention constraints that must precede real customer Import Gold cases.
---

Never collect or score customer workbook content for Import Gold until source-owner authorization for evaluation use and retention, plus any required privacy review, are recorded and verified. The record must identify its scope and approval evidence, and its retention terms must be compatible with the lab's actual deletion behavior; the lab does not automatically expire cases.

**Why:** A server enablement flag is only an operator attestation and cannot substitute for a reviewable authorization record or privacy decision.

**How to apply:** Keep the lab disabled while any approval is missing or pending. Preserve synthetic fixtures for implementation checks, and do not store customer workbook content or private approval evidence in the repository.

The project owner stated “Manager and qc manager share all roles” in the Gold
Lab approval workflow. Either role may handle authorization, privacy review,
deletion, and deletion verification; do not impose separate duties on the two
roles. This is an organizational responsibility rule, not authorization to
change application permissions or bypass source-specific handling requirements.

**Why:** The owner clarified shared responsibility after proposed guidance
assigned deletion and verification to separate roles. Organizational authority
and an explicit decision about particular sources and handling requirements
remain separate facts.

**How to apply:** Seek the actual use, retention, and privacy decisions through
the authorized roles; keep the real-source boundary closed while any required
decision or verification is unresolved.

The project owner approved a maximum 30-day retention policy for Gold Lab
evaluation cases and working copies, with earlier deletion on source-owner
request. Either authorized role may delete and verify completion. Avoid exports
unless needed and approved; keep original business records under their existing
policy. Actual backup retention must be documented separately, not represented
as proven 30-day erasure.

**Why:** The approved policy deliberately relies on manual deletion rather than
assuming automatic expiry or deletion of external copies.

**How to apply:** Before real-source work, verify that the private source-specific
approval and actual handling can meet this policy. Policy approval is not proof
of implementation or permission to enable real-source capture.

The owner selected a seven-day reminder window before the 30-day deadline. This
is an in-app due-soon status, not an external notification or automated deletion.

**Why:** The owner approved a visible advance reminder while keeping the
application's deletion process manual.

**How to apply:** Keep the due-soon boundary at seven days, show overdue cases
explicitly, and do not imply push/email delivery or automated erasure.
