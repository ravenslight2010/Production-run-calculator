import { describe, expect, it } from "vitest";
import { requireLocalFixtureApiOrigin } from "../e2e/isolatedApiOrigin";

describe("requireLocalFixtureApiOrigin", () => {
  it("accepts a loopback API origin for the isolated browser server", () => {
    expect(
      requireLocalFixtureApiOrigin("fixture setup", "http://127.0.0.1:18081"),
    ).toBe("http://127.0.0.1:18081");
    expect(
      requireLocalFixtureApiOrigin("fixture setup", "http://[::1]:18081/"),
    ).toBe("http://[::1]:18081");
  });

  it.each([
    undefined,
    "",
    "https://shared.example.test",
    "http://192.168.1.20:8080",
    "http://127.0.0.1:8080/api",
  ])("rejects an unsafe or ambiguous fixture API origin: %s", (origin) => {
    expect(() =>
      requireLocalFixtureApiOrigin("fixture setup", origin),
    ).toThrow(/PLAYWRIGHT_API_BASE_URL/);
  });
});