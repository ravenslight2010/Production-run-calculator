# Staff Role Permissions Audit

**Review date:** 2026-10-30  
**Scope:** Role/capability audit followed by the targeted safeguards and development-only role update explicitly approved by the owner. This is not a security certification.

## Executive summary

- The system has 11 capabilities. Protected API requests resolve current role data on the server; client visibility is not the security boundary.
- The seeded `supervisor` and shared development `supervisor` role now include `approve-password-resets`, as explicitly approved. Production role data was not queried or changed.
- Last-enabled-manager checks now share an advisory transaction lock, exclude disabled/sandbox accounts, and cover status changes, role changes, role edits, deletion, and bootstrap.
- Schedule, profile, and QC controls identified in this review now use their API capability gates; an open authenticated client refreshes `/me` every 60 seconds.
- The owner chose to keep the current higher-access staff deletion behavior. It remains a documented risk accepted by that decision, not a newly added restriction.
- No role assignments, accounts, passwords, sessions, schema, or production data were changed. The development role record change was limited to the approved supervisor capability.

## Capability contract: protected actions and client controls

Capabilities authorize additional operations; an empty-capability operator can still use the authenticated operational app and its ordinary read paths. The server reloads the role/capabilities for protected requests. A client-side hidden button is supplementary, not authorization.

| Capability | Server-protected routes and actions | Web controls / effect |
|---|---|---|
| `manage-staff` | `/roles` and `/users` administration; staff invitations; signup-code status/rotation; account status, session revocation, role assignment, direct password reset and removal; import-gold administration; audit-log and manager-action-queue surfaces; profile/AI health cleanup; background diagnostics; supervisor PIN administration; selected sync reset operations. Some operations also apply live-scope or target-privilege checks. | Staff & Roles card and Roles manager; manager action queue, staff-only diagnostics and cleanup controls. It does **not** by itself grant every feature called “manager-only” in the UI. |
| `manage-inventory` | Inventory item create/edit/delete, adjustments, counts, transfers and settings; duplicate reviews; ingredient catalog edits/merges; recipe, mix, freezer-pull/surplus and cycle-count administration; photo/die/batch-weight records; inventory-oriented import operations. | InventoryTab stock controls, catalog/recipe editors, inventory tools and their write buttons. Most inventory reads remain available to signed-in operators. |
| `edit-production-rules` | Create/update and delete production rules (`POST`/`DELETE /production-rules`). Strict rules can block starting a run; flexible rules warn. | Production Rules settings/editor. |
| `approve-password-resets` | List eligible reset requests and approve or decline them. Approval issues a short-lived, single-use relay code; the target’s capabilities must be a subset of the approver’s. | Password-reset request queue in Staff & Roles; reset reminder/attention count. |
| `review-incidents` | Read, review, assign/workflow-update, resolve incidents; incident-pattern AI routes; operational and finalized reports; field-check review. Hardware confirmation and applicator-evidence finalization additionally require the literal `manager` role. | IncidentsTab, operational reports, issue-review navigation and attention counts. |
| `use-ai-tools` | AI import matching/parsing (including spec and premix flows), inventory photo identification and read access to AI corrections. AI-correction writes/deletes require `manage-staff`, not this capability. | AI actions in import dialogs and inventory photo intake; AI-enabled importer actions. |
| `manage-factory-settings` | Factory data writes; run create/delete; dated sync writes/deletes; schedule move/swap. Shared master-data history also requires the literal `manager` role, and its preview/apply/undo require both `manage-inventory` and `manage-profiles`. | Factory settings and scheduled-run editing controls. This is broader than editing an individual current-shift run. |
| `manage-profiles` | Brand-profile create/edit/delete and profile-linked learned records such as fill-missing values, import/spec aliases, merge aliases, denied merges, and profile import operations. Some shared master-data operations also require inventory and factory-settings capabilities plus the literal manager role. | Setup/profile editing, profile-backed importer controls and related reconciliation/alias actions. Profile writes are capability-gated separately from `manage-staff`. |
| `manage-allergens` | Change the ingredient allergen mapping (`PUT /ingredients/:id/allergen-mapping`). This is distinct from recording a run’s allergen review, which uses `record-qc`. | Ingredient allergen mapping controls. |
| `record-qc` | Read QC run/planning/history and references; append lots, weight/Brix/label/component checks, allergen reviews, cleaning records and date-code checks; record QC observations and signoff-related evidence. QC recipe-review status reads accept either QC capability. | QC workflows, observation/check entry, QC history and related read-only QC views. |
| `manage-qc` | Manage QC targets/references and reviews; signoffs; event corrections/redactions; import and recipe-review decisions; QC intelligence reports and CSV export. | QC settings, review/approval, correction, signoff, intelligence and export controls. |

