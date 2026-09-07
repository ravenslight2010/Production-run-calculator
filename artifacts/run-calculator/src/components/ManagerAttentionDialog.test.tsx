// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import ManagerAttentionDialog, {
  buildManagerAttentionItems,
  type ManagerAttentionKind,
  managerAttentionCount,
} from "./ManagerAttentionDialog";

afterEach(() => cleanup());

const fullInput = {
  pendingResetCount: 2,
  canApproveResets: true,
  unreviewedIncidentCount: 3,
  canReviewIncidents: true,
  scheduledRecipeIssueCount: 4,
  canManageProfiles: true,
};

describe("ManagerAttentionDialog", () => {
  it("orders durable manager work by the approved priority model", () => {
    const items = buildManagerAttentionItems(fullInput);
    expect(items.map((item) => item.kind)).toEqual([
      "password-resets",
      "incidents",
      "recipe-setup",
    ]);
    expect(managerAttentionCount(items)).toBe(9);
  });

  it("does not expose work the current role cannot resolve", () => {
    const items = buildManagerAttentionItems({
      ...fullInput,
      canApproveResets: false,
      canReviewIncidents: false,
      canManageProfiles: false,
    });
    expect(items).toEqual([]);
  });

  it("sends every row to its owning resolution workflow", async () => {
    const onResolve = vi.fn();
    render(
      <ManagerAttentionDialog
        open
        onOpenChange={() => {}}
        items={buildManagerAttentionItems(fullInput)}
        onResolve={onResolve}
      />,
    );

    for (const kind of [
      "password-resets",
      "incidents",
      "recipe-setup",
    ] satisfies ManagerAttentionKind[]) {
      await userEvent.click(screen.getByTestId(`manager-attention-action-${kind}`));
    }
    expect(onResolve.mock.calls).toEqual([
      ["password-resets"],
      ["incidents"],
      ["recipe-setup"],
    ]);
  });

  it("can be repeatedly closed and reopened without trapping dialog state", async () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open attention</button>
          <ManagerAttentionDialog
            open={open}
            onOpenChange={setOpen}
            items={buildManagerAttentionItems(fullInput)}
            onResolve={() => {}}
          />
        </>
      );
    }

    render(<Harness />);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(screen.getByText("Manager attention")).toBeTruthy();
      await userEvent.click(screen.getByRole("button", { name: "Close" }));
      await waitFor(() => expect(screen.queryByText("Manager attention")).toBeNull());
      await userEvent.click(screen.getByRole("button", { name: "Open attention" }));
    }
    expect(screen.getByText("Manager attention")).toBeTruthy();
  });

  it("removes protected content immediately and clears stale open state on capability loss", async () => {
    const onOpenChange = vi.fn();

    function Harness({ authorized }: { authorized: boolean }) {
      const [open, setOpen] = useState(true);
      const handleOpenChange = (next: boolean) => {
        onOpenChange(next);
        setOpen(next);
      };
      return (
        <ManagerAttentionDialog
          open={open}
          onOpenChange={handleOpenChange}
          items={buildManagerAttentionItems(fullInput)}
          onResolve={() => {}}
          authorized={authorized}
        />
      );
    }

    const { rerender } = render(<Harness authorized />);
    rerender(<Harness authorized={false} />);
    expect(screen.queryByText("Manager attention")).toBeNull();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledTimes(1));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);

    rerender(<Harness authorized />);
    expect(screen.queryByText("Manager attention")).toBeNull();
    expect(onOpenChange).toHaveBeenCalledTimes(1);
  });
});