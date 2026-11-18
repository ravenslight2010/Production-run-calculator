# V1-to-V2 setup and staff transfer rehearsal

**Status:** approved setup families now have typed V2 targets and a manager-only
CSV review/apply/undo flow. Synthetic V2 checks pass. This task did not read V1
or production data; no V1 setup or staff rows were imported. A limited,
owner-authorized aggregate V1 source audit from 2026-11-17 is retained below.
Further source extraction and every production write remain blocked.

**Evidence reviewed:** archived V1 schema sources under
`lib/db/src/schema/`, especially `users.ts`, `userRoles.ts`, `roles.ts`,
`inventory.ts`, `ingredients.ts`, `brandProfiles.ts`, `doughRecipes.ts`,
`sauceRecipes.ts`, `cheeseRecipes.ts`, `mixes.ts`, `dieTypes.ts`,
`dieLineDefaults.ts`, `productionRules.ts`, `freezerPullItems.ts`, and
`runTemplates.ts`; V2 migrations `0001`–`0006` plus the separate role-equivalent
and approved-setup catalog migrations; `_archived/v1/README.md`;
`v2/HANDOFF.md`; and `v2/READINESS-REPORT.md`. On 2026-11-17, the owner
identified this project's production database as the V1 source and authorized a
limited read-only review of the documented allowlist. The review used the
production read-only query path. Exact database revision and snapshot time are
unknown.

The source audit below is historical evidence from that separately authorized
read-only review; this setup-family implementation used schema sources and
synthetic V2 fixtures only. Only aggregate counts, validation results,
role-capability parity, product category/unit counts, profile field-key
frequencies, and names/categories-only
ingredient-reference match counts are retained below. No individual usernames,
account IDs, recipe rows, formula payloads, profile values, passwords/hashes,
sessions, reset tokens, run data, or inventory balances/movements were returned
or saved. The approved ingredient check did not select ingredient IDs,
merge-target values, or allergen fields. Sandbox accounts and non-live
master-data scopes were excluded from eligible counts. The V2 development
database was not used as a V1 source.

## Allowlist and disposition

The approved cutover boundary is limited to setup/master data and staff
identity/role information. “Eligible after review” is not approval to transfer
or write production data. V2 now provides a manager-only staging and review
path for each approved setup family; any new V1 extraction and cutover still
require separate owner approval.

| V1 source | Fields eligible for the reviewed projection | V2 destination and rules |
| --- | --- | --- |
| `users` | `username`, `disabled` | New V2 staff account. Generate a new V2 UUID and a fresh V2 Argon2id password through the V2 staff-provisioning flow. Never select or transfer `password_hash`, `password_changed_at`, session fences, onboarding settings, or V1 IDs. |
| `user_roles` | `role` joined to the account by `user_id` | Map only an individually reviewed V1 `operator`/`manager` assignment to a V2 built-in role after checking its effective V1 capabilities against V2. Do not copy role IDs, custom role definitions, or capability JSON. A custom role or capability mismatch is quarantined for an owner decision; do not guess or elevate. |
| `inventory_items` | Candidate identity and display fields: `key`, `category`, `name`, `unit` | V2 `products` (`code`, `name`, `unit`) only after an explicit reviewed code/unit mapping. `key` is not automatically a V2 code; invalid, ambiguous, or duplicate mappings are quarantined. `reorder_threshold`, `production_ingredient_id`, `conversion_factor`, and consumption policy have no current V2 product equivalent and are not copied. |
| `dough_recipes`, `sauce_recipes`, `cheese_recipes` | Candidate recipe identity and formula fields: `name`, `brand`, `flavors`, `enabled`, `components`; for dough, approved doughball metadata; for cheese, approved shredder/cellulose metadata | V2 `master_records` with `kind='recipes'` only after a product code, station, component product codes, quantities, and units are all explicitly resolved. Text ingredient names are not guessed into product codes. Unsupported metadata is retained in the review report, not silently discarded or folded into `data`. |
| `brand_profiles` | Candidate `brand`, `flavor`, `values`, `crust_values` | No direct V2 profile destination exists. These fields may inform a separately reviewed product/production-setup mapping, but are not copied as opaque profile JSON. |
| V1 approved setup represented by a validated profile | Only the fields explicitly selected for the resulting setup: `code`, `name`, `productCode`, `recipe_codes`, and `packaging_per_case` | V2 `master_records` with `kind='production-setups'`, after every recipe and product reference resolves uniquely. V2 does not accept an unvalidated V1 profile blob. |

The V2 target field allowlist is deliberately limited to:

- **Products:** `code`, `name`, `unit` (stored as `base_unit`).
- **Recipes:** `code`, `name`, `productCode`, and validated `data` containing
  `station_key` and `ingredients` (`product_code`, `quantity`, `unit`).
- **Production setups:** `code`, `name`, `productCode`, and validated `data`
  containing `recipe_codes` and `packaging_per_case`
  (`product_code`, `quantity`, `unit`).
- **Staff:** `username`, `disabled`, and a separately reviewed built-in
  `roleName`. V2 assigns new account IDs and a new password hash.

### Approved additional setup-family import map

The V2 manager import supports the following separately typed setup families.
Field names below describe the normalized V2 import payload; CSV headers and
per-field validation are defined in `core/setup-catalog-csv.mjs`.

| V1 family | Reviewed V2 fields and rules |
| --- | --- |
| `mixes` | `code`, `name`, `brand`, `flavor`, `batchSizeLbs`, `daysEarly`, `notes`, `isPrep`, `enabled`, and `components`. Component `perPizzaOz` remains oz/pizza; `perBatchLbs` remains pounds/batch. An explicit ingredient code creates a facility-scoped foreign-key link. A name without a code remains unlinked and visible for review. `amountAlreadyMade` and `amountActualMade` are run/day state and excluded. |
| `ingredients` | `code`, `name`, `categories`, `allergens`, `allergensReviewed`, `mergedIntoCode`, and `enabled`. Allergens are preserved exactly as entered. Empty plus reviewed means reviewed-empty; empty plus unreviewed remains unknown. A merge target must resolve by explicit V2 ingredient code; no allergen is inferred and no safety gate is added by this import. |
| `die_types` and `die_line_defaults` | Die code/name plus explicit `crustsPerCycle`, `cycleSpeed`, `speedAdjustment`, `freezerTime`, `casesPerLayer`, `preTunnelMin`, `postTunnelMin`, `pressOvenMin`, and `frontlineMin`. Default rows must reference an imported die code. Blank optional timing cells become `null`; required numbers are not filled from defaults. |
| `production_rules` | `code`, `name`, `type`, `enforcement`, `enabled`, `field`, `min`, `max`, `attribute`, `before`, `after`, `bypass`, and `checklist`. Supported types are required-field, numeric-range, and sequence; flexible/strict is retained as data. Missing rule details remain null, and V2 does not silently reinterpret or enforce these imported rules. |
| `freezer_pull_items` | `code`, `ingredientName`, optional explicit `ingredientCode`, `daysEarly`, and `enabled`. A supplied ingredient code must resolve to a V2 ingredient; otherwise Apply is rejected and the staged import remains reviewable. |
| `run_templates` | `code`, `name`, optional `brand`/`flavor`, and the explicit setup-values allowlist in `core/setup-catalog-csv.mjs`: production speeds/yields, setup quantities, applicator/pepperoni types and quantities, die/allergen/recipe selections, packaging selections and timing values. Nested recipe rows preserve ingredient names, optional source identity text, and pounds. Brand/flavor and source ingredient IDs remain text, not V2 product/ingredient links. Runtime counters, timers, run identity/revision, live inventory, temporary overrides, and deletion/history metadata are rejected. |
| `manager-lists` | Only the named `run-calc-*` directories in the parser allowlist: brands/flavors, ingredient and die/type lists, dough/frontline/cheese/mix names and presets, stop reasons, packaging lists, and shift/production start times. The owner's approved legacy `run-calc-flavors` list remains unscoped; V2 does not assign its names to brands. Values use the validated list/map/time shape for that exact key. |
| `aliases` | Spec-import alias kinds (`brand`, `flavor`, `appType`, `pepType`, `cheeseIngredient`, `doughIngredient`, `sauceIngredient`, `recipeName`, `dieType`, `crossFamilyRouting`) and merge-alias categories. Required context is explicit for flavor, recipe-name, cross-family, and brand-scoped flavor merge aliases; aliases are never fuzzy-matched. |

These named destinations do **not** authorize a generic `factory_kv` copy.
Arbitrary/unrecognized keys, merge/deletion tombstones, deleted/undeleted
stamps, and unrelated learned AI memory/correction data remain excluded. The
source import preserves explicit nulls and units; it does not synthesize V1
defaults or link by display name.