Additional combined gates:

- Import-operation endpoints accept either `manage-profiles` or `manage-inventory` at the outer route, then check the import type and each changed entity against its specific capability in the handler.
- `/server-jobs` create/cancel accepts any one capability; the job APIs retain actor ownership checks.
- `/master-data-operations` requires `manage-factory-settings` plus the literal `manager` role for access; preview/apply/undo additionally require both `manage-inventory` and `manage-profiles`.
- Hardware confirmations and applicator-batch evidence finalization require `review-incidents` **and** the literal `manager` role.

## Seeded roles versus development records

Role seeds are defined in `artifacts/api-server/src/lib/roles.ts`. The comparison selected role name, capability array, built-in flag, and grouped assignment count only. After explicit approval, a conditional development-only write added the supervisor reset capability. Counts are all `user_roles` assignments, without filtering account status or sandbox membership; they are not a count of enabled human staff.

| Role | Seeded capabilities | Development capabilities | Assignment rows |
|---|---|---|---:|
| `manager` | All 11 | Match | 3 |
| `operator` | None | Match | 2 |
| `supervisor` | `review-incidents`, `edit-production-rules`, `approve-password-resets` | Match | 1 |
| `qc-operator` | `use-ai-tools`, `record-qc` | Match | 0 |
| `qc-manager` | `use-ai-tools`, `review-incidents`, `manage-allergens`, `record-qc`, `manage-qc` | Match | 0 |
| `warehouse` | None | Match | 0 |
| `inventory` | `manage-inventory` | Match | 0 |

No custom role definitions were present in the development role catalog. Custom roles remain editable data and must be inspected again before any future permission change; seed defaults alone do not establish future live configuration.

Notable current overlap:

- `operator` and `warehouse` have identical capability sets. Both retain the signed-in operational baseline; `warehouse` does not currently grant warehouse-specific write privileges.
- Only the `manager` role currently holds `manage-staff`, `manage-factory-settings`, and `manage-profiles` among the seeded non-manager roles.
- The `supervisor` reset-approval grant is now present in both the code seed and development record. Existing production/custom records are not automatically upgraded by this change.

## Current versus proposed role matrix

This matrix records the audit baseline and the approved development result. Only the supervisor reset-approval grant was added; the remaining grants were left unchanged.

| Role | Audit baseline | Approved development result | User-facing purpose and operational effect |
|---|---|---|---|
| `manager` | All 11 | Unchanged: all 11 | Full staff/factory administration and access to all operational capabilities. The built-in manager cannot lose `manage-staff`; other capabilities remain editable. |
| `operator` | None | Unchanged: none | Normal signed-in production use, with ordinary shared reads and current-day operational paths; no additional administrative or master-data writes. |
| `supervisor` | `review-incidents`, `edit-production-rules` | **Add `approve-password-resets`** | Preserves incident review and production-rule edits; the new grant exposes the reset queue and allows approving/declining eligible peer/lower-privilege requests. Higher-capability targets remain blocked server-side. |
| `qc-operator` | `use-ai-tools`, `record-qc` | Unchanged | Record/review QC evidence and AI-assisted actions. `use-ai-tools` also reaches non-QC AI endpoints; no role change was approved. |
| `qc-manager` | `use-ai-tools`, `review-incidents`, `manage-allergens`, `record-qc`, `manage-qc` | Unchanged | QC evidence and administration, corrections/reviews, allergen mapping, incident review and AI. `manage-qc` includes sensitive corrections, redactions, signoffs and exports. |
| `warehouse` | None | Unchanged: none | Retains authenticated operational/read access without broad inventory administration. Narrow staging/transfer access remains an open business question; `manage-inventory` would also enable catalog and stock administration. |
| `inventory` | `manage-inventory` | Unchanged | Inventory administration, including stock adjustments, catalog/recipe operations and inventory imports. No profile, factory or staff permissions were added. |
| Any custom role | No custom roles currently stored | No change | Capabilities are additive to authenticated baseline access. Re-read and review the stored definition before future edits or assignments. |

### Proposed capability-to-role assignment summary

| Capability | Proposed roles |
|---|---|
| `manage-staff` | manager |
| `manage-inventory` | manager, inventory |
| `edit-production-rules` | manager, supervisor |
| `approve-password-resets` | manager, supervisor (approved in code seed and development role only) |
| `review-incidents` | manager, supervisor, qc-manager |
| `use-ai-tools` | manager, qc-operator, qc-manager |
| `manage-factory-settings` | manager |
| `manage-profiles` | manager |
| `manage-allergens` | manager, qc-manager |
| `record-qc` | manager, qc-operator, qc-manager |
| `manage-qc` | manager, qc-manager |

## Safeguards and evidence

### Role creation, edits and assignment

