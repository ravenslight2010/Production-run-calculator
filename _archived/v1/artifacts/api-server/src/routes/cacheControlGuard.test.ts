// Regression guard for the NEGATIVE case: a brand-new GET that ships cacheable.
//
// The structural/integration guards prove every shared-list GET the router
// already serves sends no-store. What they did NOT prove is that the no-store
// rule actually OVERRIDES a handler that explicitly sets its own cacheable
// Cache-Control header. `noStoreMiddleware` runs BEFORE the handler, so without
// a flush-time re-stamp a developer could add a brand-new GET that does
// `res.setHeader("Cache-Control", "max-age=…")` and silently ship it cacheable —
// reintroducing the stale-data bug with no failing test.
//
// This test stands up a tiny Express app (no database, no real routes) wired to
// the REAL `noStoreMiddleware`, registers synthetic GETs that try to ship
// cacheable in every way a handler realistically could, and asserts the
// middleware forces no-store anyway. The only escape hatch is adding the route
// to CACHE_CONTROL_EXCLUSIONS (guarded separately by cacheControlCoverage.test).
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { noStoreMiddleware } from "../lib/cacheControl";

const NO_STORE = "no-store, no-cache, must-revalidate";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(noStoreMiddleware);

  // A brand-new shared-data GET whose handler ACCIDENTALLY sets a cacheable
  // header via res.setHeader, then sends JSON. The middleware must win.
  app.get("/brand-new-shared-list", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.json({ ok: true });
  });

  // Same intent, but the cacheable header is set via res.set after some work.
  app.get("/brand-new-via-set", (_req, res) => {
    res.set("Cache-Control", "max-age=600").json({ ok: true });
  });

  // Same intent, but the cacheable header is passed through res.writeHead's
  // headers object — the other realistic way a handler ships cacheable.
  app.get("/brand-new-via-writehead", (_req, res) => {
    res.writeHead(200, {
      "Cache-Control": "max-age=120",
      "Content-Type": "application/json",
    });
    res.end(JSON.stringify({ ok: true }));
  });

  // A plain brand-new GET that sets no cache header at all: the middleware's
  // on-by-default behavior must still produce no-store.
  app.get("/brand-new-plain", (_req, res) => {
    res.json({ ok: true });
  });

  // A route on the exclusion list (/healthz) that sets a cacheable header: the
  // exclusion must be honored, proving the guard is targeted, not blanket.
  app.get("/healthz", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=30");
    res.json({ ok: true });
  });

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function getHeaders(pathname: string): Promise<Headers> {
  const res = await fetch(`${baseUrl}${pathname}`);
  await res.arrayBuffer(); // drain so the socket is released
  return res.headers;
}

describe("noStoreMiddleware forces no-store even when a handler ships cacheable", () => {
  it("overrides a cacheable Cache-Control set via res.setHeader", async () => {
    const headers = await getHeaders("/brand-new-shared-list");
    expect(headers.get("cache-control")).toBe(NO_STORE);
    expect(headers.get("pragma")).toBe("no-cache");
    expect(headers.get("expires")).toBe("0");
  });

  it("overrides a cacheable Cache-Control set via res.set", async () => {
    const headers = await getHeaders("/brand-new-via-set");
    expect(headers.get("cache-control")).toBe(NO_STORE);
  });

  it("overrides a cacheable Cache-Control passed via res.writeHead headers", async () => {
    const headers = await getHeaders("/brand-new-via-writehead");
    expect(headers.get("cache-control")).toBe(NO_STORE);
    expect(headers.get("pragma")).toBe("no-cache");
    expect(headers.get("expires")).toBe("0");
  });

  it("applies no-store by default to a brand-new GET that sets no cache header", async () => {
    const headers = await getHeaders("/brand-new-plain");
    expect(headers.get("cache-control")).toBe(NO_STORE);
  });
});

describe("noStoreMiddleware honors the exclusion list (escape hatch is deliberate)", () => {
  it("leaves an excluded route's cacheable header untouched", async () => {
    const headers = await getHeaders("/healthz");
    expect(headers.get("cache-control")).toBe("public, max-age=30");
    // And it must NOT have been forced to no-store.
    expect(headers.get("cache-control")).not.toBe(NO_STORE);
  });
});
