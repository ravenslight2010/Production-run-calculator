---
name: Release evidence isolation
description: Browser release configs must opt into disposable database mode whenever fixtures clean shared day-state or users.
---

Every browser suite that mutates cleanup state must carry an explicit disposable-test guard in both its launcher and fixture setup.

**Why:** A suite can look non-destructive while its setup still deletes live-day rows; missing launcher flags caused false release failures and unsafe ambiguity.

**How to apply:** Keep isolation guards mandatory, pass approved test-mode variables consistently, and retain failures as no-go evidence rather than weakening setup.