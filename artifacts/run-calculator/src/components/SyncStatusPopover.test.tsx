import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import SyncStatusPopover from "./SyncStatusPopover";

afterEach(cleanup);

const baseProps: ComponentProps<typeof SyncStatusPopover> = {
  status: "connected",
  connected: true,
  date: "2026-09-18",
  lastAcknowledgedAt: null,
  pendingCount: 0,
  failedCount: 0,
  diagnostics: [],
  canViewConflicts: false,
  onRetry: vi.fn(),
  onOpenConflicts: vi.fn(),
  onExportDiagnostics: vi.fn(),
};

function openPopover() {
  fireEvent.click(screen.getByRole("button", { name: "Connected" }));
}

describe("SyncStatusPopover wake-recovery activity", () => {
  it("shows bounded timing details for a successful wake recovery", () => {
    render(
      <SyncStatusPopover
        {...baseProps}
        diagnostics={[{
          id: "wake-success",
          kind: "ack",
          at: 1_758_211_200_000,
          date: "2026-09-18",
          message: "Foreground wake recovery completed",
          response: "wake-recovery:success",
          wakeRecovery: {
            attempts: 1,
            durationMs: 850,
            trigger: "foreground",
            outcome: "success",
          },
        }]}
      />,
    );

    openPopover();

    expect(screen.getByTestId("sync-activity-wake-success").textContent).toContain(
      "Foreground wake recovery completed [wake-recovery:success] · 1 attempt · 850ms · foreground · success",
    );
  });

  it("shows attempts and terminal outcome for a failed wake recovery", () => {
    render(
      <SyncStatusPopover
        {...baseProps}
        diagnostics={[{
          id: "wake-failure",
          kind: "failure",
          at: 1_758_211_200_000,
          date: "2026-09-18",
          message: "Foreground wake recovery completed",
          response: "wake-recovery:connectivity-retry",
          wakeRecovery: {
            attempts: 3,
            durationMs: 2_450,
            trigger: "sse-reconnect",
            outcome: "connectivity-retry",
          },
        }]}
      />,
    );

    openPopover();

    expect(screen.getByTestId("sync-activity-wake-failure").textContent).toContain(
      "Foreground wake recovery completed [wake-recovery:connectivity-retry] · 3 attempts · 2.5s · sse reconnect · connectivity retry",
    );
  });

  it("leaves ordinary sync activity rows unchanged", () => {
    render(
      <SyncStatusPopover
        {...baseProps}
        diagnostics={[{
          id: "ordinary",
          kind: "ack",
          at: 1_758_211_200_000,
          date: "2026-09-18",
          message: "Server acknowledged local changes",
          response: "accepted",
          runId: "run-1234567890-extra",
        }]}
      />,
    );

    openPopover();

    const row = screen.getByTestId("sync-activity-ordinary");
    expect(row.textContent).toContain("Server acknowledged local changes [accepted] · Run run-12345678");
    expect(row.textContent).not.toContain("attempt");
  });
});