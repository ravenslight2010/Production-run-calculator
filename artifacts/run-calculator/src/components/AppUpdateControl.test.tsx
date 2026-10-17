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
