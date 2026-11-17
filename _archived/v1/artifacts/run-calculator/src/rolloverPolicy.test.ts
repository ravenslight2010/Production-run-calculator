import { describe, expect, it } from "vitest";
import {
  shouldPublishFreshRolloverState,
  shouldSignOutAfterRollover,
} from "./utils";

describe("daily rollover policy", () => {
  it("keeps a session established by the current sign-in authenticated", () => {
    expect(shouldSignOutAfterRollover(true)).toBe(false);
  });

  it("signs out a session that was already active across the day change", () => {
    expect(shouldSignOutAfterRollover(false)).toBe(true);
  });

  it("publishes an empty state only after a successful empty server read", () => {
    expect(shouldPublishFreshRolloverState(true)).toBe(true);
  });

  it("does not publish an empty state when the rollover read fails", () => {
    expect(shouldPublishFreshRolloverState(false)).toBe(false);
  });
});