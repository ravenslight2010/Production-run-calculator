import { describe, expect, it } from "vitest";
import { deriveStationActivity } from "./stationActivity";

describe("deriveStationActivity", () => {
  it("maps only accepted automatic and manual events onto their run's stations", () => {
    const result = deriveStationActivity({
      runId: "run-1",
      nowMs: 100_000,
      rows: [
        { commandType: "auto-track", actionData: { runId: "run-1", channel: "case" }, serverReceivedAt: new Date(90_000), outcome: "accepted" },
        { commandType: "auto-track", actionData: { runId: "run-1", channel: "tray-consume" }, serverReceivedAt: new Date(70_000), outcome: "accepted" },
        { commandType: "auto-track", actionData: { runId: "run-1", channel: "sauce-barrel" }, serverReceivedAt: new Date(80_000), outcome: "accepted" },
        { commandType: "auto-track", actionData: { runId: "run-1", channel: "app3-batch" }, serverReceivedAt: new Date(85_000), outcome: "accepted" },
        { commandType: "auto-track", actionData: { runId: "other-run", channel: "case" }, serverReceivedAt: new Date(99_000), outcome: "accepted" },
        {
          commandType: "manual-section:packaging",
          actionData: { runId: "run-1" },
          serverReceivedAt: new Date(95_000),
          outcome: "accepted",
        },
        {
          commandType: "manual-section:app3",
          actionData: { runId: "run-1" },
          serverReceivedAt: new Date(92_000),
          outcome: "accepted",
        },
        {
          commandType: "manual-section:dough",
          actionData: { runId: "other-run" },
          serverReceivedAt: new Date(99_000),
          outcome: "accepted",
        },
        {
          commandType: "manual-section:dough",
          actionData: { runId: "run-1" },
          serverReceivedAt: new Date(98_000),
          outcome: "rejected",
        },
      ],
    });

    expect(result).toEqual({
      dough: { runId: "run-1", eventAtServerMs: 70_000, source: "automatic" },
      sauce: { runId: "run-1", eventAtServerMs: 80_000, source: "automatic" },
      press: { runId: "run-1", eventAtServerMs: 90_000, source: "automatic" },
      frontline: { runId: "run-1", eventAtServerMs: 92_000, source: "manual" },
      packaging: { runId: "run-1", eventAtServerMs: 95_000, source: "manual" },
    });
  });

  it("uses explicit server confirmation time for Tunnel and Warehouse, excluding future evidence", () => {
    const result = deriveStationActivity({
      runId: "run-1",
      nowMs: 100_000,
      rows: [
        {
          commandType: "station-activity-confirmation",
          actionData: { runId: "run-1", station: "freezeTunnel" },
          serverReceivedAt: new Date(75_000),
          outcome: "accepted",
        },
        {
          commandType: "station-activity-confirmation",
          actionData: { runId: "run-1", station: "warehouse" },
          serverReceivedAt: new Date(101_000),
          outcome: "accepted",
        },
        {
          commandType: "station-activity-confirmation",
          actionData: { runId: "other-run", station: "warehouse" },
          serverReceivedAt: new Date(99_000),
          outcome: "accepted",
        },
      ],
    });

    expect(result).toEqual({
      freezeTunnel: { runId: "run-1", eventAtServerMs: 75_000, source: "confirmed" },
    });
  });
});
