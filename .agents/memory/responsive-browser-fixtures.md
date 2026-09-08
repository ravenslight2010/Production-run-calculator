---
name: Responsive browser fixture boundaries
description: Durable browser-test rules for preview chrome, modal identity, and input modality across responsive viewport projects.
---

Responsive layout fixtures must distinguish application geometry from Replit preview chrome, target the intended modal explicitly, and match the configured browser input modality.

**Why:** Fixed preview wrappers can look like app overlays, generic dialog selectors can bind to a still-mounted parent dialog, and desktop Chromium does not support Playwright touch APIs unless the project enables touch.

**How to apply:** Exclude preview-banner descendants from overlap assertions, open or identify the exact dialog under test, and use click for desktop projects unless a touch-enabled context is intentional.