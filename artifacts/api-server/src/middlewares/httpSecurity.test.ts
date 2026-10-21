import { createServer, type Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express, { type Express } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CONTENT_SECURITY_POLICY,
  httpSecurityHeaders,
} from "./httpSecurity";

let staticRoot: string;

beforeAll(async () => {
  staticRoot = await mkdtemp(path.join(os.tmpdir(), "api-http-security-"));
  await writeFile(path.join(staticRoot, "index.html"), "<!doctype html><title>test</title>");
});

afterAll(async () => {
  if (staticRoot) await rm(staticRoot, { recursive: true, force: true });
});

async function withServer<T>(
  app: Express,
  run: (origin: string) => Promise<T>,
): Promise<T> {
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Test server did not bind to a TCP port");
  }
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

function createTestApp(): Express {
  const app = express();
  app.use(httpSecurityHeaders);
  app.get("/api/auth-transport", (req, res) => {
    res.json({
      authorization: req.get("authorization") ?? null,
      cookie: req.get("cookie") ?? null,
    });
  });
  app.use(express.static(staticRoot));
  return app;
}

describe("HTTP security headers", () => {
  it.each([
    ["API response", "/api/auth-transport"],
    ["static response", "/index.html"],
  ])("sets compatible headers on %s", async (_label, route) => {
    await withServer(createTestApp(), async (origin) => {
      const response = await fetch(`${origin}${route}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
      expect(response.headers.get("x-frame-options")).toBe("DENY");
      expect(response.headers.get("content-security-policy")).toBe(CONTENT_SECURITY_POLICY);
      // Express is commonly behind a TLS-terminating platform proxy; it does
      // not infer HSTS eligibility from NODE_ENV or forwarded request headers.
      expect(response.headers.get("strict-transport-security")).toBeNull();
    });
  });

  it("keeps the policy limited to the app's required external resources and denies framing", () => {
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
    expect(CONTENT_SECURITY_POLICY).toContain("https://fonts.googleapis.com");
    expect(CONTENT_SECURITY_POLICY).toContain("https://fonts.gstatic.com");
    expect(CONTENT_SECURITY_POLICY).toContain("https://api.qrserver.com");
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/(?:^|\s)https:(?:\s|;|$)/);
  });
});
