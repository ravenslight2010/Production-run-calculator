---
name: task-execution-rules
description: Apply this project's execution contract when writing or executing any Draft, accepted task, or follow-up. Keep evidence gathering, safe error repairs, and verification with the owning task; select applicable safeguards without imposing release checks on ordinary work.
---

# Task execution rules

Use with Replit's project-task and follow-up workflows, not as a replacement for their APIs or mode restrictions. Read `AGENTS.md` and the task rules in `replit.md`. Keep platform-managed skills unchanged.

## Authoring every task

Every Draft, accepted task, and follow-up description must carry the two sections below, filled with task-specific evidence paths, decisions, safeguards, and checks—not merely a link to this skill. Include the normal What & Why, Done looks like, Out of scope, Steps, and verified Relevant files sections.

### Agent-owned execution content

Use a `## Agent-owned execution` heading and include:

- Objective, owner, affected surfaces, task-specific evidence/access paths, and user-controlled decisions or permissions (`None expected` when none are known).
- Before narrowing or splitting a broad objective, inventory material input types, formats/locales, layouts, platforms, lifecycle states, and failure paths; put relevant variants in its acceptance and test matrix.
- Variants of the same user outcome belong in the owning task, not separate follow-ups. Different tests, false-positive risks, or implementation steps alone do not justify a split. Cover known/common cases within approved access; document genuine exclusions without claiming exhaustive coverage. A separate task still needs an independent user outcome, explicit user deferral, or distinct authorization/safety boundary—not merely a newly written out-of-scope clause.
- Before asking the user, inspect the task record, relevant project evidence, configured workflows, and authorized Replit/deployment/service access. Ask only for a product decision, approval, or specific access permission the user controls. Never ask for secrets in chat or evidence the agent/app can retrieve. Investigate an approved agent-side route before declaring an exact missing capability.
- Keep investigation, implementation, integration, persistence effects, repairs, regression coverage, and final verification in the owning task.
- Record every concrete error in the owning task's failure ledger and fix it there when safe and authorized, even if it is outside the original scope. Never silently ignore or defer it. If a safe fix requires a user decision/access grant, destructive or irreversible action, or cannot responsibly be completed in this task, preserve its evidence, exact risk/blocker, accountable owner, and next action.
- If an active task already owns the same repair, prevent conflicting edits; keep the error recorded and resolve it through existing work. Do not create duplicate or recursive follow-ups for errors, fixture repairs, cleanup, integration, tests, or validation.
- A separate task needs separate acceptance criteria and a genuinely independent outcome, explicit deferral, or separate safety/approval need. State parent, evidence, priority/rationale, overlap result, and why it cannot safely remain here. High/medium-priority independent outcomes are eligible; low-priority outcomes need a concrete benefit and bounded scope. Optional work is not categorically excluded; physical-device-only work is excluded.
- Use dependencies only for genuine technical or user-outcome prerequisites. Unrelated active tasks do not block execution; acceptance time, task number, and creation time do not establish priority or dependencies. Do not change another task's scope, status, acceptance, assignment, or lifecycle without the user's request.

### Applicable safeguards and verification content

Use a `## Applicable safeguards and verification` heading and include:

- Name applicable repository and specialist safety rules, concrete checks, and the task-specific validation matrix. Preserve approvals for schema/data heals, auth/security/sync, production/destructive operations, integrations/secrets, and irreversible data changes.
- Select the smallest effective verification for the changed surface. Run focused domain checks with the owning task. Keep shared completion checks fast; full release evidence and standard/full suites apply to release work, not ordinary tasks.
- For web-facing work, include desktop, phone, tablet portrait/landscape, Chromium/Chrome, and WebKit/Safari applicability. Distinguish browser emulation from physical Android Chrome and iOS Safari/PWA evidence. Mark exceptions `not applicable`, `blocked`, or `not run` with reasons; this web-only product has no native-mobile requirement.
- For release work, establish the release-scope/gate matrix, continue independent valid checks, repair safely actionable findings in the release objective, preserve unresolved evidence, and issue one evidence-backed GO/NO-GO. Never weaken a gate or relabel missing evidence as passed.
- Completion review retains the full failure ledger. Report `PASS`, `FAIL`, `BLOCKED`, `NOT REACHED`, or `MISSING` accurately; unresolved results require evidence, reason, owner, and next action. Never call unresolved required work complete.
- For long-running work, update the owning task with objective, completed work/status, blockers with evidence and owner, next milestone/prerequisite, and accountable owner. Use plain user-facing status language and task ref/title.

## Limits

These instructions and the repository checker protect authoring guidance. They do not intercept task creation or enforce Replit's runtime scheduling. Already-running task copies do not automatically receive changes made after launch. Do not claim otherwise.
