---
name: Production evidence revision binding
description: How production reconciliation evidence must bind to the controlled deployed build revision.
---

Production reconciliation evidence must use an explicitly controlled full Git revision from the deployment. The operational report is the authoritative handoff; `unknown`, malformed, missing, or mismatched revisions fail release evidence.

**Why:** A read-only production verifier can prove the heal marker, source report hash, repair boundary, and live row state, but assigning the current repository HEAD as the deployed revision would falsely claim release identity.

**How to apply:** Keep the release runner's checkout revision separate from the deployed production revision. Pass the deployed revision explicitly through capture/import, checkpoint, retained report, promotion, and verification; never replace it with repository HEAD. A current bounded published-deployment handoff may supply that revision, but its expiry and any explicit SHA must be checked before querying production. Treat source-owned pool drift as a real verification failure even when marker, alias, profile, run-history, and stub checks pass.

For test-only CI evidence that intentionally skips production source reconciliation, explicitly set `SOURCE_LIBRARY_RECONCILIATION_ENVIRONMENT=development`.

**Why:** CI's default release environment can cause the report to infer a deployed revision from the checkout even though no deployment or production readiness was established.

**How to apply:** Keep the disposable-test and guarded skip conditions active, set the development environment explicitly, and verify the report lists deployed revision and readiness as not applicable. Production evidence still requires the deployment handoff and its exact deployed revision.

For retained browser and timing reports, pass `RELEASE_REVISION` as the same filtered source revision selected by the release runner. Their fallback to checked-out HEAD can bind evidence to an evidence-only commit instead.

**Why:** Release evidence files are excluded from source revision selection, but browser reporters may otherwise identify the newer evidence-only HEAD.

**How to apply:** Set `RELEASE_REVISION` for standard and full test-only release checks, then verify browser reports and the release report agree on the source revision.

CI artifact handoffs must use the same filtered full revision selected by the release runner rather than assuming checkout HEAD is equivalent.

**Why:** Evidence-only commits are intentionally excluded from release identity; a handoff bound to checkout HEAD could label valid retained evidence stale or misidentify the run.

**How to apply:** Keep the standard and full CI handoff revision selector aligned with `releaseRevisionGitArgs`, and preserve the explicit mode/revision checks.

A GitHub push SHA proves which source commit was pushed, not which commit a production deployment actually published. Keep push evidence separate until a trusted publish event or provider-verified handoff binds that SHA to the deployment identity.

**Why:** Publishing can be a separate action from pushing, so a valid pushed commit alone cannot establish the live deployment's identity.

**How to apply:** Require both the exact deployed SHA and deployment ID from the trusted publish context before collecting or accepting production evidence; re-check current platform interfaces for a supported binding mechanism.

Do not assume the Replit Enterprise Admin API supplies deployment identity. Its published API reference reviewed on 2026-10-02 listed workspaces, members, groups, usage, and projects, but no deployment or publish-event operations; a documentation search summary had overstated this capability.

**Why:** Search summaries can describe deployment metadata that is not present in the authoritative API schema, leading to an unsafe implementation based on a nonexistent endpoint.

**How to apply:** Verify the current published API operations or a documented event contract before treating the Admin API as a trusted deployment source. Keep production evidence blocked until such an authenticated source is actually available.

Bounded release handoffs must treat the explicit mode and full Git revision as part of evidence identity. A newer same-mode, same-revision checkpoint supersedes the retained report only as an incomplete attempt; it never replaces retained evidence. Keep test evidence separate from production-bound proof, and never let the summary itself issue a production GO.

**Why:** Old retained reports and incomplete retries can both look positive when viewed without their revision and generation order, while development results do not establish deployed behavior.

**How to apply:** Require reviewers to select a mode and full revision, display report and checkpoint separately, and show production binding gaps independently from local/CI gate status.