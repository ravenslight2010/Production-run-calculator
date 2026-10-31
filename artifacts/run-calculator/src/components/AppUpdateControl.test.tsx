import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AppUpdateControl } from "./AppUpdateControl";

afterEach(cleanup);
it("always exposes update controls, version, status and retry without hiding blockers", () => {
  const check = vi.fn();
  const update = vi.fn();
  const cancelUpdate = vi.fn();
  const { rerender } = render(<AppUpdateControl state={{ phase: "unchecked", running: "old-build" }} check={check} update={update} cancelUpdate={cancelUpdate} />);
  const trigger = screen.getByRole("button", { name: /App updates/ });
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
  expect(check).toHaveBeenCalledOnce();
  rerender(<AppUpdateControl state={{ phase: "blocked", running: "old-build", target: "new-build", stage: "safety" }} check={check} update={update} />);
  expect(screen.getByRole("status").textContent).toContain("paused run still blocks");
  fireEvent.click(screen.getByRole("button", { name: "Update app" }));
  expect(update).toHaveBeenCalledOnce();
  rerender(<AppUpdateControl state={{ phase: "waiting", running: "old-build", target: "new-build" }} check={check} update={update} cancelUpdate={cancelUpdate} />);
  expect(screen.getByRole("status").textContent).toContain("sync succeeds");
  expect(screen.getByRole("status").textContent).toContain("retry or resolve it first");
  fireEvent.click(screen.getByRole("button", { name: "Cancel queued update" }));
  expect(cancelUpdate).toHaveBeenCalledOnce();
  rerender(<AppUpdateControl state={{ phase: "updating", running: "old-build", target: "new-build" }} check={check} update={update} cancelUpdate={cancelUpdate} />);
  expect((screen.getByRole("button", { name: "Check for updates" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Update app" }) as HTMLButtonElement).disabled).toBe(true);
  rerender(<AppUpdateControl state={{ phase: "deferred", running: "old-build", target: "new-build" }} check={check} update={update} cancelUpdate={cancelUpdate} />);
  fireEvent.click(screen.getByRole("button", { name: "Resume update" }));
  expect(update).toHaveBeenCalledTimes(2);
});

it("keeps update states and actions in normal page flow instead of a fixed overlay", () => {
  const check = vi.fn();
  const update = vi.fn();
  const states = [
    "unchecked",
    "checking",
    "current",
    "ready",
    "waiting",
    "deferred",
    "updating",
    "blocked",
    "offline",
    "failed",
    "confirmed",
  ] as const;
  const { rerender } = render(
    <AppUpdateControl
      state={{ phase: "unchecked", running: "old-build" }}
      check={check}
      update={update}
      cancelUpdate={vi.fn()}
    />,
  );

  for (const phase of states) {
    const target = ["ready", "waiting", "deferred", "updating", "blocked"].includes(phase)
      ? "new-build"
      : undefined;
    rerender(
      <AppUpdateControl
        state={{ phase, running: "old-build", ...(target ? { target } : {}) }}
        check={check}
        update={update}
        cancelUpdate={vi.fn()}
      />,
    );
    const control = screen.getByTestId("app-update-control");
    expect(control.className).not.toMatch(/\bfixed\b/);
    expect(screen.getByRole("button", { name: /App updates/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check for updates" })).toBeTruthy();
    expect(Boolean(screen.queryByRole("button", { name: "Update app" }))).toBe(Boolean(target) && phase !== "waiting" && phase !== "deferred");
    expect(Boolean(screen.queryByRole("button", { name: "Resume update" }))).toBe(phase === "deferred");
    expect(Boolean(screen.queryByRole("button", { name: "Cancel queued update" }))).toBe(phase === "waiting");
    if (!["unchecked", "current"].includes(phase)) {
      expect(screen.getByRole("status").textContent).toContain(phase === "ready" ? "Update ready" : phase === "waiting" ? "Waiting for work to save" : phase === "deferred" ? "Update paused" : phase === "blocked" ? "Blocked by work" : phase === "failed" ? "Update failed" : phase === "confirmed" ? "Update complete" : phase === "offline" ? "Offline" : phase === "updating" ? "Updating" : "Checking");
    }
  }
});

it("shows a neutral development notice without published-update actions", () => {
  const check = vi.fn();
  const update = vi.fn();
  const cancelUpdate = vi.fn();
  render(
    <AppUpdateControl
      state={{ phase: "failed", running: "local", stage: "identity" }}
      check={check}
      update={update}
      cancelUpdate={cancelUpdate}
      developmentPreview
    />,
  );

  expect(screen.getByRole("button", { name: "App updates · Development preview" })).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain(
    "Published updates are not checked in this development preview",
  );
  expect(screen.queryByText(/Update failed/)).toBeNull();
  expect(screen.queryByRole("button", { name: "Check for updates" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Update app" })).toBeNull();
  expect(check).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
  expect(cancelUpdate).not.toHaveBeenCalled();
});
