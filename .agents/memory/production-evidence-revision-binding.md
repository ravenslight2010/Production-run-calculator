---
name: Production evidence revision binding
description: How production reconciliation evidence must bind to the controlled deployed build revision.
---

Production reconciliation evidence must use an explicitly controlled full Git revision from the deployment. The operational report is the authoritative handoff; `unknown`, malformed, missing, or mismatched revisions fail release evidence.

**Why:** A read-only production verifier can prove the heal marker, source report hash, repair boundary, and live row state, but assigning the current repository HEAD as the deployed revision would falsely claim release identity.

**How to apply:** Keep the release runner's checkout revision separate from the deployed production revision. Pass the deployed revision explicitly through capture/import, checkpoint, retained report, promotion, and verification; never replace it with repository HEAD. Treat source-owned pool drift as a real verification failure even when marker, alias, profile, run-history, and stub checks pass.