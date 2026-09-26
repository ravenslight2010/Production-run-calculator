import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: new Map<string, unknown[]>(),
  scope: "test-scope",
}));

vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ column, value }),
}));

vi.mock("@workspace/db", () => {
  const table = (kind: string) => ({ kind, scope: { kind: `${kind}-scope` } });
  const ingredientsTable = table("ingredients");
  const doughRecipesTable = table("doughRecipes");
  const sauceRecipesTable = table("sauceRecipes");
  const cheeseRecipesTable = table("cheeseRecipes");
  const mixesTable = table("mixes");
  return {
    db: {
      select: () => ({
        from: (selected: { kind: string }) => ({
          where: () => Promise.resolve(state.rows.get(selected.kind) ?? []),
        }),
      }),
    },
    ingredientsTable,
    doughRecipesTable,
    sauceRecipesTable,
    cheeseRecipesTable,
    mixesTable,
  };
});

vi.mock("../lib/requestScope", () => ({
  currentScope: () => state.scope,
}));

import { noStoreMiddleware } from "../lib/cacheControl";

type MasterDataBootstrapModule = typeof import("./masterDataBootstrap");

let router: MasterDataBootstrapModule["default"];
let invalidateMasterDataBootstrapCache: MasterDataBootstrapModule["invalidateMasterDataBootstrapCache"];

const initialRows = {
  ingredients: [{ id: "i1", name: "Flour" }],
  doughRecipes: [{ id: "d1", name: "Dough" }],
  sauceRecipes: [{ id: "s1", name: "Sauce" }],
  cheeseRecipes: [{ id: "c1", name: "Cheese" }],
  mixes: [{ id: "m1", name: "Mix" }],
};

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  // This suite asserts cache-hit semantics, so it must run with the cache
  // enabled. `E2E_TEST_DB=1` sets CACHE_TTL_MS to 0 (see
  // masterDataBootstrap.ts) so E2E runs always read fresh rows, and the
  // release workflow exports that flag job-wide. Loading the router with the
  // flag set would silently turn "invalidates only the mutated scope" into a
  // no-op that always recomputes and then fails on a stale validator. Pin the
  // flag off before the module is evaluated, so the suite tests the cache in
  // every workflow rather than depending on ambient job env.
  vi.stubEnv("E2E_TEST_DB", "0");
  ({ default: router, invalidateMasterDataBootstrapCache } = await import("./masterDataBootstrap"));

  const app = express();
  app.use(noStoreMiddleware);
  app.use(router);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => {
  state.rows = new Map(Object.entries(initialRows));
  state.scope = "test-scope";
  invalidateMasterDataBootstrapCache("test-scope");
  invalidateMasterDataBootstrapCache("scope-a");
  invalidateMasterDataBootstrapCache("scope-b");
});

afterAll(async () => {
  vi.unstubAllEnvs();
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /master-data/bootstrap transport savings", () => {
  it("compresses the catalog and returns 304 for an unchanged representation", async () => {
    const first = await fetch(`${baseUrl}/master-data/bootstrap`, {
      headers: { "accept-encoding": "gzip" },
    });
    const firstBytes = Buffer.byteLength(JSON.stringify({
      ingredients: initialRows.ingredients,
      doughRecipes: initialRows.doughRecipes,
      sauceRecipes: initialRows.sauceRecipes,
      cheeseRecipes: initialRows.cheeseRecipes,
      mixes: initialRows.mixes,
    }));
    const compressedBytes = Number(first.headers.get("content-length"));
    const etag = first.headers.get("etag");

    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("private, max-age=0, must-revalidate");
    expect(first.headers.get("vary")).toBe("Accept-Encoding");
    expect(first.headers.get("content-encoding")).toBe("gzip");
    expect(compressedBytes).toBeLessThan(firstBytes);
    expect(etag).toMatch(/^W\/"master-data-/);
    await first.arrayBuffer();

    const unchanged = await fetch(`${baseUrl}/master-data/bootstrap`, {
      headers: {
        "accept-encoding": "gzip",
        "if-none-match": etag as string,
      },
    });

    expect(unchanged.status).toBe(304);
    expect(unchanged.headers.get("etag")).toBe(etag);
    expect(unchanged.headers.get("content-encoding")).toBe("gzip");
    await unchanged.arrayBuffer();
  });

  it("returns a new representation after a manager mutation invalidates the scope", async () => {
    const first = await fetch(`${baseUrl}/master-data/bootstrap`, {
      headers: { "accept-encoding": "gzip" },
    });
    const oldEtag = first.headers.get("etag");
    await first.arrayBuffer();

    state.rows.set("mixes", [{ id: "m2", name: "Updated Mix" }]);
    invalidateMasterDataBootstrapCache("test-scope");

    const changed = await fetch(`${baseUrl}/master-data/bootstrap`, {
      headers: {
        "accept-encoding": "gzip",
        "if-none-match": oldEtag as string,
      },
    });
    const body = await changed.json() as { mixes: Array<{ id: string }> };

    expect(changed.status).toBe(200);
    expect(changed.headers.get("etag")).not.toBe(oldEtag);
    expect(body.mixes).toEqual([{ id: "m2", name: "Updated Mix" }]);
  });

  it("invalidates only the mutated scope", async () => {
    state.scope = "scope-a";
    state.rows.set("mixes", [{ id: "a1", name: "Scope A Mix" }]);
    const scopeA = await fetch(`${baseUrl}/master-data/bootstrap`);
    const scopeAEtag = scopeA.headers.get("etag");
    await scopeA.arrayBuffer();

    state.scope = "scope-b";
    state.rows.set("mixes", [{ id: "b1", name: "Scope B Mix" }]);
    const scopeB = await fetch(`${baseUrl}/master-data/bootstrap`);
    const scopeBEtag = scopeB.headers.get("etag");
    await scopeB.arrayBuffer();

    state.scope = "scope-a";
    state.rows.set("mixes", [{ id: "a2", name: "Updated Scope A Mix" }]);
    invalidateMasterDataBootstrapCache("scope-a");
    const changedA = await fetch(`${baseUrl}/master-data/bootstrap`, {
      headers: { "if-none-match": scopeAEtag as string },
    });
    expect(changedA.status).toBe(200);
    await changedA.arrayBuffer();

    state.scope = "scope-b";
    const unchangedB = await fetch(`${baseUrl}/master-data/bootstrap`, {
      headers: { "if-none-match": scopeBEtag as string },
    });
    expect(unchangedB.status).toBe(304);
    await unchangedB.arrayBuffer();
  });

  it("uses different validators for identical content in different scopes", async () => {
    state.scope = "scope-a";
    const scopeA = await fetch(`${baseUrl}/master-data/bootstrap`);
    const scopeAEtag = scopeA.headers.get("etag");
    await scopeA.arrayBuffer();

    state.scope = "scope-b";
    const scopeB = await fetch(`${baseUrl}/master-data/bootstrap`, {
      headers: { "if-none-match": scopeAEtag as string },
    });

    expect(scopeB.status).toBe(200);
    expect(scopeB.headers.get("etag")).not.toBe(scopeAEtag);
    await scopeB.arrayBuffer();
  });

  it("does not compress clients that opt out", async () => {
    const response = await fetch(`${baseUrl}/master-data/bootstrap`, {
      headers: { "accept-encoding": "identity" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-encoding")).toBeNull();
    await response.arrayBuffer();
  });
});