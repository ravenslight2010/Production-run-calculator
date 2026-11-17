import { describe, expect, it } from "vitest";
import { parsePushAlertPayload } from "./pushPayload";

describe("parsePushAlertPayload", () => {
  it("accepts a stable alert id and an app-relative URL", () => {
    expect(parsePushAlertPayload({ alertId: "alert_123-abc", url: "/runs/42" }))
      .toEqual({ alertId: "alert_123-abc", url: "/runs/42" });
  });

  it("rejects malformed IDs and external navigation URLs", () => {
    expect(parsePushAlertPayload({ alertId: "", url: "/" })).toBeNull();
    expect(parsePushAlertPayload({ alertId: "x", url: "https://bad.example" })).toBeNull();
    expect(parsePushAlertPayload({ alertId: "x", url: "//bad.example" })).toBeNull();
  });
});