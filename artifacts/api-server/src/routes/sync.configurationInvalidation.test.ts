import { describe, expect, it } from "vitest";
import {
  CONFIGURATION_INVALIDATION_FAMILIES,
  configurationInvalidationPayload,
  shouldReceiveConfigurationInvalidation,
} from "./sync";

describe("configuration invalidation contract", () => {
  it("is a bounded reload nudge with legacy master-data fields", () => {
    const payload = configurationInvalidationPayload("client-a", "supervisor-pin");

    expect(payload).toEqual({
      type: "master-data",
      masterDataChanged: true,
      configurationInvalidated: true,
      family: "supervisor-pin",
      senderId: "client-a",
    });
    expect(JSON.stringify(payload)).not.toContain("1234");
    expect(Object.keys(payload).sort()).toEqual([
      "configurationInvalidated",
      "family",
      "masterDataChanged",
      "senderId",
      "type",
    ]);
  });

  it("only permits the allowlisted configuration families", () => {
    expect(CONFIGURATION_INVALIDATION_FAMILIES).toEqual([
      "master-data",
      "profiles",
      "factory-data",
      "die-types",
      "supervisor-pin",
      "name-links",
      "merged-away",
    ]);
    expect(configurationInvalidationPayload("client-a", "request-body")).toMatchObject({
      family: "master-data",
    });
  });

  it("is scope-bound, excludes the sender, and is not date-bound", () => {
    const otherDayClient = { clientId: "client-b", scope: "live" as const, watchDate: "2040-01-02" };
    expect(shouldReceiveConfigurationInvalidation(otherDayClient, "client-a", "live")).toBe(true);
    expect(shouldReceiveConfigurationInvalidation(
      { ...otherDayClient, clientId: "client-a" }, "client-a", "live",
    )).toBe(false);
    expect(shouldReceiveConfigurationInvalidation(
      { ...otherDayClient, scope: "sandbox" }, "client-a", "live",
    )).toBe(false);
  });
});