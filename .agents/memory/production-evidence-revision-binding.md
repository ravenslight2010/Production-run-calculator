---
name: Production evidence revision binding
description: How production reconciliation evidence must bind to the controlled deployed build revision.
---

Production reconciliation evidence must use the controlled deployed source identity from the operational handoff; never substitute the release checkout's `HEAD` or a GitHub push SHA. Depending on the report contract, that identity may be a full Git revision or the published `source-sha256:<fingerprint>` value. Missing, malformed, or mismatched identity fails release evidence.

**Why:** A read-only production verifier can prove the heal marker, source report hash, repair boundary, and live row state, but assigning the current repository HEAD as the deployed revision would falsely claim release identity.

**How to apply:** Keep the release runner's checkout revision separate from deployed production identity. Pass the identity required by the evidence contract explicitly through capture/import, checkpoint, retained report, promotion, and verification; never replace it with repository HEAD. A current bounded published-deployment handoff may supply that identity, but its expiry and any explicit Git SHA must be checked before querying production. Treat source-owned pool drift as a real verification failure even when marker, alias, profile, run-history, and stub checks pass.

For published-build matching, compare the production source policy and complete source fingerprint; do not require the prepared and live application build IDs to be equal. Preserve the live build ID as deployment metadata in the resulting handoff.

**Why:** Replit can assign a different application build ID while serving the exact prepared source. Treating that generated identifier as source identity blocks valid evidence despite a matching source fingerprint.

**How to apply:** Validate build mode, readiness, timestamps, source policy, and the full source fingerprint. Bind the receipt to the independent prepared record, record the actual live build ID, and keep the deployed revision expressed as `source-sha256:<fingerprint>`.

Preserve the independently prepared expectation for a published build while refreshing its evidence. Do not regenerate a publish candidate merely because local verification tooling was corrected.

**Why:** Regeneration targets the next source tree and overwrites the expectation for the existing deployment, creating an unnecessary republish loop. A corrected local verifier can still validate the already-prepared published source; that capture does not certify later workspace edits.

**How to apply:** Capture against the preserved expectation and report the actual deployed source identity. Prepare a new candidate only when publishing a new source tree, and keep that candidate's release assessment separate.

For test-only CI evidence that intentionally skips production source reconciliation, explicitly set `SOURCE_LIBRARY_RECONCILIATION_ENVIRONMENT=development`.

**Why:** CI's default release environment can cause the report to infer a deployed revision from the checkout even though no deployment or production readiness was established.

**How to apply:** Keep the disposable-test and guarded skip conditions active, set the development environment explicitly, and verify the report lists deployed revision and readiness as not applicable. Production evidence still requires the deployment handoff and its exact deployed revision.

For retained browser and timing reports, pass `RELEASE_REVISION` as the same filtered source revision selected by the release runner. Their fallback to checked-out HEAD can bind evidence to an evidence-only commit instead.

**Why:** Release evidence files are excluded from source revision selection, but browser reporters may otherwise identify the newer evidence-only HEAD.

**How to apply:** Set `RELEASE_REVISION` for standard and full test-only release checks, then verify browser reports and the release report agree on the source revision.

CI artifact handoffs must use the same filtered full revision selected by the release runner rather than assuming checkout HEAD is equivalent.

**Why:** Evidence-only commits are intentionally excluded from release identity; a handoff bound to checkout HEAD could label valid retained evidence stale or misidentify the run.

**How to apply:** Keep the standard and full CI handoff revision selector aligned with `releaseRevisionGitArgs`, and preserve the explicit mode/revision checks.

Release-runner integration fixtures must bind checkpoint and preflight evidence
to the assessed release identity, not Git HEAD. When production reconciliation
is skipped for a disposable test, the checkpoint's source-library revision is
the same assessed revision.

**Why:** Release assessment identities include verification inputs and can
differ from Git HEAD; fixtures tied to HEAD are rejected as stale before their
intended resume assertions run.

**How to apply:** Build test-only release evidence from the release identity
captured for that checkout, and keep the fixture's source-library environment
consistent with whether production reconciliation actually ran.

A GitHub push SHA proves which source commit was pushed, not which source a production deployment serves. Replit's `getDeploymentInfo()` establishes deployment status, successful build, deployment type, and the official primary URL, but it does not return a provider deployment UUID or source revision. The current publish handoff is application-owned: compare the published `/api/build-info` app build ID and source fingerprint to an independently prepared publish-source record. The app's identity alone is not provider-verified proof; a mismatch blocks capture.

**Why:** Publishing is separate from source preparation, and a healthy public URL or app-reported build identity alone cannot establish that the active build matches the independently prepared source.

**How to apply:** Start with successful current `getDeploymentInfo()` metadata and its exact `primaryUrl`. Accept the generated application build ID and `source-sha256` handoff only after the live build matches the independent expected-source record; never substitute repository HEAD, a Git push SHA, a prior report, or a mismatch response.

Do not assume the Replit Enterprise Admin API supplies deployment identity. Its published API reference reviewed on 2026-10-02 listed workspaces, members, groups, usage, and projects, but no deployment or publish-event operations; a documentation search summary had overstated this capability.

**Why:** Search summaries can describe deployment metadata that is not present in the authoritative API schema, leading to an unsafe implementation based on a nonexistent endpoint.

**How to apply:** Verify the current published API operations or a documented event contract before treating the Admin API as a trusted deployment source. Keep production evidence blocked until such an authenticated source is actually available.

Bounded release handoffs must treat the explicit mode and full Git revision as part of evidence identity. A newer same-mode, same-revision checkpoint supersedes the retained report only as an incomplete attempt; it never replaces retained evidence. Keep test evidence separate from production-bound proof, and never let the summary itself issue a production GO.

**Why:** Old retained reports and incomplete retries can both look positive when viewed without their revision and generation order, while development results do not establish deployed behavior.

**How to apply:** Require reviewers to select a mode and full revision, display report and checkpoint separately, and show production binding gaps independently from local/CI gate status.