---
name: Vite 8 config-loader compatibility
description: Vite 8 warns about extensionless local imports in configs because native config loading may become the default.
---

Vite 8 still supports the bundled config loader, but local imports in Vite configs should include their file extensions so the configuration remains compatible with the planned native loader.

**Why:** Vite 8 reports extensionless config imports as future-compatibility warnings, which can become startup failures when native loading becomes the default.

**How to apply:** When adding or changing local imports in Vite config files, use explicit `.ts`/`.js` extensions and verify both typecheck and dev startup.