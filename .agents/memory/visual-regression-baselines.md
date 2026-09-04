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

Full-page screenshots of large live Summary surfaces can consume substantial
browser time and memory; prefer viewport-scoped captures when the assertion is
about visible layout rather than the entire document.

**Why:** A release browser run once spent its remaining budget capturing a
large live surface even though the visual contract only covered the viewport.

**How to apply:** Scope screenshots to the intended viewport or component
region in visual and release evidence tests, while retaining full-page
captures only when document extent is itself the behavior under test.

The full destructive browser configuration can use stricter screenshot defaults
than the dedicated visual configuration; keep the reviewed diff tolerance
explicit on each visual assertion so both runners enforce the same contract.

**Why:** A harmless 36-pixel capture variance failed the full release run even
though the isolated visual suite passed under its reviewed tolerance.

**How to apply:** When the dedicated visual config has an approved
`maxDiffPixels`/`threshold`, mirror those values in the visual assertions used
by the full browser suite; never regenerate baselines solely to clear capture
variance.