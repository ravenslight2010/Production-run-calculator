---
name: Playwright list-mode discovery
description: Fixture requirements that apply when collecting test identities without executing browser tests.
---

Playwright `--list --reporter=json` still imports the selected spec modules. When a spec requires an API origin at module load, identity discovery needs a non-empty placeholder API URL even though no browser or API service should start.

**Why:** The full-browser contract needs the real config's filtered test set, but importing its specs can enforce fixture setup before Playwright emits discovery JSON.

**How to apply:** Set harmless local placeholder base and API origins for list-only discovery; keep the command in list mode so it does not execute tests, start services, or run global setup.