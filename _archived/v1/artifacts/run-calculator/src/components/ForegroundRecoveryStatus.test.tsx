import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useMemo, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { createForegroundSyncWakeGuard } from "../foregroundSyncWakeGuard";
import {
  ForegroundRecoveryStatus,
  type ForegroundRecoveryNotice,
} from "./ForegroundRecoveryStatus";

describe("ForegroundRecoveryStatus", () => {
  it("keeps failed recovery visible, then releases once through the Retry recovery action", async () => {
    const pull = vi.fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const release = vi.fn();

    function Harness() {
      const [notice, setNotice] = useState<ForegroundRecoveryNotice>({
        kind: "failed",
        message: "Tracking is paused until recovery succeeds.",
      });
      const [acknowledgement, setAcknowledgement] = useState(0);
      const reconcile = useMemo(() => createForegroundSyncWakeGuard(pull), []);
      const retry = () => {
        void reconcile().then((succeeded) => {
          if (!succeeded) return;
          release();
          setAcknowledgement((value) => value + 1);
          setNotice({ kind: "outcome", message: "Production state synchronized." });
        });
      };
      return (
        <ForegroundRecoveryStatus
          notice={notice}
          acknowledgement={acknowledgement}
          onRetry={retry}
          onDismiss={() => undefined}
        />
      );
    }

    render(<Harness />);
    expect(screen.getByTestId("foreground-recovery-status").getAttribute(
      "data-foreground-recovery-state",
    )).toBe("failed");

    fireEvent.click(screen.getByRole("button", { name: "Retry recovery" }));
    await waitFor(() => expect(pull).toHaveBeenCalledTimes(1));
    expect(release).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Retry recovery" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Retry recovery" }));
    await waitFor(() => expect(release).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("foreground-recovery-status").getAttribute(
      "data-foreground-recovery-state",
    )).toBe("outcome");
    expect(screen.getByTestId("foreground-recovery-status").getAttribute(
      "data-foreground-sync-ack",
    )).toBe("1");
  });
});