---
name: Cheese share oz basis needs full coverage
description: When choosing oz vs lbs as the share basis for cheese blend components
---

Rule: cheese component Share % may use the ozPerPizza basis only when EVERY lbs>0 component also has oz>0 (full coverage). Otherwise use lbs shares; partial oz is a last resort only when no usable lbs exist.

**Why:** Spec imports can leave stale/partial ozPerPizza on some rows (e.g. one component with oz, others without). Preferring oz whenever *any* row had oz produced wildly wrong Share % and 0-oz components on manager-curated lbs blends.

**How to apply:** Any new consumer of cheese component shares must go through `cheeseComponentShares` in `@workspace/cheese-recipes`, never re-derive its own oz/lbs preference. `stripInconsistentCheeseOz` (same lib) is the canonical de-poison check (partial coverage, or oz-share vs lbs-share ratio >3x / <1/3 → drop all oz); the one-time server heal `cheese-oz-depoison-v1` already ran it over stored rows. Web editor clears a row's ozPerPizza when the manager edits lbs.
