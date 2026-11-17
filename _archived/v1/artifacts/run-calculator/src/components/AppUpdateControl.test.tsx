import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  AppUpdateControl,
  AppUpdateDetailsDialog,
  AppUpdateFallbackFromContext,
  AppUpdateMenuEntry,
  appUpdateNeedsAttention,
  appUpdateStatusLabel,
  useAppUpdateMenuDialog,
} from "./AppUpdateControl";
import { AppUpdateContext } from "./appUpdateContext";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "./ui/dropdown-menu";
import type { UpdateState } from "../pwaUpdateCoordinator";

afterEach(cleanup);

const actions = () => ({
  check: vi.fn(),
  update: vi.fn(),
  cancelUpdate: vi.fn(),
});

it("maps coordinator phases to concise menu status and attention states", () => {
  const phases: UpdateState["phase"][] = [
    "unchecked", "checking", "current", "ready", "waiting", "deferred",
    "updating", "blocked", "offline", "failed", "confirmed",
  ];
  const labels = phases.map((phase) =>
    appUpdateStatusLabel({ phase, running: "running" }),
  );
  expect(labels).toEqual([
    "Not checked", "Checking", "Current", "Update ready", "Waiting for work to save",
    "Update paused", "Updating", "Blocked by work", "Offline", "Update failed", "Update complete",
  ]);
  expect(phases.map((phase) => appUpdateNeedsAttention({ phase, running: "running" }))).toEqual([
    false, false, false, true, true, true, false, true, true, true, false,
  ]);
  expect(appUpdateStatusLabel({ phase: "current", running: "local" }, true)).toBe("Development preview");
});

it("renders an update status entry and invokes its menu selection", async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  render(
    <DropdownMenu>
      <DropdownMenuTrigger asChild><button type="button">More</button></DropdownMenuTrigger>
      <DropdownMenuContent>
        <AppUpdateMenuEntry
          state={{ phase: "ready", running: "build-a", target: "build-b" }}
          onSelect={onSelect}
        />
      </DropdownMenuContent>
    </DropdownMenu>,
  );

  await user.click(screen.getByRole("button", { name: "More" }));
  const entry = screen.getByRole("menuitem", {
    name: "App updates — Update ready, needs attention",
  });
  expect(entry.textContent).toContain("Update ready");
  expect(entry.textContent).toContain("Needs attention");
  await user.click(entry);
  expect(onSelect).toHaveBeenCalledOnce();
});

it("closes More before opening the update dialog and returns focus to More", async () => {
  const user = userEvent.setup();
  const { check, update, cancelUpdate } = actions();

  function Harness() {
    const [menuOpen, setMenuOpen] = useState(false);
    const moreButtonRef = useRef<HTMLButtonElement>(null);
    const transition = useAppUpdateMenuDialog();
    return (
      <>
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button ref={moreButtonRef} type="button">More</button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            onCloseAutoFocus={(event) => {
              transition.handleMenuCloseAutoFocus(event);
            }}
          >
            <AppUpdateMenuEntry
              state={{ phase: "ready", running: "build-a", target: "build-b" }}
              onSelect={() => transition.requestOpenAfterMenuClose(() => setMenuOpen(false))}
            />
          </DropdownMenuContent>
        </DropdownMenu>
        <AppUpdateDetailsDialog
          state={{ phase: "ready", running: "build-a", target: "build-b" }}
          check={check}
          update={update}
          cancelUpdate={cancelUpdate}
          open={transition.open}
          onOpenChange={transition.setOpen}
          returnFocusRef={moreButtonRef}
        />
      </>
    );
  }

  render(<Harness />);
  const moreButton = screen.getByRole("button", { name: "More" });
  await user.click(moreButton);
  await user.click(screen.getByRole("menuitem", { name: /App updates/ }));
  expect(await screen.findByRole("dialog", { name: "App updates" })).toBeTruthy();
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(moreButton));
});

it("opens the fallback dialog with status, versions, and Check and Update actions", async () => {
  const user = userEvent.setup();
  const { check, update, cancelUpdate } = actions();
  render(
    <AppUpdateControl
      state={{ phase: "ready", running: "build-a", target: "build-b" }}
      check={check}
      update={update}
      cancelUpdate={cancelUpdate}
    />,
  );

  await user.click(screen.getByRole("button", {
    name: "App updates — Update ready, needs attention",
  }));
  expect(await screen.findByRole("dialog", { name: "App updates" })).toBeTruthy();
  expect(screen.getByTestId("app-update-explanation").textContent).toContain(
    "Updating remains protected while work is in progress",
  );
  expect(screen.getByTestId("running-build").textContent).toBe("build-a");
  expect(screen.getByTestId("available-build").textContent).toBe("build-b");
  await user.click(screen.getByRole("button", { name: "Check for updates" }));
  await user.click(screen.getByRole("button", { name: "Update app" }));
  expect(check).toHaveBeenCalledOnce();
  expect(update).toHaveBeenCalledOnce();
  expect(cancelUpdate).not.toHaveBeenCalled();
});

