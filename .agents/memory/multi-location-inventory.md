---
name: Multi-location inventory + transfer warnings
description: Mental model for named stock locations, onsite-only drawdown, and transfer-need warnings across server/web/mobile.
---

# Multi-location inventory

Stock lives in named locations; a lot with **`null` locationId means onsite** (the implicit default). There is always exactly one onsite location.

**Why:** floor staff run the line off on-site/line stock; stock in other buildings/coolers must be physically transferred before it can be used, so production must never silently consume it.

**Decisions / invariants to keep consistent:**
- Production drawdown (consume + manual adjust) is **onsite-only**. Any new finalization/consumption path must respect that filter.
- Every stock-intake path must let the user pick a destination location — manual restock AND AI photo intake both commit through the same restock endpoint carrying an optional locationId (omitted = onsite default). When adding a third intake path, thread the location selector through too.
- Transfer = atomic per-lot move that preserves expiration and writes paired ledger entries.
- Transfer-need warnings are PURE shared math (`@workspace/inventory-math`): demand is aggregated across ALL of the day's runs and compared against onsite stock; warn (capped at the shortfall) when offsite locations hold transferable stock. Web and mobile must call it on the SAME basis or warnings diverge.

**Parity gotcha (replit.md rule):** mobile color palette has no `info` key (use `colors.primary`); mobile location pickers use the bottom-sheet `SelectField` where web uses native `<select>`. Keep both apps' behavior/math identical.
