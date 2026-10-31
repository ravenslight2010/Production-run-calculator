import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import SyncStatusPopover from "./SyncStatusPopover";
import {
  flushOperationalIntentOutbox,
  queueOperationalIntent,
  setOperationalIntentIdentity,
} from "../operationalIntentOutbox";

afterEach(() => {
  cleanup();
  setOperationalIntentIdentity(null);
  localStorage.clear();
  vi.unstubAllGlobals();
});

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
  fireEvent.click(screen.getByRole("button", { name: "Sync status: Connected" }));
}

describe("SyncStatusPopover wake-recovery activity", () => {
  it.each([
    ["delayed", "Delayed"],
    ["failed", "Sync failed"],
  ] as const)("names the %s status independently of the compact numeric badge", (status, label) => {
    render(<SyncStatusPopover {...baseProps} status={status} connected={false}
      pendingCount={status === "delayed" ? 5 : 0}
      failedCount={status === "failed" ? 5 : 0} />);
    const button = screen.getByRole("button", { name: `Sync status: ${label}` });
    expect(button.textContent).toContain("5");
    expect(button.getAttribute("data-testid")).toBe("sync-status-button");
    fireEvent.click(button);
    expect(screen.getByText(/It is not shared until the server acknowledges it/)).toBeTruthy();
  });

  it("offers correction guidance, not unchanged retry, for a permanently rejected action", async () => {
    setOperationalIntentIdentity({ scope: "live", userId: "rejection-fixture" });
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 400, json: async () => ({ error: "Invalid command" }),
    }));
    queueOperationalIntent({
      runId: "run", observedGeneration: "run:1", effectiveAt: 1,
      action: "lifecycle", lifecycle: "start",
    });
    await flushOperationalIntentOutbox();
    render(<SyncStatusPopover {...baseProps} />);
    openPopover();
    expect(screen.getByText(/cannot be retried unchanged/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry", exact: true })).toBeNull();
    expect(screen.getByRole("button", { name: "Discard", exact: true })).toBeTruthy();
  });

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

  it("shows that same-field local values were discarded in favor of server values", () => {
    render(
      <SyncStatusPopover
        {...baseProps}
        diagnostics={[{
          id: "stale-base-recovered",
          kind: "merge",
          at: 1_758_211_200_000,
          date: "2026-09-18",
          message: "Recovered stale-base write: reapplied 4 changes; kept server values for 2 conflicts; discarded the conflicting local values; review the current values before editing again",
          response: "stale-base-recovered",
        }]}
      />,
    );

    openPopover();

    expect(screen.getByTestId("sync-activity-stale-base-recovered").textContent).toContain(
      "Recovered stale-base write: reapplied 4 changes; kept server values for 2 conflicts; discarded the conflicting local values; review the current values before editing again [stale-base-recovered]",
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