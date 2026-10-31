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
import express from "express";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { enhancedErrorMessages } from "./middlewares/errorMessagesEnhanced";

// Silence the pino logger (and avoid spinning up its transport worker).
vi.mock("./lib/logger", async () => {
  const pino = (await import("pino")).default;
  return { logger: pino({ enabled: false }) };
});

let server: Server;
let baseUrl: string;
let nonErrorServer: Server;
let nonErrorBaseUrl: string;
const requestErrorLog = vi.fn();

beforeAll(async () => {
  const app = (await import("./app")).default;
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  // Keep these deliberately failing routes out of the production app while
  // sending their raw rejection values through the same terminal middleware.
  const nonErrorApp = express();
  nonErrorApp.get("/api/test-error/string", async () => {
    throw "sensitive string details";
  });
  nonErrorApp.get("/api/test-error/object", async () => {
    throw { message: "sensitive object details", stack: "SECRET_STACK_TRACE" };
  });
  nonErrorApp.get("/api/inventory/items/:itemId/fail", (req, _res, next) => {
    // Simulate the server-owned ID normally installed by observability middleware.
    (req as typeof req & { correlationId?: string }).correlationId = "018f3a8b-1b2c-4d3e-8f90-123456789abc";
    Object.defineProperty(req, "log", { value: { error: requestErrorLog } });
    next(new Error("sensitive operation details"));
  });
  nonErrorApp.use(enhancedErrorMessages);
  await new Promise<void>((resolve) => {
    nonErrorServer = nonErrorApp.listen(0, () => {
      const { port } = nonErrorServer.address() as AddressInfo;
      nonErrorBaseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (nonErrorServer) {
    await new Promise<void>((resolve) => nonErrorServer.close(() => resolve()));
  }
});

describe("central JSON error handler", () => {
  it.each([
    ["application/json", JSON.stringify({ fixture: "x".repeat(9 * 1024) })],
    ["application/x-www-form-urlencoded", `fixture=${"x".repeat(9 * 1024)}`],
  ])("applies the smaller capture limit before the global parser for %s", async (contentType, payload) => {
    const res = await fetch(`${baseUrl}/api/profile-data/source-library-reconciliation/capture`, {
      method: "POST", headers: { "Content-Type": contentType }, body: payload,
    });
    expect(res.status).toBe(413);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(await res.json()).toHaveProperty("error");
  });

  it.each(["application/json", "application/x-www-form-urlencoded"])("does not lower the supported day-state transport limit for %s", async (contentType) => {
    const fixture = "x".repeat(1024 * 1024);
    const res = await fetch(`${baseUrl}/api/sync/2099-01-01`, {
      method: "PUT", headers: { "Content-Type": contentType },
      body: contentType === "application/json" ? JSON.stringify({ fixture }) : `fixture=${fixture}`,
    });
    // Parsing succeeds; ordinary authentication still rejects the fixture.
    expect(res.status).toBe(401);
  });

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

  it.each(["string", "object"] as const)(
    "safely handles a route rejection with a raw %s value",
    async (valueType) => {
      const res = await fetch(`${nonErrorBaseUrl}/api/test-error/${valueType}`);

      expect(res.status).toBe(500);
      expect(res.headers.get("content-type")).toMatch(/application\/json/);
      const body = (await res.json()) as { error?: unknown };
      expect(typeof body.error).toBe("string");
      expect(body.error).toBe(
        "Something went wrong on the server. Our team has been notified. Please try again later.",
      );
      expect(Object.keys(body)).toEqual(["error"]);
      expect(JSON.stringify(body)).not.toMatch(
        /sensitive string details|sensitive object details|SECRET_STACK_TRACE/,
      );
    },
  );

  it("retains safe error classification and operation correlation without logging record IDs", async () => {
    requestErrorLog.mockClear();
    const res = await fetch(`${nonErrorBaseUrl}/api/inventory/items/private-record-id/fail`);
    expect(res.status).toBe(500);
    expect(requestErrorLog).toHaveBeenCalledWith(expect.objectContaining({
      correlationId: expect.any(String),
      errorCategory: "server_error",
      operationType: "inventory",
      status: 500,
    }), "request errored");
    expect(JSON.stringify(requestErrorLog.mock.calls)).not.toMatch(/private-record-id|sensitive operation details/);
  });
});
