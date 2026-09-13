---
name: evidence-hygiene
description: "Safely capture, sanitize, label, store, and review operational evidence such as screenshots, HAR files, browser traces, logs, test reports, exports, and release artifacts. Use whenever evidence may contain credentials, personal data, production records, request payloads, or environment-specific results, especially during release, security, browser, and incident verification."
---

# Evidence Hygiene

Evidence must be useful enough to support a decision without becoming a new source of
credential, personal-data, or production-data exposure.

## Compose with the owning workflow

This skill controls evidence handling; it does not decide what evidence is required.

- Use `release-checklist` to gather release evidence.
- Use `production-go` for the final release decision.
- Use `operational-browser-verification` for manager and operational browser flows.
- Use `security-scan` for supported automated security scans.
- Use `deployment` for published-app logs and production diagnostics.

## Classify before capture

Identify:

- environment: development, isolated test, staging, or production;
- revision or build identity;
- test/run identity and timestamp;
- data class: public, internal, personal, regulated, credential, or production operational;
- artifact type and intended audience.

If an artifact cannot be safely sanitized, record a bounded finding instead of attaching
the raw artifact.

## Sensitive fields

Remove or mask:

- passwords, API keys, tokens, cookies, session IDs, authorization headers, signed URLs,
  connection strings, and one-time codes;
- personal data not required to prove the result;
- raw request/response bodies, recipe contents, imported source rows, and database records
  unless explicitly required and safely minimized;
- internal paths, stack traces, provider payloads, or infrastructure details that add risk
  without helping the decision.

Do not replace a secret with a reversible encoding. Do not paste secret values into chat,
logs, screenshots, filenames, report titles, or metadata.

## Artifact-specific handling

- **Screenshots:** crop to the relevant surface; mask identities, account data, browser
  chrome, URLs with sensitive queries, and unrelated records.
- **HAR/network captures:** remove cookies, authorization headers, tokens, request bodies,
  sensitive query values, and response payloads. Prefer a short sanitized request summary.
- **Logs:** retain correlation IDs, safe identifiers, timing, outcomes, and bounded counts;
  omit payloads and personal data.
- **Browser traces/videos:** use isolated fixtures where possible and review every visible
  frame plus embedded network data before sharing.
- **Reports/exports:** include only the minimum rows and columns needed for the conclusion.
- **Hashes:** hash source artifacts when integrity matters, but do not treat a hash as
  sanitization or proof that the underlying source was safe.

## Provenance and authority

Every retained artifact or report should state:

- capture time and environment;
- revision/build identity, or explicitly `unknown`;
- command, workflow, or user flow that produced it;
- whether data was fixture, development, or production;
- sanitization performed;
- result and unresolved gaps.

Never present development fixtures as production proof. Never infer a revision from live
data when the runtime reports it as unknown. A screenshot proves only the visible state at
capture time; it does not prove persistence, authorization, or cross-device behavior unless
those were separately exercised.

## Storage and retention

- Keep evidence in the designated report/artifact location, not scattered temporary files.
- Do not commit raw credential-bearing captures.
- Preserve required release artifacts long enough for the owning release workflow to
  verify them; remove unnecessary sensitive intermediates after the decision.
- Deletion is destructive: obtain approval before removing user-provided evidence unless
  the user already requested deletion.

## Review checklist

- [ ] The artifact is necessary for the decision.
- [ ] Environment, revision, timestamp, and producing flow are recorded.
- [ ] Secrets, cookies, headers, signed URLs, and personal data are absent or masked.
- [ ] Payloads and records are minimized.
- [ ] Fixture/development evidence is not described as production evidence.
- [ ] Sanitization did not remove the facts needed to verify the claim.
- [ ] Raw sensitive intermediates are not committed or broadly shared.
- [ ] Remaining uncertainty is stated rather than hidden.
