// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FreezerSurplusLedger } from "@workspace/freezer-pull";
import type { RunMeta } from "../types";

const mocks = vi.hoisted(() => ({
  hasCapability: vi.fn(),
}));

vi.mock("../useRole", () => ({
  useMe: () => ({ hasCapability: mocks.hasCapability }),
}));

vi.mock("../freezerSurplus", () => ({
  getFreezerSurplusRemainingMs: () => 60_000,
  fetchFreezerSurplusAdjustments: vi.fn().mockResolvedValue([]),
}));

import { FreezerSurplusPanel } from "./FreezerSurplusPanel";

const completedRun: RunMeta = {
  id: "run-1",
  brand: "Northstar",
  flavor: "Pepperoni",
  endedAt: 1_000,
};

const pendingRun: RunMeta = {
  id: "run-2",
  brand: "Northstar",
  flavor: "Pepperoni",
};

const ledger: FreezerSurplusLedger = {
  lots: [
    {
      id: "lot-1",
      brand: "Northstar",
      flavor: "Pepperoni",
      productKey: "northstar::pepperoni",
      productionDate: "2026-09-07",
      totalCases: 4,
      remainingCases: 4,
    },
  ],
  allocations: [],
};

function renderPackaging(overrides: Partial<React.ComponentProps<typeof FreezerSurplusPanel>> = {}) {
  return render(
    <FreezerSurplusPanel
      mode="packaging"
      ledger={ledger}
      loaded
      busy={false}
      error={null}
      completedRun={completedRun}
      freezerTimeMin={1}
      nowMs={1_000}
      getOriginalTarget={() => 12}
      onConfirm={vi.fn().mockResolvedValue(undefined)}
      onAllocate={vi.fn().mockResolvedValue(undefined)}
      {...overrides}
    />,
  );
}

function renderWarehouse(overrides: Partial<React.ComponentProps<typeof FreezerSurplusPanel>> = {}) {
  return render(
    <FreezerSurplusPanel
      mode="warehouse"
      ledger={ledger}
      loaded
      busy={false}
      error={null}
      pendingRuns={[pendingRun]}
      getOriginalTarget={() => 12}
      onConfirm={vi.fn().mockResolvedValue(undefined)}
      onAllocate={vi.fn().mockResolvedValue(undefined)}
      {...overrides}
    />,
  );
}

afterEach(() => {
  cleanup();
  mocks.hasCapability.mockReset();
});

describe("FreezerSurplusPanel capability gates", () => {
  it("keeps surplus recording read-only without manage-inventory", () => {
    mocks.hasCapability.mockReturnValue(false);
    const onConfirm = vi.fn().mockResolvedValue(undefined);

    renderPackaging({ onConfirm });

    expect(screen.queryByRole("spinbutton", { name: "Excess finished cases" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirm surplus" })).toBeNull();
    expect(screen.getByTestId("freezer-surplus-record-read-only")).toBeTruthy();
    expect(screen.getByText("Read-only")).toBeTruthy();
    expect(screen.getByText(/requires inventory management access/i)).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("allows managers to record finished-case freezer surplus", async () => {
    mocks.hasCapability.mockReturnValue(true);
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderPackaging({ onConfirm });

    await user.type(screen.getByRole("spinbutton", { name: "Excess finished cases" }), "3");
    await user.click(screen.getByRole("button", { name: "Confirm surplus" }));

    expect(onConfirm).toHaveBeenCalledWith(completedRun, 3, expect.any(String));
  });

  it("does not expose pull controls without manage-inventory", () => {
    mocks.hasCapability.mockReturnValue(false);

    renderWarehouse();

    expect(screen.getByTestId("freezer-surplus-run-run-2")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /choose pull|revise pull/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirm pull" })).toBeNull();
    expect(screen.getByTestId("freezer-surplus-pull-read-only")).toBeTruthy();
    expect(screen.getByText("Read-only")).toBeTruthy();
    expect(screen.getByText(/requires inventory management access/i)).toBeTruthy();
  });

  it("allows managers to choose and confirm a freezer pull", async () => {
    mocks.hasCapability.mockReturnValue(true);
    const onAllocate = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderWarehouse({ onAllocate });

    await user.click(screen.getByRole("button", { name: "Choose pull" }));
    const cases = screen.getByRole("spinbutton", { name: "Cases from freezer lot dated 2026-09-07" });
    await user.clear(cases);
    await user.type(cases, "2");
    await user.click(screen.getByRole("button", { name: "Confirm pull" }));

    expect(onAllocate).toHaveBeenCalledWith(pendingRun, [{ lotId: "lot-1", cases: 2 }]);
  });

  it("lets managers record an attributed finished-case adjustment", async () => {
    mocks.hasCapability.mockReturnValue(true);
    const event = {
      eventId: "eb1339c3-f427-4e38-9e72-b96f6122e0a5",
      lotId: "lot-1",
      eventType: "damage" as const,
      cases: 2,
      reason: "Two cases were damaged",
      actorId: "manager-1",
      createdAt: "2026-09-07T12:00:00.000Z",
    };
    const onAdjust = vi.fn().mockResolvedValue(event);
    const user = userEvent.setup();

    renderWarehouse({ onAdjust });

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Finished-case adjustment lot" }),
      "lot-1",
    );
    const caseInput = screen.getByRole("spinbutton", { name: "Finished-case adjustment cases" });
    await user.clear(caseInput);
    await user.type(caseInput, "2");
    await user.type(screen.getByRole("textbox", { name: "Finished-case adjustment reason" }), event.reason);
    await user.click(screen.getByRole("button", { name: "Record adjustment" }));

    expect(onAdjust).toHaveBeenCalledWith("lot-1", {
      eventId: expect.any(String),
      eventType: "damage",
      cases: 2,
      reason: event.reason,
    });
    expect(await screen.findByText(/damage · 2 cases/)).toBeTruthy();
    expect(screen.getByText(/manager-1/)).toBeTruthy();
  });
});