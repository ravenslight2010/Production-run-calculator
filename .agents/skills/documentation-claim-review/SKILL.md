---
name: documentation-claim-review
description: "Verify claims in READMEs, release notes, setup guides, help text, and other public-facing documentation against designated repository evidence. Use when asked to fact-check docs, find stale or overstated claims, confirm release notes match implementation, or identify statements that need stronger evidence. Report claim-by-claim findings and evidence gaps; do not silently rewrite unsupported claims."
---

# Documentation Claim Review

Review what documentation says against what the available evidence proves. Keep the review
separate from code quality, security, and release-readiness decisions.

## Compose with related skills

- Apply `evidence-hygiene` to screenshots, logs, reports, traces, and production evidence.
- Use `release-checklist` and `production-go` when the question is whether the app can ship.
- Use `ci-security-review` for workflow security.
- Use `writing-quality-editor` only after the factual review when the user also wants revised
  wording.

## Establish scope

Identify:

- the exact document, section, or supplied text under review;
- the intended audience and publication surface;
- the repository revision or artifact version the claims describe;
- the evidence sources permitted for this review.

Use designated project files and bounded read-only checks when available. Do not substitute
a similarly named file, another revision, development fixtures, or remembered behavior.
Never treat a passing test, screenshot, comment, or type signature as broader proof than it
actually provides.

If the target text is missing, ask for its exact path or contents. If decisive evidence is
unavailable, continue with a bounded review and mark the gap rather than inventing support.

## Split claims before judging

Break compound prose into atomic claims. Classify each as:

- behavior or capability;
- installation/configuration requirement;
- compatibility or platform support;
- performance, scale, or reliability;
- security, privacy, or data handling;
- release/version status;
- process, ownership, or support commitment;
- opinion, aspiration, or clearly labeled example.

Verify objective claims. Do not present opinions or aspirations as factual commitments.

## Evidence rules

Prefer evidence closest to the claimed behavior:

1. revision-bound runtime or release evidence;
2. focused automated tests and generated artifacts;
3. implementation and configuration;
4. manifests, schemas, and stable interfaces;
5. comments, examples, and historical reports.

Check negative and boundary language such as `always`, `never`, `all`, `only`, `secure`,
`production-ready`, `automatic`, and `supports`. These require evidence matching their
breadth.

Do not accept:

- unrelated or stale evidence;
- development results as production proof;
- absence of an error as proof of correctness;
- a single happy path as proof of universal support;
- unsanitized credentials or personal data.

## Finding labels

Use exactly one label per atomic claim:

- **verified** — direct evidence supports the claim at its stated scope;
- **partially verified** — evidence supports only a narrower statement;
- **unsupported** — reviewed evidence does not support the claim;
- **stale-suspected** — evidence indicates the claim described an older state;
- **contradicted** — direct evidence conflicts with the claim;
- **needs-human** — authorization, policy intent, external ownership, or unavailable evidence
  prevents a reliable decision.

State confidence as high, medium, or low and explain what would change the result.

## Output contract

Report:

### Input scope reviewed

- target document and revision;
- evidence inspected;
- evidence not inspected or unavailable;
- environment and date where relevant.

### Claim assessments

For each atomic claim:

1. quote or concise claim identifier;
2. label and confidence;
3. supporting or conflicting evidence;
4. scope limitation;
5. exact evidence needed next, if unresolved.

### Summary

- counts by label;
- highest-impact inaccuracies;
- publication blockers, if any;
- remaining uncertainty.

Do not revise the document during an assessment unless the user also authorizes editing.
When revision is authorized, preserve quotations, numbers, conditions, identifiers, and
legal/policy strength; route wording work through `writing-quality-editor`.
