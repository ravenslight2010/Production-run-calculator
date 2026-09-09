---
name: Policy evidence anchors
description: Stable wording requirements for repository policy documents that are validated mechanically.
---

Policy documents are part of a mechanically checked contract, not prose-only guidance. When clarifying a rule, preserve the existing evidence-anchor phrases or update the checker and its regression coverage in the same objective.

**Why:** The operational policy check uses regular expressions for safety-critical concepts such as failure-status vocabulary and de-duplicated repair planning. Semantically equivalent rewrites can fail validation if they remove or split the expected anchors.

**How to apply:** Before completing changes to `replit.md` or operational skills, run the focused evidence checker and keep required anchor wording intact while adding the new qualification around it.