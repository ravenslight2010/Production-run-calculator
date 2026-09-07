import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_USER_RATE_MAX,
  DEFAULT_USER_RATE_WINDOW_MS,
  fixedWindowPerUserPolicy,
} from "./fixedWindowPolicy";

describe("fixedWindowPerUserPolicy", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("provides the shared bounded-operation defaults", () => {
    expect(DEFAULT_USER_RATE_WINDOW_MS).toBe(60_000);
    expect(DEFAULT_USER_RATE_MAX).toBe(10);
  });

  it("creates an Express middleware without requiring a production store", () => {
    process.env.NODE_ENV = "test";
    expect(typeof fixedWindowPerUserPolicy("example-operation")).toBe("function");
  });
});