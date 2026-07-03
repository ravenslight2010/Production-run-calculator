---
name: HMR dual-context crash from mixed exports
description: Why app-level React context files must export only components (Fast Refresh rule), and the dev globalThis singleton guard.
---

**Rule:** Any web-app module that exports a context Provider component must NOT also export non-component values (the raw context, hooks like `useAuth`). Keep the `createContext` object + consumer hook in a separate component-free module.

**Why:** Mixed exports break React Fast Refresh's boundary rule. Combined with the known Replit-proxy HMR websocket drop/reconnect, a partial invalidation can evaluate the module twice — the mounted Provider uses one context object while the consumer hook reads the other, so consumers get null and crash ("must be used within a Provider") even though the Provider IS an ancestor. Seen in production-use of the dev preview (auto-captured incidents from HomeGate); impossible in a production build but staff actively use the dev preview.

**How to apply:**
- Auth: context + `useAuth` live in `useAuth.ts`; `AuthContext.tsx` exports only `AuthProvider`. Keep future non-component exports out of provider files.
- Belt-and-braces: the auth context is additionally stashed on a `globalThis` singleton in dev (`import.meta.env.DEV`), so even a dual instantiation of the core module shares one context object. A regression test simulates this via `vi.resetModules()` + double dynamic import.
- Stock shadcn UI files (sidebar/form/chart/carousel/toggle-group) also mix exports but are component-local (provider + consumer in the same file/subtree) — an HMR split re-instantiates both sides together, so they were intentionally left alone.
