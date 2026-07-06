// Guards the central JSON error handler added in app.ts.
//
// Regression context: the app had NO error-handling middleware, so a thrown
// route error — or a body-parser PayloadTooLargeError / JSON SyntaxError — fell
// through to Express's DEFAULT handler and produced an HTML stack-trace page.
// Clients parse error bodies as JSON (`res.json().error`), so an HTML response
// left them with only the bare status code; a failed schedule import surfaced
// as an undiagnosable "error 500" toast. This test locks in that error
// responses are JSON with an `error` string and the right status.
//
// These paths (oversized body → 413, malformed JSON → 400) are triggered inside
// the body parser BEFORE the router/auth/DB run, so no database is needed.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Silence the pino logger (and avoid spinning up its transport worker).
vi.mock("./lib/logger", async () => {
  const pino = (await import("pino")).default;
  return { logger: pino({ enabled: false }) };
});

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = (await import("./app")).default;
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("central JSON error handler", () => {
  it("returns a JSON { error } (not an HTML page) for an oversized body → 413", async () => {
    const huge = JSON.stringify({ payload: { blob: "x".repeat(11 * 1024 * 1024) } });
    const res = await fetch(`${baseUrl}/api/sync/2099-01-01`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: huge,
    });
    expect(res.status).toBe(413);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = (await res.json()) as { error?: unknown };
    expect(typeof body.error).toBe("string");
    expect(body.error).not.toMatch(/</); // no HTML/stack leaking through
  });

  it("returns a JSON { error } for malformed JSON → 400", async () => {
    const res = await fetch(`${baseUrl}/api/sync/2099-01-01`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "{ not valid json",
    });
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = (await res.json()) as { error?: unknown };
    expect(typeof body.error).toBe("string");
  });
});
