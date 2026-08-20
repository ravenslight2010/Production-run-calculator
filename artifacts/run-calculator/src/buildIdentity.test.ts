import { describe, expect, it } from "vitest";

import { WEB_BUILD_ID } from "./buildIdentity";

describe("WEB_BUILD_ID", () => {
  it("is always a non-empty value for incident reports", () => {
    expect(WEB_BUILD_ID.trim()).not.toBe("");
  });
});