it("offers Cancel for a queued update and Resume for a paused update", async () => {
  const user = userEvent.setup();
  const queuedActions = actions();
  const { rerender } = render(
    <AppUpdateControl
      state={{ phase: "waiting", running: "build-a", target: "build-b" }}
      {...queuedActions}
    />,
  );
  await user.click(screen.getByRole("button", { name: /App updates/ }));
  expect(screen.getByTestId("app-update-explanation").textContent).toContain("sync succeeds");
  expect(screen.getByTestId("app-update-explanation").textContent).toContain("retry or resolve it first");
  expect(screen.queryByRole("button", { name: "Update app" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Cancel queued update" }));
  expect(queuedActions.cancelUpdate).toHaveBeenCalledOnce();

  rerender(
    <AppUpdateControl
      state={{ phase: "deferred", running: "build-a", target: "build-b" }}
      {...queuedActions}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Resume update" }));
  expect(queuedActions.update).toHaveBeenCalledOnce();
});

it("keeps blocker and failure explanations concise and disables actions while busy", async () => {
  const user = userEvent.setup();
  const { check, update, cancelUpdate } = actions();
  const { rerender } = render(
    <AppUpdateControl
      state={{ phase: "blocked", running: "build-a", target: "build-b" }}
      check={check}
      update={update}
      cancelUpdate={cancelUpdate}
    />,
  );
  await user.click(screen.getByRole("button", { name: /App updates/ }));
  expect(screen.getByTestId("app-update-explanation").textContent).toContain(
    "A paused run still blocks updates",
  );
  expect(screen.getByTestId("app-update-explanation").textContent).toContain(
    "Your work has not been discarded",
  );

  rerender(
    <AppUpdateControl
      state={{ phase: "updating", running: "build-a", target: "build-b" }}
      check={check}
      update={update}
      cancelUpdate={cancelUpdate}
    />,
  );
  expect((screen.getByRole("button", { name: "Check for updates" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Update app" }) as HTMLButtonElement).disabled).toBe(true);

  rerender(
    <AppUpdateControl
      state={{ phase: "failed", running: "build-a" }}
      check={check}
      update={update}
      cancelUpdate={cancelUpdate}
    />,
  );
  expect(screen.getByTestId("app-update-explanation").textContent).toContain(
    "Keep working or check again when online",
  );
  rerender(
    <AppUpdateControl
      state={{ phase: "offline", running: "build-a" }}
      check={check}
      update={update}
      cancelUpdate={cancelUpdate}
    />,
  );
  expect(screen.getByTestId("app-update-explanation").textContent).toContain(
    "Reconnect and check again to update",
  );
});

it("keeps the sign-in and error fallback available in development without update actions", async () => {
  const user = userEvent.setup();
  const check = vi.fn();
  const update = vi.fn();
  const cancelUpdate = vi.fn();
  const contextValue = {
    state: { phase: "unchecked", running: "local" } as UpdateState,
    check,
    update,
    cancelUpdate,
    autoReloadSafe: false,
    autoReloadIdle: false,
    developmentPreview: true,
    updateAndReload: vi.fn(async () => {}),
    scheduleSafeIdleRecovery: vi.fn(() => () => {}),
  };
  render(
    <AppUpdateContext.Provider value={contextValue}>
      <AppUpdateFallbackFromContext />
    </AppUpdateContext.Provider>,
  );

  const trigger = screen.getByRole("button", { name: "App updates — Development preview" });
  expect(trigger).toBeTruthy();
  await user.click(trigger);
  expect(await screen.findByRole("dialog", { name: "App updates" })).toBeTruthy();
  expect(screen.getByTestId("app-update-explanation").textContent).toContain(
    "Published updates are not checked",
  );
  expect(screen.queryByRole("button", { name: "Check for updates" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Update app" })).toBeNull();
  expect(check).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
  expect(cancelUpdate).not.toHaveBeenCalled();
});

it("closes with Escape and returns focus to the fallback trigger", async () => {
  const user = userEvent.setup();
  const { check, update, cancelUpdate } = actions();
  render(
    <AppUpdateControl
      state={{ phase: "current", running: "build-a" }}
      check={check}
      update={update}
      cancelUpdate={cancelUpdate}
    />,
  );
  const trigger = screen.getByRole("button", { name: "App updates — Current" });
  await user.click(trigger);
  expect(await screen.findByRole("dialog", { name: "App updates" })).toBeTruthy();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});