- **PASS — create/assign privilege ceiling:** `createRole` rejects capabilities the actor lacks; `setUserRole` refuses a role containing any capability the actor lacks. The integration suite exercises create and assignment denial through a constrained `manage-staff` actor.
- **PASS — built-in manager cannot lose `manage-staff`:** the server rejects removal of this capability. Other manager capabilities are editable; the UI does not lock them.
- **MISSING — constrained role-edit policy:** creation and assignment reject capabilities the actor lacks, but a role editor may remove capabilities they do not hold. The owner has not decided whether that is intentional. Keep this behavior unchanged until the policy is reviewed and add a focused test after approval.
- **PASS — assigned role deletion and built-in names:** the API refuses built-in deletion and deletion of an assigned role; rename checks protect built-ins and duplicate/blank names.

### Last-manager protection

- **PASS — shared enabled-manager guard:** manager-holder checks exclude disabled and sandbox accounts. Status changes, role assignment, role-capability edits, role deletion, user deletion, and bootstrap use the same transaction-scoped advisory lock.
- **PASS — last-manager behavior:** isolated tests cover disabled-manager exclusion, concurrent attempts to demote the last enabled manager, concurrent manager deletion, and ordinary sole-manager demotion/removal.

No manager assignments or account statuses were modified.

### Higher-privilege account administration

- **PASS — role assignment, status, session revocation and direct reset:** these paths compare target capabilities to the actor’s capability set; the reset-approval path also hides and rejects higher-privilege targets.
- **PASS — explicit owner decision, behavior retained:** account deletion still requires `manage-staff` and protects the last enabled manager, but does not compare target capabilities with the actor’s. The owner explicitly chose to keep this behavior; an isolated regression test verifies that a constrained `manage-staff` actor may delete a higher-capability account when another enabled manager remains.
- **PASS — password reset and session revocation:** password changes invalidate the target’s older sessions; tests verify old-token rejection. Approvers cannot list, approve or decline a manager’s request, but can approve an operator’s request.

### Web controls versus API authorization

- **PASS — schedule/profile capability alignment:** the reviewed schedule and run-management controls now require `manage-factory-settings`; profile setup/edit controls require `manage-profiles`. The supervisor PIN/floor-mode path is unchanged.
- **PASS — QC capability alignment:** the QC navigation and quality surface now require `record-qc` or `manage-qc`, rather than the `manage-staff`-based `isManager` alias. Server-side route authorization remains authoritative.
- **PASS — role freshness:** authenticated clients refetch `/me` every 60 seconds while in the foreground, and a focused client test verifies changed capabilities reach an open client.

These targeted changes address the identified mismatches; they do not replace a full audit of every role-name or broad `isManager` check elsewhere in the app.

## Focused verification

- **PASS:** `roles.integration.test.ts` and `passwordReset.integration.test.ts` — 234 tests passed against isolated disposable test databases.
- **PASS:** `roleSurfaceAccess.test.ts`, `AuthContext.race.test.tsx`, and `profileWriteAccess.test.ts` — 18 tests passed.
- **PASS:** workspace `typecheck` completed successfully.
- **PASS:** development-only supervisor update used a conditional write against the reviewed prior capability list, then read back the new capabilities. Grouped assignment totals were checked; no identities or account fields were queried.
- **FAIL — broader client-suite baseline:** the configured `test:client` run began at 18:13:38, before this task's code edits, and reported 3 unrelated failures across 387 files: two stale argument assertions in `profileSubTab.test.ts` and one exact-string assertion in `syncBaselineGate.test.ts`. The focused role/access client tests passed. Owner: client test maintainers; next action: repair those assertions in separate work.
- **NOT RUN:** browser compatibility/E2E tests on Chromium or WebKit at desktop, phone, and tablet sizes/orientations; physical iOS/Android device checks; production database inspection; and deployment checks. The preview screenshot showed only the sign-in page; authenticated manager UI was not visually verified. No production data or deployment was accessed or changed; the focused API/client tests and typecheck are the verification performed for this bounded change.

## Owner decisions and next step

- **Approved and implemented:** add `approve-password-resets` to the supervisor code seed and shared development supervisor role.
- **Approved and preserved:** keep current higher-access account deletion behavior.
- **Approved targeted scope:** unify enabled-manager safeguards, align schedule/profile/QC controls to their API capabilities, and refresh open-client capabilities every 60 seconds.
- **Not approved or changed:** production role data, any role assignment, accounts/statuses, and the unresolved constrained-role-editor revocation policy.

**Next step:** if the owner wants the approved supervisor reset grant on the published app, explicitly authorize a separate production-role update; this task intentionally changed development data only. Separately decide whether staff role editors may revoke capabilities they do not hold before adding or changing that policy.
