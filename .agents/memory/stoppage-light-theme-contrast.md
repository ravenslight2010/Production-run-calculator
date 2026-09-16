---
name: Stoppage light-theme contrast
description: Light operational stoppage surfaces need darker orange tokens than the dark theme uses.
---

Light stoppage rows use pale violet/orange surfaces with darker foregrounds; the project's orange-700 token is below the normal-text contrast threshold on those surfaces, while orange-800 passes.

**Why:** The custom orange palette is lighter than the stock Tailwind scale suggests, so a seemingly dark orange label can still fail axe on a light surface.

**How to apply:** Keep the established orange-400 treatment for dark operational backgrounds, and use orange-800 for light active/completed stop labels and icons. Preserve the explicit light/dark pair in contrast fixtures.