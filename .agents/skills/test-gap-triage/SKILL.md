---
name: test-gap-triage
description: Turn a bug report, feature request, or “where should this test go?” question into a bounded regression strategy. Use before proposing new coverage or a test task; classify the source-of-truth layer, check existing tasks, and route to the smallest effective test and specialist safety skills.
---

# Test-Gap Triage

Use this skill when someone reports a regression, asks for more coverage, asks where a test belongs, or wants a bug/feature converted into a regression plan.

This is a **diagnosis and planning skill**, not a test runner. Do not run tests, implement the fix, or create/manage project tasks unless the user explicitly asks for that next step.

## Goals and boundaries

The triage result must:

- identify the first layer where the behavior can be wrong;
- avoid duplicating an existing task or specialist checklist;
- recommend the smallest test that would catch the regression, with a reason;
- name the relevant files and risks without inventing paths;
- produce a bounded plan (normally one regression test and, only when justified, one prerequisite or follow-up);
- ask for missing information only when it changes the test layer or safety decision.

Do not replace specialist skills. Route to them and let their detailed invariants/checklists govern implementation and validation:

- `wrong-number-triage` for a specific incorrect displayed value;
- `state-accuracy-check` for timers, counters, auto-track, pause/resume, or live form resets;
- `sync-invariant-check` for sync, SSE, LWW stamps, reset epochs, wake recovery, or day-state;
- `spec-import-guard` and `import-bug-investigation` for spec/premix/cheese/shipping imports and aliases;
- `data-heal-playbook` when incorrect values may already be persisted;
- `schema-change-checklist` when the proposed fix adds a persisted field/column;
- `testing` for real-browser flows; `release-checklist` for pre-publish confidence.

If a requested category has no dedicated local skill (for example accessibility, responsive layout, visual baselines, or operational alerts), use the closest testing/release guidance and explicitly label the recommendation as a prerequisite or manual check rather than pretending a specialist checklist exists.

## Triage workflow

### 1. Clarify the report

Ask only the questions needed to resolve ambiguity. Capture:

1. **Observed behavior:** what happened, where, and with what concrete value or action?
2. **Expected behavior:** what should happen, including role, device, date, run state, and persistence expectations?
3. **Reproduction boundary:** first load, navigation, reload, pause/resume, second device, import, API call, or publish?
4. **Data status:** is the wrong result calculated now, or could bad data already be stored?
5. **Regression surface:** web, real mobile, both, API only, or operational/release pipeline?

Do not ask for all five if the report already answers them. A single concrete value, endpoint, or screen is more useful than a general request for “more tests.”

### 2. Check for duplicates before designing work

Search the existing project tasks using the report’s user-facing nouns and failure mode. Inspect relevant active/ready tasks, not just titles. Include matching proposed tasks as duplicates: do not create a second task merely because the existing one is not started.

Also search the repository for existing test names, assertions, routes, and specialist skills. A nearby test that already covers the same invariant may need a missing scenario added rather than a new suite.

Report one of:

- **Existing coverage:** extend a named test or add the missing case there.
- **Existing task:** reference the task by ref and title; do not propose duplicate work.
- **No duplicate found:** recommend one bounded regression task, subject to user approval.

Never silently create, accept, update, or close a project task during triage.

### 3. Locate the source of truth

Trace the behavior from the user-visible symptom inward and stop at the first layer that can independently produce the wrong result:

1. **UI/rendering:** component state, form wiring, route, responsive CSS, accessibility semantics, or visual layout.
2. **Live state/timers:** clock context, derived calculation, auto-track, pause/resume, or cross-run form synchronization.
3. **Sync/persistence:** day-state, server merge, stamps, tombstones, reset boundary, or wake reconciliation.
4. **Import/data heal:** parser/sanitizer/linking, saved parse, profile/pool data, aliases, or already-poisoned rows.
5. **API/contract:** route behavior, validation, serialization, OpenAPI/generated declarations, or server/client mismatch.
6. **Auth/security:** session, role/capability, authorization boundary, token expiry, rate limiting, or sensitive-data exposure.
7. **Operational/release:** workflow/startup, alert delivery, deployment configuration, migrations, dependency/model changes, or release checks.

Use the source-of-truth layer to choose the test. Do not add a browser test for a pure formula, and do not stop at a unit test when the reported failure is caused by navigation, persistence, auth, or a real device.

### 4. Classify and route

A report may have a primary and secondary class. Choose the smallest set of specialist skills that covers the risk:

| Class | Signals | Route first | Typical test |
|---|---|---|---|
| UI/rendering | wrong control, missing warning, broken navigation, layout, semantics | `testing`; accessibility or responsive guidance when available | browser, visual, or accessibility smoke |
| Live state/timers | wrong countdown/counter, pause, reload, run switch, stale delta | `wrong-number-triage` then `state-accuracy-check` | unit or rendered/browser timing scenario |
| Sync | resurrection, peer overwrite, stale echo, wake, reset, cross-device | `sync-invariant-check` | API integration plus browser or real-mobile handoff |
| Imports/data heals | missing/duplicated/mislinked imported data, wrong saved values | `import-bug-investigation`, `spec-import-guard`; add `data-heal-playbook` if stored data is poisoned | deterministic import/corpus, integration, and heal verification |
| API/contract | status/body mismatch, validation drift, generated types stale | API tests, contract/type checks, `schema-change-checklist` for persisted fields | integration or contract test |
| Auth/security | unauthorized access, role bypass, expiry, enumeration, rate limits | auth/security guidance and existing auth test patterns | API integration, browser auth, or manual threat check |
| Operational/release | workflow, alert, deployment, migration, model, or publish-only failure | `release-checklist` and relevant workflow/deployment guidance | manual operational verification or release check |

