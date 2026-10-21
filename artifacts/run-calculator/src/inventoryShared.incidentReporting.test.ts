import { afterEach, describe, expect, it, vi } from "vitest";

import { WEB_BUILD_ID } from "./buildIdentity";
import { reportIncident, submitFieldCheckObservations } from "./inventoryShared";
import { clearPerformanceDiagnostics, getPerformanceDiagnostics } from "./performanceDiagnostics";

afterEach(() => {
  vi.unstubAllGlobals();
  clearPerformanceDiagnostics();
});

describe("incident build identity", () => {
  it("sends a non-empty web build ID when an incident caller has none", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          incidentId: "incident-1",
          diagnosis: "Test diagnosis",
          workaround: "Test workaround",
          recurrence: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await reportIncident({
      source: "user_report",
      screen: "/",
      appPlatform: "web",
      appVersion: "   ",
      description: "The app stopped responding.",
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      appVersion: WEB_BUILD_ID,
      source: "user_report",
    });
    expect(getPerformanceDiagnostics()).toEqual([
      expect.objectContaining({ name: "api:diagnostics:200", kind: "api" }),
    ]);
  });
});

describe("field-check delivery confirmation", () => {
  const observations = [{
    observationId: "field-check-observation",
    checkName: "startup" as const,
    checkVersion: "3",
    outcome: "success" as const,
    observedAt: new Date(0).toISOString(),
    appBuild: "test-build",
    deviceCategory: "desktop-chrome" as const,
    metrics: {},
  }];

  it("accepts only a complete accepted-or-duplicate confirmation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ accepted: 0, duplicate: 1 }),
      { status: 202, headers: { "content-type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(submitFieldCheckObservations(observations)).resolves.toEqual({
      accepted: 0,
      duplicate: 1,
    });
  });

  it("keeps delivery unconfirmed when a successful HTTP response omits an observation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ accepted: 0, duplicate: 0 }),
      { status: 202, headers: { "content-type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(submitFieldCheckObservations(observations))
      .rejects.toThrow("Field-check delivery confirmation unavailable");
  });
});
