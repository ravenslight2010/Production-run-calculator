import { afterEach, describe, expect, it } from "vitest";
import { dateInTimeZone, facilityTimeZone } from "../lib/facilityTime";

describe("facility-local rollover date", () => {
  afterEach(() => {
    delete process.env.FACILITY_TIME_ZONE;
  });

  it("uses the facility date rather than UTC", () => {
    const justBeforeCentralMidnight = Date.parse("2026-09-08T04:59:59.000Z");
    const atCentralMidnight = Date.parse("2026-09-08T05:00:00.000Z");
    expect(dateInTimeZone(justBeforeCentralMidnight, "America/Chicago")).toBe("2026-09-07");
    expect(dateInTimeZone(atCentralMidnight, "America/Chicago")).toBe("2026-09-08");
  });

  it("honors a valid configured timezone and rejects an invalid one", () => {
    process.env.FACILITY_TIME_ZONE = "America/New_York";
    expect(facilityTimeZone()).toBe("America/New_York");
    process.env.FACILITY_TIME_ZONE = "not/a-zone";
    expect(facilityTimeZone()).toBe("America/Chicago");
  });
});