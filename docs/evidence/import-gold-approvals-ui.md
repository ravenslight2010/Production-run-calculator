# Gold Lab approval workflow — scoped development verification

## Agent-owned execution

Objective: let authorized Manager and QC Manager users create immutable pending
metadata, inspect it, attest private review, and revoke it in the existing app.
Owner: implementing task agent. No user decision or private evidence is required.
The existing server owns authorization, facility scope, actor identity, timestamps,
and persistence. No schema change, real customer source, private evidence upload,
capture switch, Gemini grant, or export grant is part of this work.

Implementation follows the approved metadata-only workflow: reuse the protected
approval endpoints and generated client; add scoped manager navigation and a
focused component; verify rendered validation/errors and synthetic persistence.
Sources: approval routes and input validator, generated API contract, and the
source-use decision document. All verification uses synthetic data only.

## Applicable safeguards and verification

- Apply task-execution rules, React client state invariants, error handling,
  test-gap triage, evidence hygiene, and verify-before-commit.
- No API contract changes or code generation are required.
- Render all lifecycle states; prevent nested forms and surrounding Home submit.
- Check both authorized roles, role plus capability denial, scope changes,
  reference/digest/date validation, explicit attestations, and failed requests.
- Use existing disposable-Postgres integration fixtures for server persistence.
- Browser checks cover only this new protected workflow, with synthetic records;
  never enable real-source capture or inspect private evidence.
- Compatibility matrix: desktop, phone, tablet portrait/landscape in Chromium and
  WebKit are applicable. Physical Android Chrome and iOS Safari/PWA are not run:
  no physical-device service is available. Native mobile is not applicable.

## Verification results and failure ledger

- PASS: scoped source approval API integration, including fresh reads after
  creation, verification and revocation (`source approval metadata`).
- PASS: workspace `pnpm run typecheck`, including generated-contract checks.
- PASS: 16 focused rendered approval tests (including malformed HTTP successes).
- Initial browser attempt: NOT REACHED. Web build correctly rejected the new
  lazy module because its deferred-panel inventory entry was missing.
  Repair: register the module in the existing boundary inventory; do not bypass
  or weaken the guard. Owner: implementing agent. Browser execution follows the
  repair; no browser result is claimed from the aborted startup.
- PASS: 102 deferred-boundary guard tests after registering the new lazy module.
- Desktop Chromium browser evidence: synthetic creation, field review, pending
  reload, explicit verification, verified reload, revocation confirmation/cancel,
  revoked reload, initial read-error retry, invalid reference/digest rejection,
  Enter prevention and desktop bounds passed before test setup failed.
- Browser fixture failure: expired-state setup reused a unique record reference
  and correctly received 409; retained synthetic records then invalidated later
  projects' empty-list assumption. Repaired with unique fixture references and
  explicit reference-scoped cleanup in disposable Postgres, not shared data.
- A subsequent startup was NOT REACHED because a source edit during the local
  build invalidated its fingerprint. No identity guard was bypassed. Freeze app
  edits during the build; do not treat this as a need to publish.
- The narrow remaining browser check covers expired metadata, authorization and
  viewport bounds only; it does not repeat the successful lifecycle journey.
- PASS: direct calculator build with development identity and both source
  boundary guards. Workspace-level publish-preparation reuse rejected a stale
  prepared fingerprint as expected for this changed working tree; it was not
  used or bypassed to verify the app, and no publish preparation was updated.
- Browser fixture assertion repair: non-manager test accounts use generated
  custom roles, not a literal `staff` role. Assert their actual role and required
  capability. No application role or authorization policy was changed.
- PASS: the narrow expired-metadata, Manager/QC Manager access, denied
  role/capability, and horizontal-bounds test in all eight projects:

  | Emulated viewport | Chromium | WebKit |
  | --- | --- | --- |
  | Desktop 1440 × 900 | PASS | PASS |
  | Phone 390 × 844 | PASS | PASS |
  | Tablet portrait 768 × 1024 | PASS | PASS |
  | Tablet landscape 1024 × 768 | PASS | PASS |

  This matrix covers that narrow subflow, not a claim that the full lifecycle
  was rerun eight times. Lifecycle browser evidence is desktop Chromium, with
  scoped persistence independently covered by API integration.
- Eight synthetic-only screenshots are retained locally under
  `artifacts/run-calculator/generated-artifacts/import-gold-approvals-interrupted/`.
  These ignored artifacts show visible portions of a scrollable settings panel;
  assertions cover metadata outside the screenshot viewport too. They are
  development evidence, not production evidence or physical-device proof.
- Final focused rendered suite: PASS, 16 tests, including no truncation of
  overlong digest input. Physical Android Chrome and iOS Safari/PWA remain
  NOT RUN (no physical-device service); native mobile remains not applicable.
- All implementation/fixture failures listed above are resolved for the scoped
  development checks. No required task failure remains open.
- No production evidence is claimed.
