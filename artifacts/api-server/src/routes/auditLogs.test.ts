import { describe, expect, it } from "vitest";
import { profileNameLinkCleanupSummary } from "./auditLogs";

describe("profileNameLinkCleanupSummary", () => {
  it("keeps a completed cleanup result manager-readable", () => {
    expect(profileNameLinkCleanupSummary({
      scannedProfiles: 14,
      correctedProfiles: 3,
      skippedStarted: 1,
      removedStubs: { dough: 2, sauce: 4, cheese: 5, mix: 6 },
    })).toEqual({
      scannedProfiles: 14,
      correctedProfiles: 3,
      skippedStarted: 1,
      removedStubs: { dough: 2, sauce: 4, cheese: 5, mix: 6 },
    });
  });

  it("safely fills in missing or malformed historical marker fields", () => {
    expect(profileNameLinkCleanupSummary({
      correctedProfiles: "2",
      skippedStarted: -1,
      removedStubs: { sauce: "3.9", mix: "not a number" },
    })).toEqual({
      scannedProfiles: 0,
      correctedProfiles: 2,
      skippedStarted: 0,
      removedStubs: { dough: 0, sauce: 3, cheese: 0, mix: 0 },
    });
  });
});