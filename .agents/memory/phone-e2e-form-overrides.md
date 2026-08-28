---
name: Phone E2E form overrides
description: Reliable setup of server-backed run fixtures in phone browser tests
---

Server-backed reloads can reconcile run records while the live form autosave restores
default numeric values, so localStorage-only overrides are not reliable for browser
fixtures. Apply post-reload overrides through the form's controlled input events,
including hidden setup inputs when the live layout keeps them out of view.

**Why:** A test can appear to have seeded valid line-speed settings while the browser
actually runs with zero cases-per-skid, zero pizzas-per-case, or zero line speed.

**How to apply:** Keep run timestamps and durable day-state setup in the fixture
storage path, then reapply numeric scenario values after reload before exercising
live tabs.