### 5. Select the smallest effective verification

Recommend one primary test type and explain why:

- **Unit:** pure calculation, sanitizer, reducer, matcher, or decision logic with no I/O.
- **Integration:** API, database, sync merge, auth boundary, import persistence, or contract crossing a process boundary.
- **Browser:** user-visible navigation, form, dialog, reload, auth, or a web behavior requiring JavaScript/layout.
- **Real-mobile:** native/mobile runtime behavior, device lifecycle, mobile-only permissions, or parity not faithfully exercised by browser emulation.
- **Visual:** pixel/layout change where geometry, hierarchy, or responsive presentation is the acceptance criterion; pair with behavior coverage if interaction matters.
- **Accessibility:** keyboard/focus, labels, roles, contrast, announcements, or screen-reader-relevant behavior.
- **Manual verification:** operational alert delivery, deployment/workflow behavior, external notification, or a cost/risk boundary that automation cannot safely reproduce. State the exact steps and evidence to collect.

Use a second layer only for a demonstrated boundary: for example, a sync bug normally gets an API invariant test plus one client adoption scenario, while a pure math bug normally needs only unit coverage. “Add all test types” is not a triage result.

### 6. Produce a bounded plan

Use this output format:

```markdown
## Diagnosis
- Primary class:
- First source-of-truth layer:
- Why this is the likely failure boundary:

## Duplicate check
- Existing coverage:
- Existing task:
- Result: extend / reference / no duplicate found

## Recommended regression
- Test type:
- Scenario:
- Why this is the smallest effective test:
- Expected assertion/evidence:

## Specialist routing
- Skills to read and why:
- Specialist checks that remain authoritative:

## Relevant files
- Only verified paths, tests, routes, or package scripts.

## Risks and prerequisites
- Persisted-data or migration risk:
- Web/mobile or role-specific path:
- Missing user input or prerequisite:
- Bounded next step (one task at most, pending approval):
```

If the report is not actionable, stop after the diagnosis and ask one focused question. If a data heal, schema migration, external service, or real-device environment is required, make that prerequisite explicit instead of hiding it inside a test title.

## Realistic triage examples

### Wrong number on screen

**Report:** “The run says 5.7 dough batches, but it should say 8.25.”

Classify as live state/calculation. Route through `wrong-number-triage`; compare live form/day-state, profile, recipe pool, saved sheet, and auto-fill in that order. Recommend a unit test for the first wrong pure derivation, or an integration/browser test if the stored profile/import layer is first. If multiple stored rows are wrong, add `data-heal-playbook` and do not claim a client-only test fixes the data.

### Sync resurrection

**Report:** “A deleted recipe came back after another device synced.”

Classify as sync with possible persisted tombstone/data risk. Route through `sync-invariant-check`; inspect merge, tombstone, LWW, and reset behavior. Recommend an integration test with two clients and a delete/sync/reload sequence, plus a client/browser scenario only if selection or rendering is part of the report. If production data was already resurrected, route to `data-heal-playbook`.

### Import mismatch

**Report:** “The cheese workbook linked the same flavor to two recipes and one imported weight is missing.”

Classify as imports/data. Route through `import-bug-investigation` and `spec-import-guard`; identify whether parsing, chunk union, name linking, or persistence first diverges. Recommend a deterministic fixture/corpus regression for parse/link output, then an integration round trip if server persistence is implicated. Add the heal route if bad pool/profile rows already exist.

### Mobile layout regression

**Report:** “The setup screen works on desktop but the action button is clipped on a phone.”

Classify as UI/rendering with a responsive surface. Inspect the shared web layout and any `?screen=` station path; note that this project’s responsive web app is distinct from real mobile parity. Recommend a visual/browser test at the failing viewport, plus an accessibility smoke check if focus or an obscured control is involved. Use real-mobile only when the issue depends on native runtime behavior rather than responsive web layout.

### API contract drift

**Report:** “The server accepts a new field, but generated client types reject it.”

Classify as API/contract. Locate the schema, OpenAPI/codegen output, route validation, and client declaration package. Recommend an API contract/typecheck regression that proves the field is accepted and represented on both sides; add `schema-change-checklist` if it is persisted. Do not solve a generated-declaration problem with a browser test.

## Trigger boundaries

### Activate for

- “Where should I add a test for this bug?”
- “Can we add coverage for this regression?”
- “What regression test should protect this feature?”
- A concrete bug report where the correct test layer or source of truth is unclear.
- A request to turn an incident or manual check into a bounded test/task plan.

### Do not activate instead of direct work for

- “Run the existing tests” or “tell me why this test failed”: use the testing/diagnostics path.
- “Implement the fix and add tests”: implement directly, then use this skill only if triage is genuinely ambiguous.
- A clearly scoped unit-test request naming the function and expected cases.
- A specialist import, sync, state-accuracy, schema, data-heal, or release request whose governing skill is already obvious.

When a direct implementation request also contains an ambiguous regression claim, briefly triage the source-of-truth and route to the specialist skill, then continue with the requested implementation rather than creating a second planning exercise.