import { afterEach, describe, expect, it, vi } from "vitest";

import { WEB_BUILD_ID } from "./buildIdentity";
import { reportIncident } from "./inventoryShared";

afterEach(() => {
  vi.unstubAllGlobals();
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
  });
});