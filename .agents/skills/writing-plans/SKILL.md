---
name: writing-plans
description: Use after the user approves a design or specification and before implementation when the work needs a multi-step plan aligned with this repository's task workflow.
---

# Writing Plans

Turn an approved design into a bounded, testable plan. Record decisions that an implementer cannot infer from the design, while avoiding line-by-line implementation scripts.

## Workflow

1. Confirm the approved scope and its constraints. Do not reopen decisions the user has already approved unless the codebase reveals a concrete conflict.
2. In Plan mode, inspect existing project tasks before proposing work. Use the `project-tasks` skill for the task record and plan-file rules.
3. Inspect the relevant parts of the codebase. List only files that exist and are pertinent to the requested work.
4. Map the important components, data flow, dependencies, and ownership boundaries. Split work only when the user requested it or when the request contains clearly independent goals.
5. Define observable outcomes, scope exclusions, and the smallest useful implementation steps. Include relevant tests and specialist safety checks in the plan.
6. Review the plan against every approved requirement. Check for omissions, contradictions, vague placeholders, unverified file references, and unnecessary scope.
7. Hand off according to the active mode:
   - **Plan mode:** Follow `project-tasks`. By default, create one task per request. Save its plan under `.local/tasks/`, create or update the visible task record, and propose it promptly. Declare dependencies only where they are real; do not depend on Drafts.
   - **Build mode:** Do not create project-task records. If the user asked for a plan, present the bounded steps in the conversation; otherwise continue with the requested implementation.

## Plan format in Plan mode

Follow the `project-tasks` skill as the source of truth. A task plan in `.local/tasks/` has:

- A short descriptive title as its first line.
- `## What & Why` — the requested change and its purpose.
- `## Done looks like` — visible or otherwise observable acceptance outcomes.
- `## Out of scope` — exclusions that prevent assumptions from expanding the work.
- `## Steps` — short, outcome-focused implementation boundaries, not separate project tasks.
- `## Relevant files` — only verified paths, formatted exactly as required by `project-tasks`.

Keep steps concise and focused on what must change. Put detailed paths in `## Relevant files`, not in step bullets. Do not turn one user request into multiple tasks merely to mirror internal implementation steps.

## Repository and mode boundaries

- In Plan mode, do not edit application code, install packages, or commit changes. Persist only the task plan and task record through the approved planning workflow.
- Do not use the upstream `docs/superpowers/plans/` or `docs/superpowers/specs/` locations.
- Do not require unavailable Superpowers subskills, isolated worktrees, model-specific reviewers, or a commit as a planning step.
- In Build mode, a plan does not replace the user's request to implement. Do not switch to project-task management unless the user asks to plan or track the work.
- Preserve the approved scope and applicable repository-specific safety, testing, and verification instructions.

