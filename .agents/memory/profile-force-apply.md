---
name: Profile force-apply override
description: Explicit Apply actions may bypass the brand-profile LWW guard via force:true upserts — capability-gated, never for autosaves.
---

# Explicit Apply beats profile LWW

**Rule:** The brand-profiles server pool is LWW stamp-guarded, but a deliberate manager Apply (spec-import commit) may send `force: true` per item: the server overwrites regardless of stored stamp and advances the stored stamp past the previous one so the write also wins future LWW compares.

**Why:** A wrong profile carrying a newer stamp otherwise silently blocks re-imports/heals with no explanation, and heals needed manual stamp bumps to outrank bad rows. The LWW guard exists to stop stale-device republish, not to veto deliberate corrections.

**How to apply:**
- Force is an authoritative-write privilege, so the server MUST capability-gate any request containing a forced item (gated on the same capability as the flow that issues it — spec import uses `use-ai-tools`) and reject with 403 before any write; ordinary non-forced saves stay open to all staff. A client-only restriction is a broken access control.
- Force intent must be sticky (across queued edits and in-request same-key dedupe) until the forced push actually lands, then spent.
- Any such wire flag must go through openapi.yaml + codegen (generated zod strips unknown keys — it would be silently dropped, not 400).
- Never set force on autosaves or background syncs — only explicit, user-confirmed Apply actions.
