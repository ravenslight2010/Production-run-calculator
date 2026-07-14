---
name: Physical line station order
description: Applicator/pep display + import slot rule — App 1, App 2, peps, App 3, App 4
---

The physical production line runs: **Applicator 1 → Applicator 2 → pep/stick applicators → Applicator 3 → Applicator 4**. The pep applicators sit BETWEEN stations 2 and 3.

**Why:** The user (factory) wants every list, form, and screen to mirror the real line so floor staff read top-to-bottom in walk order. Explicit instruction: "that's how it needs to be everywhere."

**How to apply:**
- Any UI that lists applicators + peps (run form setup, Setup Profiles editor, needs/warehouse lists, run summary cards, station screens) must render App 1, App 2, then the pep blocks, then App 3, App 4 — never apps 1-4 followed by peps.
- The spec importer supports this via `ParsedApplicator.slot` (optional 1-4): lib canonicalization drops invalid slots, and `assignApplicatorSlots` (in `@workspace/spec-import`) arranges the parse into a dense 4-station array (explicit slots claim first, rest fill in listed order, empty-type holes are skipped downstream). `applicatorsEqual` compares slot so re-import pruning doesn't discard slot-only changes.
- The parse prompt makes slots MANDATORY whenever a profile has pep/stick entries (user instruction 2026-07-14: "the sheet's layout is how it needs to be imported"): applicators listed BEFORE the pep rows are stations 1/2 in order, AFTER are 3/4 in order — e.g. one applicator, pep, one applicator = slots 1 and 3, NOT 1 and 2. `slot` is omitted only when a profile has no pep entries and no station labels. Any prompt change here must bump `SPEC_PARSE_VERSION` (web `specImport.ts`) or cached re-imports keep the old behavior. Verified live 2026-07-14 with a real `/ai/parse-spec-sheet` call (app→pep→app sheet returned slots 1 and 3).
