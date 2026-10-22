---
name: Vitest hook cleanup returns
description: Avoid accidental mock teardown callbacks when setting up Vitest fixtures.
---

Use a braced, void-returning hook when resetting mocks; do not implicitly return a mock function from `beforeEach`.

**Why:** Current Vitest treats a returned function as cleanup. Returning a mock unintentionally invokes its later implementation after the test, which can produce unexplained rejected promises even when the expected rejection assertion passed.

**How to apply:** Write `beforeEach(() => { mock.mockReset().mockResolvedValue([]); });`. When a test fails after its assertions with a mock's original error, check hook return values before changing production recovery behavior.
