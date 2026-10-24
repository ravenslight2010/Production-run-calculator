import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fetchImportGoldLocal, importGoldEndpoint, isImportGoldLocalConfigured } from "./importGoldEndpoint";

describe("same-host Import Gold endpoint", () => {
  it("distinguishes disabled, valid configuration and invalid configuration without a live probe", () => {
    expect(isImportGoldLocalConfigured({})).toBe(false);
    expect(isImportGoldLocalConfigured({ IMPORT_GOLD_LOCAL_ENABLED: "true" })).toBe(true);
    expect(isImportGoldLocalConfigured({ IMPORT_GOLD_LOCAL_BASE_URL: "http://localhost:1/v1" })).toBe(true);
    expect(isImportGoldLocalConfigured({ IMPORT_GOLD_LOCAL_BASE_URL: "http://169.254.169.254/v1" })).toBe(false);
    expect(isImportGoldLocalConfigured({ IMPORT_GOLD_LOCAL_ENABLED: "true", IMPORT_GOLD_LOCAL_BASE_URL: "" })).toBe(false);
  });
  it.each([
    ["http://localhost:11434/v1", "http://127.0.0.1:11434/v1/chat/completions"],
    ["http://127.0.0.1:11434/v1/", "http://127.0.0.1:11434/v1/chat/completions"],
    ["http://[::1]:11434/v1", "http://[::1]:11434/v1/chat/completions"],
    ["http://2130706433/v1", "http://127.0.0.1/v1/chat/completions"],
  ])("pins accepted loopback %s without DNS", (base, expected) => {
    expect(importGoldEndpoint(base).href).toBe(expected);
  });

  it.each([
    "https://127.0.0.1/v1", "file:///tmp/model", "http://169.254.169.254/",
    "http://10.0.0.1/v1", "http://127.0.0.2/v1", "http://[::ffff:127.0.0.1]/v1",
    "http://[::]/v1", "http://localhost.example/v1", "http://localhost./v1",
    "http://user:password@127.0.0.1/v1", "http://127.0.0.1/v1?token=private",
    "http://127.0.0.1/v1#private", "not a URL",
  ])("rejects unsafe or ambiguous configuration without echoing it: %s", (base) => {
    expect(() => importGoldEndpoint(base)).toThrow(/^provider_unavailable$/);
  });

  it.each([301, 302, 303, 307, 308])("never follows a %s redirect, including a same-host one", async (status) => {
    let redirectedRequests = 0;
    const server = createServer((req, res) => {
      if (req.url === "/v1/chat/completions") {
        res.writeHead(status, { location: "/private" }).end();
      } else {
        redirectedRequests += 1;
        res.end("must not reach");
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const port = (server.address() as AddressInfo).port;
      await expect(fetchImportGoldLocal(`http://localhost:${port}/v1`, {
        method: "POST", body: "synthetic", signal: AbortSignal.timeout(2000),
      })).rejects.toThrow();
      expect(redirectedRequests).toBe(0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("honors request cancellation before contacting a provider", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(fetchImportGoldLocal("http://127.0.0.1:1/v1", {
      method: "POST", body: "synthetic", signal: controller.signal,
    })).rejects.toHaveProperty("name", "AbortError");
  });
});
