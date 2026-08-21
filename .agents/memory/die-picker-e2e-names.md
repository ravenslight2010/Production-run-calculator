---
name: Die picker E2E names
description: Canonical die labels that browser tests must use when seeding the factory die pool.
---

The live die-type pool canonicalizes `12`, `12" dies`, and related variants to `12"`. Browser tests that seed die options through the API should use the canonical label when locating the picker button.

**Why:** The run form intentionally folds duplicate physical-die spellings; asserting an imported spelling such as `12" Dies` makes an otherwise valid browser test fail because that button is never rendered.

**How to apply:** Seed both the local cache and authenticated die-type API with canonical labels, then assert the exact rendered picker text.