The exact imported manager-list keys are `run-calc-brands`,
`run-calc-brand-flavors`, `run-calc-flavors`, `run-calc-ingredient-types`,
`run-calc-pep-types`, `run-calc-die-types`, `run-calc-cheese-ingredients`,
`run-calc-dough-ingredients`, `run-calc-frontline-ingredients`,
`run-calc-mix-ingredients`, `run-calc-dough-recipe-names`,
`run-calc-dough-recipe-presets`, `run-calc-frontline-recipe-names`,
`run-calc-frontline-recipe-presets`, `run-calc-cheese-recipe-names`,
`run-calc-cheese-recipe-presets`, `run-calc-mix-recipe-names`,
`run-calc-stop-reasons`, `run-calc-circles`, `run-calc-shippers`,
`run-calc-skid-stacking`, `run-calc-grip-sheets`,
`run-calc-shift-start-time`, and `run-calc-production-start-time`.

V2 setup catalog imports use one dedicated table per family plus explicit
facility-scoped foreign keys for ingredient merges, mix components, freezer
pull ingredient references, and die defaults. A manager can download the
family-specific CSV, validate and stage it, reopen the exact values, apply
idempotently, and undo only while no later edit or dependency makes the
snapshot unsafe to restore. This capability is for reviewed setup data only;
it does not execute an imported production rule or use an imported run template
to start a run.

Inventory locations/warehouse names and inventory product references remain
outside this import and are covered by the separate inventory transfer plan.

Warehouse records, if later separately approved, must remain locations within
the single V2 facility. The V2 schema does not accept V1 warehouse balances as
an opening count.

The following are explicitly excluded regardless of whether their fields look
portable:

- `production_runs`, `daily_sync`, completed-run history, station state, run
  suggestions, and other historical or active production state;
- `inventory_lots`, `inventory_ledger`, `inventory_consumed_runs`,
  `inventory_balances` or any V1 on-hand quantity, movement, consumption,
  observation, or count history;
- `auth_sessions`, `password_reset_requests`, session tokens, reset-code
  hashes, V1 password hashes, and V1 user IDs;
- V1 import/audit/operation history, sync/outbox data, event receipts, and
  unlisted or unmappable fields. V2's own setup-import review history is
  retained only as the audit/retry/undo record for the new V2 import; it is not
  copied from V1.

V2 opening inventory must come from a new, manager-reviewed physical count.

## Duplicate, reference, retry, and rollback policy

- Compare usernames case-insensitively. A duplicate or existing V2 username
  is a conflict: do not overwrite its account, password, disabled state, or
  role. Resolve it with a manager before continuing.
- V2 setup imports reject duplicate codes case-insensitively and reject
  missing/inactive product references. Resolve code collisions and missing
  links before staging; do not merge or fuzzy-match records automatically.
- Setup-catalog files reject duplicate identities case-insensitively. Applying
  an existing setup code updates that record with a before/after snapshot;
  repeated request IDs replay only the identical server-hashed request. Explicit
  family links must resolve by code inside the same V2 facility. Unlinked names
  remain unlinked, and unknown codes block Apply.
- Rebuild relationships by reviewed V2 codes, not by copying V1 primary keys.
  Before Apply, verify every recipe's product and ingredient-product links and
  every setup's product, recipe, and packaging-product links.
- Keep one stable request ID and request hash per reviewed V2 import batch.
  Repeating the same `stage_setup_import` request returns the same import;
  applying an already-applied import is a replay. Never reuse a request ID
  with changed content.
- Staff provisioning uses V2's manager-controlled account flow with a fresh
  password. A duplicate result is a no-op requiring comparison, not permission
  to update the existing account. V2 account changes revoke V2 sessions.
- The current staff-create path creates an enabled account. Do not use a
  create-then-disable sequence for a real disabled V1 identity: it creates a
  sign-in window. Disabled identities must remain unprovisioned until V2 has an
  owner-approved atomic create-disabled path; the synthetic test's
  create-then-disable sequence is only a disposable behavior check.
- If an approved non-production product/recipe/setup rehearsal must be undone, call
  `undo_setup_import` in reverse dependency order: production setups, recipes,
  then products. V2 blocks undo if a record changed or a product became
  referenced; stop and review rather than bypassing the fence. As a rollback
  for a newly provisioned active V2 account, disable it through V2 so its
  V2 sessions are revoked; do not delete or rewrite an existing account.
- The rehearsal itself runs inside a transaction on the disposable local test
  cluster and rolls back. A failed production attempt must stop and retain its
  scoped evidence; no automatic retry or cleanup against production is allowed.

## Rehearsal results and coverage

`v2/core/cutover-transform.mjs` is the deterministic boundary for an
already-reviewed field mapping. It rejects unknown fields (including password,
session, stock, and opening-count fields), ambiguous case-insensitive
duplicates, invalid units/quantities, custom roles, and unresolved references;
it does not connect to or extract from a source database. The reviewed mapping
must be supplied before a production transfer can be authorized.

