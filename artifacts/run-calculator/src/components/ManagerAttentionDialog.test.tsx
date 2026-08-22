// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ManagerAttentionDialog, {
  buildManagerAttentionItems,
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
  proactiveAlert: {
    key: "behind-plan",
    category: "run" as const,
    impact: "high" as const,
    title: "Falling behind",
    detail: "Line is slower than planned.",
  },
  isManager: true,
};

describe("ManagerAttentionDialog", () => {
  it("orders durable manager work by the approved priority model", () => {
    const items = buildManagerAttentionItems(fullInput);
    expect(items.map((item) => item.kind)).toEqual([
      "password-resets",
      "incidents",
      "recipe-setup",
      "proactive-alert",
    ]);
    expect(managerAttentionCount(items)).toBe(10);
  });

  it("does not expose work the current role cannot resolve", () => {
    const items = buildManagerAttentionItems({
      ...fullInput,
      canApproveResets: false,
      canReviewIncidents: false,
      canManageProfiles: false,
      isManager: false,
    });
    expect(items).toEqual([]);
  });

  it("sends each row to its owning resolution workflow", async () => {
    const onResolve = vi.fn();
    render(
      <ManagerAttentionDialog
        open
        onOpenChange={() => {}}
        items={buildManagerAttentionItems(fullInput)}
        onResolve={onResolve}
      />,
    );

    await userEvent.click(screen.getByTestId("manager-attention-action-password-resets"));
    expect(onResolve).toHaveBeenCalledWith("password-resets");
  });

  it("closes the attention surface immediately when capability access is removed", () => {
    const { rerender } = render(
      <ManagerAttentionDialog
        open
        onOpenChange={() => {}}
        items={buildManagerAttentionItems(fullInput)}
        onResolve={() => {}}
        authorized
      />,
    );
    expect(screen.getByText("Manager attention")).toBeTruthy();

    rerender(
      <ManagerAttentionDialog
        open
        onOpenChange={() => {}}
        items={buildManagerAttentionItems(fullInput)}
        onResolve={() => {}}
        authorized={false}
      />,
    );
    expect(screen.queryByText("Manager attention")).toBeNull();
  });
});