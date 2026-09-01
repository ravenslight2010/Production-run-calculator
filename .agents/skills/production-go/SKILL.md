---
name: production-go
description: Decide whether this application is production-ready and give a bounded GO/NO-GO release status. Use whenever the user asks if the app is production-ready, ready to publish, safe to ship, ready to go live, or asks for release status—even if they do not use the words GO or NO-GO. Run the applicable release and shipping gates before recommending publish; do not replace the release checklist.
---

# Production GO / NO-GO

Give one authoritative release decision, not an open-ended list of possible
future work. This skill composes with the repository's detailed
`.agents/skills/release-checklist/SKILL.md`; read and follow that checklist for
the commands and surface-specific gates. Also read
`.local/custom_skills/review-before-shipping/SKILL.md` for shipping,
authorization, dependency, privacy, and deployment-fit gates.
Use `release-checklist` for evidence gathering even when the user asks only for
the decision; do not substitute this report for the checklist's required gates.

## 1. Establish the decision contract

Capture:

- the revision or commit being assessed;
- the changed surface and affected artifacts;
- the preview URL/workflows and disposable test database;
- the intended deployment target;
- any evidence already supplied (commands, logs, browser results, screenshots,
  security results, and review links).

If the user asks only for a status, inspect the current diff and environment
before deciding. Do not infer that an old passing run covers newer code.

The decision has five separate dimensions:

1. **App health** — the server and browser-facing workflows start cleanly and
   the changed/core journeys work in a real preview.
2. **Release evidence** — required type, generated-client, unit/integration,
   smoke, accessibility, visual, PWA, or full E2E gates applicable to the
   changed surface have current, attributable evidence.
3. **Security readiness** — shipping review passes: no leaked secrets/PII,
   authorization isolation holds, dependencies have no unresolved
   high/critical findings, and static/privacy findings are resolved or
   explicitly classified as non-blocking by the security review.
4. **Operational readiness** — data-heal, schema, sync/day-state, destructive
   test isolation, rollback, post-merge, and deployment-fit questions have
   explicit answers and owners where needed.
5. **Accepted exceptions** — only a documented, explicitly accepted
   exception may explain an otherwise non-applicable or environment-dependent
   check. It must name the gate, impact, owner, mitigation, expiry/revisit
   date, and approver. It cannot waive a required failed gate, stale generated
   client, unhealthy browser-facing workflow, unresolved high/critical security
   finding, unsafe test isolation, or missing evidence for a required gate.

## 2. Run the bounded verification

1. Read the release checklist and classify the diff. Run every required gate
   and every applicable conditional gate it selects. A missing result is
   **MISSING**, not a pass.
2. Restart the relevant workflows after code/package/toolchain/run-command
   changes. Verify the browser-facing artifact-managed API and web preview,
   not only a local process or a non-browser API port. Capture logs and a
   browser result or screenshot.
3. For client, API-backed, auth, sync, or routing changes, obtain the
   desktop and 390×844 browser smoke evidence. For UI changes, obtain axe
   evidence. Add phone, visual, PWA, physical-device, or full destructive E2E
   evidence when the checklist says the surface requires it.
4. Apply the shipping review. If a fresh security scan is requested or is
   needed to establish current security evidence, use
   `.local/skills/security-scan/SKILL.md` and run all three scanners; one scanner
   error is itself missing evidence. Treat unresolved high/critical findings as
   NO-GO.
5. Check generated-client freshness explicitly whenever API contracts or
   generated artifacts may be involved. Never accept a stale client or a
   hand-edited generated file.
6. Answer each operational warning from the checklist. Identify live-data
   effects of heals, additive schema and migration implications, sync recovery
   evidence, disposable-database proof, and rollback/post-merge ownership.

If a workflow reports `DIDNT_OPEN_A_PORT`, a timeout, or a blank preview, read
`.local/skills/debug-workflow-ports-issues/SKILL.md` before attempting another
restart. A healthy local server does not prove the browser-facing workflow is
healthy.

Stop once the evidence is sufficient for a decision. Do not launch speculative
refactors, invent new release commands, or recursively create “one more task”
work. If blocked, name the exact blocker, the evidence needed, and the owner
or next action, then issue NO-GO.

## 3. Decide

Return **GO** only when all required gates and applicable conditional gates
pass, browser-facing workflows are healthy, security readiness passes, and
operational warnings have explicit answers. Then—and only then—recommend
publish.

Return **NO-GO** for any of:

- failed or missing required evidence;
- a stale generated API client;
- an unhealthy, stale, or unverified browser-facing workflow;
- an unresolved high/critical security or authorization finding;
- a required conditional suite unavailable without a valid accepted exception;
- unsafe destructive test setup;
- an operational warning without an owner and plan.

An accepted exception is recorded in the report but does not turn a failed
required gate into GO. Keep the decision bounded to the assessed revision and
scope; do not promise that completing a future task will automatically change
the result.

## 4. Required report

Always write this report before recommending publish. Keep evidence concise and
specific; never include secrets, tokens, or sensitive payloads.

```text
Release: <commit/revision>
Scope: <one-line summary>
Environment: <preview and disposable test DB; no secrets>

App health: PASS/FAIL — <startup, browser-facing workflow, core journey evidence>
Release evidence: PASS/FAIL — <required/applicable gates and evidence>
Security readiness: PASS/FAIL — <shipping review and scanner evidence>
Operational readiness: PASS/FAIL — <heals, schema, sync, isolation, rollback/deploy>
Accepted exceptions: none / <gate, owner, mitigation, expiry, approver>

Decision: GO / NO-GO
Remaining blockers: <exact blocker, evidence/action, owner> / none
Publish recommendation: <recommend publish only for GO; otherwise stop>
```

For NO-GO, list the smallest concrete blocker set and stop. Do not pad the
report with unrelated improvements or create follow-up tasks unless the user
explicitly asks for task planning.

## Lightweight evaluation plan

Validate future revisions with the prompts in `evals/evals.json`. A correct
skill must:

- trigger for all three release-status phrasings;
- produce the exact report sections and exactly one GO/NO-GO decision;
- refuse GO when required evidence is missing or stale;
- distinguish a valid, documented exception from a waived required gate;
- name blockers and stop instead of proposing an unbounded task chain.