`v2/core/setup-catalog-csv.mjs`, migration `0007-approved-setup-catalogs.sql`,
and the manager setup-catalog panel implement the separate approved-family
path. Its field allowlists, duplicate rules, facility-scoped relationships,
retry identity, snapshots, and undo guards are tested using synthetic V2
fixtures only.

`v2/db/cutover-transfer-rehearsal.test.sql` exercises synthetic V2 inputs only:

- staff role mapping to the V2 `operator` role, case-insensitive duplicate
  handling, disabled-account behavior, and opening/revoking a new V2 session;
- three synthetic products, one linked recipe, and one production setup;
- repeated stage/apply requests, rejected duplicate codes, and
  product/recipe/setup relationship checks;
- reverse-order setup undo, repeat-undo behavior, disabled staff rollback, and
  no additional run or inventory balance/movement rows.
- synthetic approved-family records, units, reviewed-empty versus unknown
  allergen state, manager-directory allowlists, explicit ingredient/die links,
  retry, update/undo, blocked unresolved links, rollback, and facility fencing.

`v2/server/http-postgres.integration.mjs`, run by the same disposable
PostgreSQL suite, builds a synthetic allowlisted batch, sends its products,
recipe, and setup through V2's real manager import APIs, and signs in a newly
provisioned operator from the batch using V2's actual password hashing. This
proves the synthetic V2 path; it does not import a V1 password or prove any
production account can sign in.

The manager setup flow is covered by an emulated Chromium journey at desktop,
phone, tablet portrait, and tablet landscape viewport sizes. WebKit and
physical-device tests are recorded separately; browser emulation does not prove
physical Android Chrome or iOS Safari/PWA behavior.

### Authorized V1 source audit (2026-11-17)

The source audit returned aggregate results only. These are source counts, not
V2 import counts; **no source row has been applied to V2**.

| Source family | Read-only result | Transfer disposition |
| --- | --- | --- |
| `users` | 10 total; 1 sandbox account excluded; 9 live enabled accounts; 0 disabled, blank/untrimmed, or case-insensitive duplicate usernames | Seven accounts have built-in roles eligible for reviewed mapping. Two custom-role accounts remain on hold until their V2 capabilities are enforced by the owning workflows. No account identifiers or usernames were retained. |
| `user_roles` / `roles` | 9 live assignments; 0 orphaned or roleless live accounts. Assignments: manager 3, operator 4, `qc-manager` 1, `warehouse` 1. Seven role definitions are present: 2 built-in and 5 custom. | V1 manager's 11-capability set exactly matches V2 manager; V1 operator's empty set exactly matches V2 operator. With separate owner approval, only the two assigned custom roles' capability-name lists were read: `warehouse` has `manage-inventory`; `qc-manager` has `use-ai-tools`, `review-incidents`, `manage-allergens`, `record-qc`, and `manage-qc`. V2 development now has non-built-in role rows with those exact sets. `warehouse` maps to the existing inventory permission; QC and incident behavior still depends on Tasks #3964 and #3965. Three custom definitions have no live assignment; no other custom-role capabilities were read. |
| `inventory_items` | 3 live entries: 1 ingredient in `cases`, 2 ingredients in `lbs`; 0 packaging-category entries, blank identity fields, or case-insensitive duplicate keys | All three require an explicitly reviewed V2 code/unit mapping. Legacy keys are not assumed to be V2 product codes. No V1 stock quantity or movement table was queried. |
| `ingredients` | Live, enabled, unmerged names/categories produced 121 unique exact-name/category-compatible candidates covering 545 of 639 recipe component references; 36 distinct names covering 94 references were unmatched. No ambiguous names or category conflicts. | This was an aggregate match check only; no IDs, merge-target values, or allergen fields were read. Candidate links are not V2 codes. Task #3960 added the typed V2 ingredient/allergen target; source rows and recipe links still require separate approval and explicit V2-code mapping. |
| `dough_recipes` | 18 live, all enabled; 0 duplicate identity groups by case-insensitive name/brand plus flavors. All have empty flavor arrays and blank brands; 5 have empty component arrays. The 101 component names have 0 exact-name candidates among the 3 live V1 inventory items. | Empty flavor assignments can mean shared/untagged recipes in V1; they are not treated as errors. The 5 empty formulas need review; component links cannot be mapped from the current inventory-item allowlist. |
| `sauce_recipes` | 26 live, all enabled; 0 duplicate identity groups. All have empty flavor arrays and blank brands; none have empty or malformed component arrays. The 109 component names have 0 exact-name candidates among the 3 live V1 inventory items. | Shared/untagged source semantics are preserved for review. Component links cannot be mapped from the current inventory-item allowlist. |
| `cheese_recipes` | 134 live, all enabled; 0 duplicate identity groups. 70 have empty flavor arrays; 6 have blank brands; 6 have empty component arrays. Of 429 component rows, 29 have a non-positive, missing, or nonnumeric quantity; none of the component names exactly match a live V1 inventory item. | The 6 empty formulas and 29 invalid component quantities require review. Ingredient names are not mapped to V2 product codes automatically. |
| `brand_profiles` | 157 live; 18 have blank flavor; 0 blank brands, invalid JSON-object shapes, or duplicate case-insensitive brand/flavor pairs. Recipe-name references: dough 114/114 unique exact-name candidates; sauce 128/145 unique (17 unmatched); cheese 153/196 unique (43 unmatched); no ambiguous name matches. | No direct V2 profile destination exists. Exact recipe-name candidates still need product/brand/flavor review. A key-only field inventory found run-progress/correction metadata keys in the profile payload, so neither JSON blob is copied; only separately reviewed setup fields can be mapped. |

