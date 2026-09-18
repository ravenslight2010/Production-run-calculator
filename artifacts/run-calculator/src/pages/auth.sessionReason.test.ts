import { describe, expect, it } from "vitest";
import { sessionEndingMessage } from "./auth";

describe("session ending explanation", () => {
  it("explains a facility rollover without exposing server details", () => {
    expect(sessionEndingMessage("daily_reset")).toMatch(/daily production rollover/i);
  });

  it("uses the generic safe explanation for an unexpected expiry", () => {
    expect(sessionEndingMessage("session_expired")).toMatch(/session expired/i);
    expect(sessionEndingMessage(null)).toBeNull();
  });
});