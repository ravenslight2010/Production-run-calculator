---
name: Pure test environments
description: Avoid unused DOM startup in source-only and pure calculation tests without weakening browser coverage or runtime gates.
---

Use an explicit Node test environment for source-inspection guards and pure
calculation tests whose imports and assertions do not depend on a browser
document. Keep DOM-dependent component/storage tests in their appropriate
environment.

**Why:** Focused reliability checks spent most of their elapsed time
initializing a browser-like environment even though their assertions used
only Node filesystem operations, pure permission decisions or mocked
pagination. That overhead can obstruct meaningful runtime evidence without
exercising any extra application behavior.

**How to apply:** Inspect imports and runtime globals before changing an
environment; a filename containing “render” is not evidence of actual DOM
testing. Preserve every case and assertion, verify the same checks after
the change, and retain real browser/component coverage separately. Scoped
timing improvements do not establish a complete-suite duration or authorize
larger budgets, weaker isolation or altered worker limits.