For component matching, recipe names were compared case-insensitively after
trimming against active ingredient names, with the matching recipe category
(`dough`, `frontline` for sauce, or `cheese`) or `general`. An initial query
counted distinct names rather than occurrences; it was discarded and rerun with
occurrence weighting. Only the corrected aggregate counts above are retained.

Role assignment accounting is 9 live accounts = 7 built-in-role candidates +
2 accounts held until their equivalent V2 features are ready. The single
sandbox account is excluded. All 3 inventory items, 178 recipe rows, and 157
profiles remain unapplied pending owner-reviewed mappings and an approved
destination. The two V2 role definitions are present in the development
database only; production seeding has not been performed or approved. No V1
rows were transferred, dropped, or silently merged. Source duplicate checks
covered case-insensitive usernames, inventory keys, recipe name/brand/flavor
identities, and profile brand/flavor identities; each reported zero duplicate
groups.

Across all three recipe families, 639 component references have no exact-name
match to the 3 live V1 `inventory_items`; the limited ingredient-catalog review
found unique category-compatible name candidates for 545 references and none
for 94. These are candidate links only, not approved relationships or V2 codes.
The separate ingredient/allergen identity target is now represented by typed V2
tables, but no source rows or recipe component links have been staged. Explicit
V2-code mapping and approval are still required. Profile-to-recipe name matches
are also candidates only.

The source audit does not establish V2 production readiness. The V2 production
schema/SQL objects and least-privilege role remain unresolved in
[READINESS-REPORT.md](./READINESS-REPORT.md). Any later destination write,
including a production write, needs its own owner approval after review of the
complete mapping and destination.

The current manager setup flow is covered by an emulated Chromium journey at
desktop, phone, tablet portrait, and tablet landscape viewport sizes. WebKit
could not launch because required container libraries are unavailable, and
physical-device behavior remains unverified; browser emulation does not prove
physical Android Chrome or iOS Safari/PWA behavior.

## Blocker and owner-controlled next steps

**Current blocker:** a limited aggregate source review was authorized and
completed on 2026-11-17, but no row-level mapping or import batch is approved.
No repeatable read-only path for a future row-level review is currently
identified. The owner chose to build equivalent V2 roles before transferring
the two custom-role accounts. Those role definitions now exist in V2
development; QC and incident behavior must still be implemented by Tasks #3964
and #3965 before the `qc-manager` account is usable. Do not map either account
to the broader manager role. Other blockers include legacy product keys,
ingredient and setup/profile code/link mappings, and packaging products absent
from the V1 inventory-item catalog. The 94 unmatched component references and
recipe component issues remain quarantined. Approved setup families now have
typed V2 targets, but no source rows have been staged or imported.

Before any real row-level extraction, the owner must separately authorize a
specific read-only V1 source and limited field projection through an approved
access path. The owner must review the role disposition, product/recipe/setup
mappings, and unresolved references before any transfer. The destination must
then be identified and separately approved. Any final V2 production write also
needs its own approval and write window after the destination and full batch
are reviewed. Do not request credentials in chat, use the V2 development
database as a V1 source, or bypass publication/production database gates.
Unsupported tombstones, arbitrary factory settings, learned AI memory,
run/history state, credentials, and inventory history remain excluded.

For the next approved transfer step, retain per-source-table counts and
quarantine reasons, review every target reference and role mapping, then stage
each batch only on the approved destination. Verify fresh V2 sign-in without
V1 sessions or reset tokens and retain request IDs plus Apply/Undo outcomes.
The owner/operator controls destination approval and all production writes.
