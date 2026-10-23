// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

function receipt(run: RunMeta, cases: number, productionDate?: string) {
  return {
    runId: run.id,
    runDate: "2026-09-07",
    brand: run.brand,
    flavor: run.flavor ?? "",
    cases,
    productionDate: cases > 0 ? productionDate ?? "2026-09-07" : null,
    lotId: cases > 0 ? "lot-confirmed" : null,
    createdAt: "2026-09-07T12:00:00.000Z",
  };
}

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
      onConfirm={vi.fn().mockImplementation((run: RunMeta, count: number, date?: string) =>
        Promise.resolve(receipt(run, count, date)))}
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
    const onConfirm = vi.fn().mockImplementation((run: RunMeta, count: number, date?: string) =>
      Promise.resolve(receipt(run, count, date)));
    const user = userEvent.setup();

    renderPackaging({ onConfirm });

    await user.type(screen.getByRole("spinbutton", { name: "Excess finished cases" }), "3");
    await user.click(screen.getByRole("button", { name: "Confirm surplus" }));

    expect(onConfirm).toHaveBeenCalledWith(completedRun, 3, expect.any(String));
    await waitFor(() => expect(screen.queryByTestId("freezer-surplus-confirm")).toBeNull());
  });

  it("distinguishes blank from an explicit zero and offers the no-extra-cases shortcut", async () => {
    mocks.hasCapability.mockReturnValue(true);
    const onConfirm = vi.fn().mockImplementation((run: RunMeta, count: number, date?: string) =>
      Promise.resolve(receipt(run, count, date)));
    const user = userEvent.setup();
    renderPackaging({ onConfirm });

    await user.click(screen.getByRole("button", { name: "Confirm surplus" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/whole number from 0/i);

    await user.type(screen.getByRole("spinbutton", { name: "Excess finished cases" }), "0");
    await user.click(screen.getByRole("button", { name: "Confirm surplus" }));
    expect(onConfirm).toHaveBeenCalledWith(completedRun, 0, undefined);
    expect(screen.queryByTestId("freezer-surplus-confirm")).toBeNull();

    cleanup();
    renderPackaging({ onConfirm });
    await user.click(screen.getByRole("button", { name: "No extra cases" }));
    expect(onConfirm).toHaveBeenLastCalledWith(completedRun, 0, undefined);
    expect(screen.queryByTestId("freezer-surplus-confirm")).toBeNull();
  });

  it("restores server-confirmed dismissal and keeps a failed draft available", async () => {
    mocks.hasCapability.mockReturnValue(true);
    const user = userEvent.setup();
    const saved = receipt(completedRun, 0);
    const { rerender } = renderPackaging({
      confirmations: [saved],
      onConfirm: vi.fn(),
    });
    expect(screen.queryByTestId("freezer-surplus-confirm")).toBeNull();

    rerender(
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
        onConfirm={vi.fn().mockRejectedValue(new Error("Save failed; retry this run."))}
        onAllocate={vi.fn()}
      />,
    );
    await user.type(screen.getByRole("spinbutton", { name: "Excess finished cases" }), "7");
    const dateInput = screen.getByLabelText("Freezer lot production date");
    await user.clear(dateInput);
    await user.type(dateInput, "2026-09-08");
    await user.click(screen.getByRole("button", { name: "Confirm surplus" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Save failed; retry this run.");
    expect((screen.getByRole("spinbutton", { name: "Excess finished cases" }) as HTMLInputElement).value)
      .toBe("7");
    expect((dateInput as HTMLInputElement).value).toBe("2026-09-08");
  });

  it("does not let a delayed result for one run dismiss a different run", async () => {
    mocks.hasCapability.mockReturnValue(true);
    let finishSave!: (value: ReturnType<typeof receipt>) => void;
    const onConfirm = vi.fn(() => new Promise<ReturnType<typeof receipt>>((resolve) => {
      finishSave = resolve;
    }));
    const user = userEvent.setup();
    const { rerender } = renderPackaging({ onConfirm });
    await user.type(screen.getByRole("spinbutton", { name: "Excess finished cases" }), "4");
    await user.click(screen.getByRole("button", { name: "Confirm surplus" }));

    const nextRun: RunMeta = { ...completedRun, id: "run-2" };
    rerender(
      <FreezerSurplusPanel
        mode="packaging"
        ledger={ledger}
        loaded
        busy={false}
        error={null}
        completedRun={nextRun}
        freezerTimeMin={1}
        nowMs={1_000}
        getOriginalTarget={() => 12}
        onConfirm={onConfirm}
        onAllocate={vi.fn()}
      />,
    );
    finishSave(receipt(completedRun, 4));
    await Promise.resolve();
    expect(screen.getByTestId("freezer-surplus-confirm")).toBeTruthy();
    expect(onConfirm).toHaveBeenCalledWith(completedRun, 4, expect.any(String));
  });

  it("retains a draft when an acknowledgment is malformed", async () => {
    mocks.hasCapability.mockReturnValue(true);
    const user = userEvent.setup();
    renderPackaging({ onConfirm: vi.fn().mockResolvedValue(undefined) });
    await user.type(screen.getByRole("spinbutton", { name: "Excess finished cases" }), "6");
    await user.click(screen.getByRole("button", { name: "Confirm surplus" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/response did not match/i);
    expect((screen.getByRole("spinbutton", { name: "Excess finished cases" }) as HTMLInputElement).value)
      .toBe("6");
  });

  it("blocks busy and duplicate submissions and removes actions after access is revoked", async () => {
    mocks.hasCapability.mockReturnValue(true);
    const user = userEvent.setup();
    const onConfirm = vi.fn(() => new Promise<void>(() => {}));
    const props: React.ComponentProps<typeof FreezerSurplusPanel> = {
      mode: "packaging",
      ledger,
      loaded: true,
      busy: true,
      error: null,
      completedRun,
      freezerTimeMin: 1,
      nowMs: 1_000,
      getOriginalTarget: () => 12,
      onConfirm,
      onAllocate: vi.fn(),
    };
    const { rerender } = render(<FreezerSurplusPanel {...props} />);
    await user.click(screen.getByRole("button", { name: "No extra cases" }));
    expect(onConfirm).not.toHaveBeenCalled();
    rerender(<FreezerSurplusPanel {...props} busy={false} />);
    await user.dblClick(screen.getByRole("button", { name: "No extra cases" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    mocks.hasCapability.mockReturnValue(false);
    rerender(<FreezerSurplusPanel {...props} busy={false} />);
    expect(screen.queryByRole("button", { name: "No extra cases" })).toBeNull();
    expect(screen.getByTestId("freezer-surplus-record-read-only")).toBeTruthy();
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