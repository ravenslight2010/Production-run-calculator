---
name: Physical line station order
description: Applicator/pep display + import slot rule — App 1, App 2, peps, App 3, App 4
---

The physical production line runs: **Applicator 1 → Applicator 2 → pep/stick applicators → Applicator 3 → Applicator 4**. The pep applicators sit BETWEEN stations 2 and 3.

**Why:** The user (factory) wants every list, form, and screen to mirror the real line so floor staff read top-to-bottom in walk order. Explicit instruction: "that's how it needs to be everywhere."

**How to apply:**
- Any UI that lists applicators + peps (run form setup, Setup Profiles editor, needs/warehouse lists, run summary cards, station screens) must render App 1, App 2, then the pep blocks, then App 3, App 4 — never apps 1-4 followed by peps.
- The spec importer supports this via `ParsedApplicator.slot` (optional 1-4): the AI parse prompt asks for a station only when discernible (esp. a topping listed after the pep rows → slot 3/4, never guess), lib canonicalization drops invalid slots, and `assignApplicatorSlots` (in `@workspace/spec-import`) arranges the parse into a dense 4-station array (explicit slots claim first, rest fill in listed order, empty-type holes are skipped downstream). `applicatorsEqual` compares slot so re-import pruning doesn't discard slot-only changes.
