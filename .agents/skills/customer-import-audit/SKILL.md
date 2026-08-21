---
name: customer-import-audit
description: Audit after importing a new customer's spec workbook. Use when the user imports a new brand/customer and wants confirmation everything landed right, or reports something off after a new-customer import.
---

# New-Customer Import Audit

Verify what a new customer's workbook created. This is a read-only, post-import
audit—not an importer, a repair, or a replacement for the import investigation
and spec-import guard skills.

## Safety and evidence rules

- Use the dev database for queries (`psql "$DATABASE_URL"`). Never edit production
  data from this skill and never paste credentials, request bodies, workbook
  contents, emails, or other personal data into a report.
- Prefer stable, minimal identifiers (import id, saved-sheet id, row id, brand
  and flavor as needed). Redact or aggregate anything not needed to reproduce a
  finding. Do not log whole JSON blobs; select only the fields being checked.
- Capture a baseline before an import when possible: pool/profile counts,
  relevant row identifiers, and manager-entered values. If no baseline exists,
  say so and use saved-sheet timestamps, import metadata, or a narrow
  created/updated window as weaker evidence.
- Compare the landed value with both the source evidence and the pre-import
  value. A value that differs from the source is not automatically wrong:
  linking, canonicalization, and blank-fill rules may be intentional.
- A repair is not implied by a failed check. Escalate rather than overwrite a
  value that may have been entered or corrected by a manager.

## Before/after checklist (dev DB via `psql "$DATABASE_URL"`)

Record `PASS`, `WARN`, or `FAIL`, the query/source used, and the evidence
identifier for every row below.

| Area | Before import | Expected from source | After import / landed | Preservation check |
| --- | --- | --- | --- | --- |
| **Profiles** | Existing profile keys and manager-entered fields | One profile per intended brand/flavor, expected die and setup links | Created/updated profile count and selected JSON fields | Existing valid fields did not change without an explicit import rule |
| **Recipes** | Existing referenced recipe names and row counts | Expected dough, sauce/frontline, cheese, and mix recipes/rows | Names, links, weights, yields, and applicator rows that landed | Existing recipe rows and non-target customers were unchanged |
| **Aliases** | Existing aliases for the relevant context | Only deliberate, specific corrections | New `spec_import_aliases` rows and their source/context | No generic, digit-mismatch, cyclic, fuzzy, or cross-family alias was learned |
| **Pools** | Per-pool row ids, names, and counts | Reuse existing recipes where the match rules say to link | New rows, zero-value stubs, duplicates, and referenced pool ids | No pool row was renamed or re-scoped across customers |
| **Customer tags** | Existing customer/brand associations | New rows carry the intended customer tags; curated rows remain scoped | Tags on profiles and recipe/pool rows | No existing customer tag was removed or reassigned |
| **Saved-sheet reconciliation** | Latest saved parse id/hash/version | Landed values agree with the parse that was actually applied | Saved spec/premix/shipping sheet id, version, and relevant parsed items | Cached/stale parse reuse is explained; unresolved source-vs-landed differences remain visible |

For the profile check, a focused query is safer than selecting the entire
`values` document:

```sql
select brand, flavor,
       (values::jsonb)->>'dieType' as die_type,
       (values::jsonb)->>'targetDoughballWeight' as doughball_weight,
       (values::jsonb)->>'doughRecipeName' as dough_recipe,
       (values::jsonb)->>'frontlineRecipeName' as frontline_recipe
from brand_profiles
where scope='live' and brand ilike '%<name>%';
```

Also check:

1. **Weights sane per die size** — larger dies should generally have heavier
   balls. A value matching another customer's variant is a last-variant-wins
   smell, not proof by itself.
2. **Links, not duplicates** — profile dough/sauce/cheese names should resolve
   to the intended existing pool rows, not near-duplicate entries such as
   `"Spicy Cheese Mix"` and `"Cheese Mix"`. Identify all new pool rows and
   all-zero stubs.
3. **No cross-brand collisions** — the import did not rename or re-scope
   another customer's pool entries; curated brands must remain curated.
4. **Applicator slots** — station order is App 1, App 2, PEPS, App 3, App 4;
   pepperoni rows are on the correct side of the PEPS slot; cheese cards link
   to real cheese recipes.

## Standard audit report

Return a compact report in this shape:

```text
Import audit: <safe import/saved-sheet identifier>
Scope: <brand/customer label>, <source type>, <import time window>
Baseline quality: <captured | reconstructed | unavailable>

| Area | Source evidence | Expected | Landed | Affected entities | Confidence | Status |
| ...  | ...             | ...      | ...     | minimal ids/names  | high/med/low | PASS/WARN/FAIL |

Manager-value preservation: <how pre-import values were checked; result>
Unresolved items: <none or specific follow-up evidence needed>
Next action: <none | investigation | guard review | data heal review>
```

“Affected entities” must contain enough stable context to investigate (for
example a saved-sheet id plus brand/flavor or pool row id), but not whole
records or sensitive user data. Mark confidence low when the baseline or
source is reconstructed.

## Handoffs

- **Import-bug-investigation**: a source-versus-landed mismatch, wrong link,
  duplicate, missing row, or skipped item needs layer classification. Start
  there before proposing a fix.
- **spec-import-guard**: the suspected cause touches prompts, parsing,
  sanitizing, aliases, chunk/merge behavior, link passes, or export; follow its
  version and test sequence rather than duplicating it here.
- **wrong-number-triage**: one visible number is wrong but the import layer is
  not yet established; trace the displayed value to its source first.
- **data-heal-playbook**: evidence shows incorrect data is already persisted.
  Hand over the affected-row scope and preservation evidence; this skill does
  not mutate or prescribe the heal.

If all rows pass, report what was checked and any limitations. Do not call a
clean audit proof that every workbook cell is correct.
