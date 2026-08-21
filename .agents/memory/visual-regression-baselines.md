---
name: Visual regression baselines
description: Playwright screenshot coverage must use an isolated config and explicit snapshot updates.
---

Visual snapshots should run through a dedicated Playwright config that avoids
destructive global setup, uses unique disposable accounts, masks changing
content, and never enables snapshot updates implicitly.

**Why:** The main browser suite resets shared live-day state, while visual
comparisons need repeatable layout fixtures and a deliberate review step for
baseline changes.

**How to apply:** Keep visual config/test data isolated from behavioral E2E
fixtures; document the exact update command and inspect diff artifacts before
accepting regenerated images.