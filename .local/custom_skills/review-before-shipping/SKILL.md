---
name: review-before-shipping
description: Review security, privacy, dependency, authorization, reversibility, and deployment-fit risks before merging or publishing. Use for shipping-risk review; route repository verification to verify-before-commit, release evidence to release-checklist, and final production GO/NO-GO decisions to production-go.
---

# Review Before Shipping

This skill owns the generic shipping-risk review. It does not duplicate the
repository's verification or release evidence commands:

- Before a commit, push, pull request, or green-build claim, use
  `.agents/skills/verify-before-commit/SKILL.md`.
- Before publishing, use `.agents/skills/release-checklist/SKILL.md` to select,
  run, and record repository-specific gates.
- When the user asks whether the application is production-ready or requests a
  final GO/NO-GO decision, use `.agents/skills/production-go/SKILL.md`. That
  skill composes this review with the release checklist and owns the decision.

## Shipping-risk review

Inspect the changed surface and report each applicable item as PASS, FAIL, or
N/A with concise evidence:

- **Secrets:** no credentials are hardcoded, logged, committed, or sent to the
  browser; runtime secrets use the supported environment/secret mechanism.
- **Authorization:** server-side resource and capability boundaries reject
  anonymous and cross-scope access; do not rely on hidden UI controls.
- **Sensitive data:** logs and errors omit secrets, personal data, and raw
  operational payloads; collect only data the feature needs.
- **Dependencies:** packages are genuine, maintained, license-compatible, and
  free of unresolved high/critical findings under the repository's security
  policy.
- **Revertibility:** destructive schema/data operations and breaking API
  changes have explicit safeguards, rollback ownership, and recovery evidence;
  prefer additive changes.
- **Deployment fit:** the selected deployment model matches the workload and
  its state, connection, worker, and monitoring needs. Verify current Replit
  behavior from official documentation rather than relying on stale examples.

Stop on any failed security or authorization item. Do not turn missing release
evidence into a PASS, and do not issue a production decision from this skill.

## Output contract

```text
Shipping risk review
- Secrets: PASS/FAIL/N/A — <evidence>
- Authorization: PASS/FAIL/N/A — <evidence>
- Sensitive data: PASS/FAIL/N/A — <evidence>
- Dependencies: PASS/FAIL/N/A — <evidence>
- Revertibility: PASS/FAIL/N/A — <evidence>
- Deployment fit: PASS/FAIL/N/A — <evidence>

Blocking risks: <list or none>
Next owner: verify-before-commit / release-checklist / production-go
```
