import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  CheckUsernameAvailableQueryParams,
  ListPasswordResetRequestsResponseItem,
  ListRunsResponseItem,
} from "./generated/api";

describe("generated Zod schema runtime contracts", () => {
  it("coerces query and parameter values as generated", () => {
    const parsed = CheckUsernameAvailableQueryParams.parse({ username: 12345 });

    expect(parsed.username).toBe("12345");
  });

  it("converts generated date fields to Date instances", () => {
    const parsed = ListPasswordResetRequestsResponseItem.parse({
      id: "reset-1",
      userId: "user-1",
      username: "operator",
      requestedAt: "2026-08-26T12:34:56.000Z",
    });

    expect(parsed.requestedAt).toBeInstanceOf(Date);
    expect(parsed.requestedAt.toISOString()).toBe("2026-08-26T12:34:56.000Z");
  });

  it("keeps integer response fields numeric and integral", () => {
    const parsed = ListRunsResponseItem.parse({
      id: 42,
      label: "Morning run",
      casesNeeded: 12,
      casesLeft: 12,
      skidsCompleted: 0,
      pizzasPerMin: "2.5",
      totalTimeSec: 300,
      batchesNeeded: "3",
      inputs: {},
      createdAt: "2026-08-26T12:34:56.000Z",
    });

    expect(parsed.id).toBe(42);
    expect(parsed.casesNeeded).toBe(12);
    expect(() =>
      ListRunsResponseItem.parse({
        id: 42.5,
        label: "Morning run",
        casesNeeded: 12,
        casesLeft: 12,
        skidsCompleted: 0,
        pizzasPerMin: "2.5",
        totalTimeSec: 300,
        batchesNeeded: "3",
        inputs: {},
        createdAt: "2026-08-26T12:34:56.000Z",
      }),
    ).toThrow(z.ZodError);
  });
});