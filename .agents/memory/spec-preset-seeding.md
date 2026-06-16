---
name: Spec preset seeding (brand+flavor profiles)
description: How imported pizza-spec presets are seeded into web + mobile, and the rules that keep re-runs safe.
---

# Spec preset seeding

Imported pizza recipe spreadsheets are seeded as brand+flavor PRESETS (profiles) into
both the web (`run-calculator`, canonical) and mobile (`run-calculator-mobile`, Expo) apps.

## What is imported (product decision)
Only **sauce oz/pizza, applicators (+cheese sub-recipes), and pepperoni** are imported.
**Target weight and spec ranges are intentionally SKIPPED** — confirmed by the user.
A future "import everything" request must revisit this deliberate exclusion.

## Seeding rules — keep these invariant
- **One-time marker guard.** Seeding runs once, gated by a version marker
  (web: localStorage; mobile: AsyncStorage). Bump the marker only when you intend a
  fresh re-seed for all existing users; otherwise user-deleted brands/flavors/profiles
  would reappear, which is the bug the marker prevents.
- **Only-if-absent profile writes.** Each brand+flavor profile is written only when its
  key is missing. Never overwrite an existing profile — user edits must survive a re-seed.
- **Additive, case-insensitive list merges.** Brands, flavors, applicator types, pep
  types, cheese ingredients all merge case-insensitively so a differently-cased existing
  label (`four hands` vs `Four Hands`) does not create a duplicate.

**Why:** the apps sync/persist user state; a naive re-seed or case-sensitive merge would
either clobber user data or pollute lists with duplicates.

## Parity
Web and mobile must stay behaviorally identical (see replit.md). Surface difference:
web also seeds an applicator master list; mobile has no equivalent master-list field.

## HARD constraints respected
Do NOT change formulas, RunContext sync, or stored state shape (no new
RunSettings/FormValues fields) when touching seeding.

## Gotcha — verifying in e2e
The brand/flavor pickers are filtering text inputs that pre-fill with the current
selection on open, so the list filters to that one item; clear the input to see all.
The Setup screen's weight fields are gated behind a Supervisor PIN (Operator mode hides
them) — confirm loaded profile values via the Run-page applicator breakdown instead.
