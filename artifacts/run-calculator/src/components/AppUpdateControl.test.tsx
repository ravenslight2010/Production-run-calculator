import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AppUpdateControl } from "./AppUpdateControl";

afterEach(cleanup);
it("always exposes update controls, version, status and retry without hiding blockers", () => {
  const check = vi.fn();
  const update = vi.fn();
  const { rerender } = render(<AppUpdateControl state={{ phase: "unchecked", running: "old-build" }} check={check} update={update} />);
  const trigger = screen.getByRole("button", { name: /App updates/ });
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
  expect(check).toHaveBeenCalledOnce();
  rerender(<AppUpdateControl state={{ phase: "blocked", running: "old-build", target: "new-build", stage: "safety" }} check={check} update={update} />);
  expect(screen.getByRole("status").textContent).toContain("paused run still blocks");
  fireEvent.click(screen.getByRole("button", { name: "Update app" }));
  expect(update).toHaveBeenCalledOnce();
  rerender(<AppUpdateControl state={{ phase: "updating", running: "old-build", target: "new-build" }} check={check} update={update} />);
  expect((screen.getByRole("button", { name: "Check for updates" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Update app" }) as HTMLButtonElement).disabled).toBe(true);
});

it("keeps update states and actions in normal page flow instead of a fixed overlay", () => {
  const check = vi.fn();
  const update = vi.fn();
  const states = [
    "unchecked",
    "checking",
    "current",
    "ready",
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
    />,
  );

  for (const phase of states) {
    const target = ["ready", "updating", "blocked"].includes(phase)
      ? "new-build"
      : undefined;
    rerender(
      <AppUpdateControl
        state={{ phase, running: "old-build", ...(target ? { target } : {}) }}
        check={check}
        update={update}
      />,
    );
    const control = screen.getByTestId("app-update-control");
    expect(control.className).not.toMatch(/\bfixed\b/);
    expect(screen.getByRole("button", { name: /App updates/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check for updates" })).toBeTruthy();
    expect(Boolean(screen.queryByRole("button", { name: "Update app" }))).toBe(Boolean(target));
    if (!["unchecked", "current"].includes(phase)) {
      expect(screen.getByRole("status").textContent).toContain(phase === "ready" ? "Update ready" : phase === "blocked" ? "Blocked by work" : phase === "failed" ? "Update failed" : phase === "confirmed" ? "Update complete" : phase === "offline" ? "Offline" : phase === "updating" ? "Updating" : "Checking");
    }
  }
});
