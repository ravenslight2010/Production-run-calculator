---
name: Web+mobile navigation structure
description: The agreed 6-tab + header-menu layout shared by both run-calculator apps; what belongs where.
---

# Navigation structure (web + mobile parity)

Both `run-calculator` (web) and `run-calculator-mobile` use the SAME navigation: 6 bottom tabs + a header menu. Any nav change must be mirrored in both.

**Bottom tabs:** Run (current + upcoming runs), Dough/Crusts (supply steppers + dough/crust output), Sauce (sauce needs), Frontline (applicator + pepperoni needs), Packaging (packaging steppers + freezer + output), Warehouse (aggregated needs across all not-ended runs + production schedule).

**Header menu (dropdown/sheet, not a tab):** Stoppages, Summary, Setup (per-run config + recipe editors + templates), Settings (app-level: supervisor PIN, master data, reset).

**Why:** User explicitly wanted both apps identical in layout. Calculations/formulas, RunContext sync, and stored state shape must stay unchanged — this is purely a UI reorg.

**How to apply (web specifics):**
- Web is a single `Tabs value={activeTab}` system inside `src/pages/home.tsx`. Tabs are switched via `activeTab` state, NOT URLs.
- Settings is NOT a TabsContent panel — it reuses the existing "Manage Lists & Settings" dialog (`setShowManageDialog(true)`).
- There are intentionally TWO `TabsContent value="setup"` panels (gated `isSupervisor` vs `!isSupervisor`); Radix renders both but their content is mutually exclusive. Do NOT add overlapping RHF-bound fields across panels — moved steppers must appear once only (double-registration corrupts form state).
