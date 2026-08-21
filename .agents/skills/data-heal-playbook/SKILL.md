---
name: data-heal-playbook
description: Fix bugs that poisoned stored data (profiles, pools, day-state). Use whenever a bug fix alone is not enough because wrong values are already saved in the database — e.g. an import wrote a wrong number into many profiles. Covers checking for poisoned data, writing a one-time server heal, and verifying it.
---

# Data Fix / Heal Playbook

Repair already-poisoned stored data by shipping a narrowly scoped, one-time
code heal. This is complementary to `customer-import-audit`: an import audit
verifies a new import; this playbook repairs persisted damage after the write
bug is understood. It does not replace `import-bug-investigation`,
`spec-import-guard`, or `wrong-number-triage`.

The production database cannot be edited directly. Never run an ad-hoc
production mutation from this skill. Fix the write path first so the heal
cannot immediately re-poison the data.

## Required heal plan

Before editing heal code, write down each section. A plan that cannot identify
the affected rows or preserve manager values is not ready to execute.

1. **Diagnosis** — What write path caused the poison? What is the known bad
   predicate, and what evidence distinguishes it from a legitimate value?
2. **Affected-row scope** — Which tables, scopes, dates, customers, and row
   identifiers are included? Which valid rows are explicitly excluded? Use
   grouped counts and sampled minimal fields; do not dump whole JSON documents.
3. **Repair rule** — State the deterministic replacement or deletion rule.
   Prefer the app's own derivation over guessing. If inputs make a fallback
   derived, use the same condition and clear the fallback rather than inventing
   a value.
4. **One-time execution and idempotency** — Give the heal a fresh stable marker
   id, claim it before changing rows, and make concurrent/restarted instances
   safe. A second run must produce zero additional changes.
5. **Rollback posture** — Explain what can be reversed, what snapshot/evidence
   is retained, and why the scope is safe. If rollback is not automatic, say
   so before shipping. Do not broaden a heal to make rollback easier.
6. **Verification** — Define marker, row-count, value, and preservation checks
   for both development and the live publish. Include the expected result, not
   just a command.

## Process

1. Fix the code bug first and add a guard against re-poisoning.
2. **Diagnose in dev** with `psql "$DATABASE_URL"`. Survey prevalence (group
   by value/count) in the relevant tables: `brand_profiles` (`values` JSONB),
   `dough_recipes`/`sauce_recipes`/`cheese_recipes`, `daily_sync`,
   `saved_spec_sheets`, and `import_aliases`/`spec_import_aliases`/
   `ai_corrections`.
3. **Run a scoped dry-run preview where possible.** Print only counts and
   minimal stable identifiers plus before→after fields. Save enough evidence
   to compare the exact target set, but never log secrets, credentials,
   request bodies, whole user objects, or unnecessary customer/user data.
4. **Check manager-value preservation before execution.** Capture the
   manager-entered fields or row versions that must survive, and require the
   bad predicate to match. A row that may be a valid manager correction must
   be excluded or escalated; never overwrite it merely because it differs from
   the source.
5. **Implement the one-time heal** in
   `artifacts/api-server/src/lib/dataHeals.ts`:
   - Add a fresh stable id (for example `my-fix-v1`) and register it at the
     end of `runDataHeals()`.
   - Use ONE `db.transaction`; FIRST claim the marker row in `data_heals` with
     `onConflictDoNothing`. No inserted row means skip (already ran or another
     instance claimed it).
   - Select only the previewed target rows with `.for("update")`.
   - For `brand_profiles`, bump `updatedAtMs` to
     `Math.max(stored + 1, Date.now())` so stale clients cannot republish the
     poison. Apply the same monotonic rule to `daily_sync` run-value stamps.
   - Restrict `daily_sync` repairs to today and future dates using a hard-coded
     date literal; past days are history unless separately approved.
   - For learned-alias deletes, scope the full key including context columns
     and delete mirrored `ai_corrections` rows.
6. **Verify in dev:** restart both API workflows (`API Server` and
   `artifacts/api-server: API Server`), confirm the marker in `data_heals`,
   re-query the target predicate, confirm excluded/manager-entered rows are
   unchanged, and confirm a restart does not apply a second change.
7. **Verify after publish:** check the same marker, target count, repaired
   values, LWW stamps, and preservation evidence against the live system using
   the approved read-only production procedure. Record “not verified” rather
   than implying success if access is unavailable.
8. Tell the user what will be cleaned up on the next publish and what evidence
   was or was not verified. Publishing is a separate decision; this skill does
   not publish automatically.

## Standard heal report

```text
Data heal: <safe marker id>
Diagnosis: <bug and evidence>
Affected scope: <tables/scopes/date boundary; target count>
Excluded scope: <valid/manager-entered rows protected>
Repair rule: <deterministic rule>
Dry-run: <query/evidence and before→after count>
Execution: <transaction + marker result>
Idempotency: <second-run result>
Rollback posture: <reversible evidence or explicit limitation>
Verification: <dev marker/count/value/LWW/preservation results>
Live verification: <result or not verified + reason>
Privacy: <minimal identifiers only; no sensitive values logged>
Unresolved items: <none or handoff>
```

## Reference and escalation

Full transaction pattern and past gotchas: `.agents/memory/one-time-data-heals.md`
and existing heals in `dataHeals.ts` (copy their structure).

- Use **import-bug-investigation** first when the source, parse, apply logic,
  pool, or profile layer is not established.
- Use **spec-import-guard** when the repair indicates a prompt, parser,
  sanitizer, alias, chunk/merge, link, or export regression; follow its
  versioning and test requirements.
- Use **wrong-number-triage** when the report is a displayed number and its
  stored source has not been traced.
- Return to **customer-import-audit** when a new customer import still needs
  a before/after landing report. Once poisoned rows are confirmed, hand that
  report's affected-row scope and manager-value evidence into this playbook.
