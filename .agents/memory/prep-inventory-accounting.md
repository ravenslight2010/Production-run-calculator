---
name: Prep inventory charge ownership
description: Owner-approved physical accounting boundary for prep ingredients and prepared carry.
---

Charge raw ingredients when prep is made; later runs consume prepared stock, not
the raw ingredients again. Previously made carry must not incur a second raw charge.

**Why:** On 2026-10-22 the owner explicitly selected this rule instead of retaining
raw-ingredient deductions at run completion.

**How to apply:** Preserve one audited prep event and its prepared-stock handoff
through retries, subsequent dates and saved-run corrections. Do not enable a new
day-start raw deduction without the corresponding completion handoff.
