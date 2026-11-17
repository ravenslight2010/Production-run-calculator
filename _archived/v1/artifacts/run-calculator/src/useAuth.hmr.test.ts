// Regression coverage for the HMR dual-context crash: a Vite HMR partial
// reload can instantiate a module twice, and the old mixed AuthContext.tsx
// then held TWO different React context objects — the mounted Provider wrote
// to one while useAuth read from the other, crashing with "useAuth must be
// used within an AuthProvider" despite the Provider being an ancestor. The
// fix stashes the context on a globalThis singleton in dev, so even a
// re-instantiated module copy must resolve to the SAME context object.

import { describe, it, expect, vi } from "vitest";

describe("useAuth module — HMR dual-instance safety", () => {
  it("returns the same context object across module re-instantiations (dev)", async () => {
    const first = await import("./useAuth");
    // Simulate what an HMR partial reload does: a second live evaluation of
    // the same module source.
    vi.resetModules();
    const second = await import("./useAuth");

    expect(second).not.toBe(first); // genuinely two module instances
    expect(second.AuthContext).toBe(first.AuthContext); // ONE shared context
  });
});
