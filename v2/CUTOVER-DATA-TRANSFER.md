# V1-to-V2 setup and staff transfer rehearsal

**Status:** synthetic V2-side rehearsal prepared; production-source extraction
and every production write remain blocked.

**Evidence reviewed:** archived V1 schema sources under
`lib/db/src/schema/`, especially `users.ts`, `userRoles.ts`, `roles.ts`,
`inventory.ts`, `ingredients.ts`, `brandProfiles.ts`, `doughRecipes.ts`,
`sauceRecipes.ts`, `cheeseRecipes.ts`, `mixes.ts`, `dieTypes.ts`,
`dieLineDefaults.ts`, `productionRules.ts`, `freezerPullItems.ts`, and
`runTemplates.ts`; V2 migrations `0001`–`0006`; `_archived/v1/README.md`;
`v2/HANDOFF.md`; and `v2/READINESS-REPORT.md`.

This is a schema-based plan, not a review of V1 rows. The V1 application is
archived, its old workflows are absent, and this workspace has no configured
read-only V1 source connection. The current V2 development database is not an
authorized substitute for a V1 source. No source records, production
database, V2 shared database, or credentials were accessed for this rehearsal.

## Allowlist and disposition

The approved cutover boundary is limited to setup/master data and staff
identity/role information. The following is the narrowest transfer boundary
that can be represented safely by the current V2 schema. “Eligible after
review” is not approval to extract or write production data.

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

### Not in the automatic allowlist

The V2 schema has no matching import destination for these V1 master-data
families. They remain excluded until their V2 representation and mapping rules
are separately reviewed; the phrase “setup/master data” is not permission to
drop or reinterpret them:

- `mixes` and their prep/batch semantics;
- `ingredients` as a separate identity/merge/allergen catalog;
- `die_types` and `die_line_defaults`;
- `production_rules` and `freezer_pull_items`;
- `run_templates`;
- `factory_kv` values, learned aliases, and other manager-maintained lists;
- inventory locations/warehouse names and inventory product references.

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
- import/audit/operation history, sync/outbox data, event receipts, and
  unlisted or unmappable fields.

V2 opening inventory must come from a new, manager-reviewed physical count.

## Duplicate, reference, retry, and rollback policy

- Compare usernames case-insensitively. A duplicate or existing V2 username
  is a conflict: do not overwrite its account, password, disabled state, or
  role. Resolve it with a manager before continuing.
- V2 setup imports reject duplicate codes case-insensitively and reject
  missing/inactive product references. Resolve code collisions and missing
  links before staging; do not merge or fuzzy-match records automatically.
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
- If an approved non-production setup rehearsal must be undone, call
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

`v2/db/cutover-transfer-rehearsal.test.sql` exercises synthetic V2 inputs only:

- staff role mapping to the V2 `operator` role, case-insensitive duplicate
  handling, disabled-account behavior, and opening/revoking a new V2 session;
- three synthetic products, one linked recipe, and one production setup;
- repeated stage/apply requests, rejected duplicate codes, and
  product/recipe/setup relationship checks;
- reverse-order setup undo, repeat-undo behavior, disabled staff rollback, and
  no additional run or inventory balance/movement rows.

`v2/server/http-postgres.integration.mjs`, run by the same disposable
PostgreSQL suite, builds a synthetic allowlisted batch, sends its products,
recipe, and setup through V2's real manager import APIs, and signs in a newly
provisioned operator from the batch using V2's actual password hashing. This
proves the synthetic V2 path; it does not import a V1 password or prove any
production account can sign in.

The rehearsal uses SQL/API tests and no manager setup screen, so desktop,
phone, tablet-portrait, tablet-landscape, Chromium, and WebKit visual coverage
are **not applicable to this database-only rehearsal**. Existing browser test
evidence remains separate and does not imply physical Android Chrome or iOS
Safari/PWA verification.

## Blocker and owner-controlled next steps

**Exact source-access blocker:** no authorized read-only V1 data path is
configured or identified in the project. `_archived/v1/` contains application
source, not a database snapshot. The V1 app workflows are retired. The
available project-managed V2 database is not a permitted V1 source. Therefore
no V1 row counts, actual relationships, real duplicate list, source extract,
or production-source data validation can be reported.

Before any real extraction, the owner must separately authorize a specific
read-only V1 source and its limited field projection through an approved
access path. Before any final V2 production write, the owner must separately
approve the reviewed transform, destination, and write window. Do not request
credentials in chat or use the V2 development connection as a substitute.
Any records in unmapped families remain a cutover blocker until their V2
representation is approved.

For a future approved cutover, record per-source-table input, eligible,
imported, duplicate, quarantined, and excluded counts; validate all target
references and role mappings; stage and review every V2 setup batch; verify
fresh V2 sign-in without V1 sessions or reset tokens; and retain the exact
request IDs and Apply/Undo outcomes. The owner/operator, not this rehearsal,
controls production extraction and final writes.
