import { useState } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, renderHook, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useGetStartedOverview } from "@workspace/onboarding";
import GetStartedDialog from "../GetStartedDialog";

const WELCOME = "Welcome to Production Run Calculator";

afterEach(() => cleanup());

// Renders the REAL first-login overview wired through the REAL shared latch
// hook, mimicking how home.tsx mounts it. `initialSeen` simulates the server's
// per-user onboardingSeen flag for a brand-new vs. returning user.
function OnboardingHarness({ initialSeen }: { initialSeen: boolean }) {
  const [seen, setSeen] = useState(initialSeen);
  const me = { onboardingSeen: seen };
  const markOnboardingSeen = () => setSeen(true);
  const { open, setOpen, dismiss } = useGetStartedOverview(me, markOnboardingSeen);
  return (
    <>
      <button onClick={() => setOpen(true)}>Reopen overview</button>
      <GetStartedDialog
        open={open}
        onOpenChange={setOpen}
        onDismiss={dismiss}
        onStartTour={() => {}}
        isManager={false}
      />
    </>
  );
}

describe("first-login Get Started overview (web)", () => {
  it("auto-opens once for a brand-new user", () => {
    render(<OnboardingHarness initialSeen={false} />);
    expect(screen.getByText(WELCOME)).toBeTruthy();
  });

  it("does NOT auto-open for a returning user who has already seen it", () => {
    render(<OnboardingHarness initialSeen={true} />);
    expect(screen.queryByText(WELCOME)).toBeNull();
  });

  it("stays closed after dismissal and can be reopened from the menu", async () => {
    const user = userEvent.setup();
    render(<OnboardingHarness initialSeen={false} />);

    // Auto-opened.
    expect(screen.getByText(WELCOME)).toBeTruthy();

    // Dismiss via the "Get started" button.
    await user.click(screen.getByRole("button", { name: "Get started" }));
    expect(screen.queryByText(WELCOME)).toBeNull();

    // It must not re-open on its own.
    expect(screen.queryByText(WELCOME)).toBeNull();

    // Manual reopen from the header menu works.
    await user.click(screen.getByRole("button", { name: "Reopen overview" }));
    expect(screen.getByText(WELCOME)).toBeTruthy();
    expect(screen.getByText("Inventory")).toBeTruthy();
    expect(screen.queryByText("Stock", { exact: true })).toBeNull();
  });
});

describe("useGetStartedOverview latch", () => {
  it("auto-opens exactly once and never re-opens even if the user stays unseen", () => {
    const markSeen = vi.fn();
    const { result, rerender } = renderHook(
      ({ me }) => useGetStartedOverview(me, markSeen),
      { initialProps: { me: { onboardingSeen: false } } },
    );

    // Auto-opened on first render.
    expect(result.current.open).toBe(true);

    // User closes it WITHOUT the seen flag round-tripping (still false).
    act(() => result.current.setOpen(false));
    expect(result.current.open).toBe(false);

    // The user object re-emits while still unseen — the latch must hold.
    rerender({ me: { onboardingSeen: false } });
    expect(result.current.open).toBe(false);
  });

  it("marks onboarding seen once on dismiss, and is idempotent once seen", () => {
    const markSeen = vi.fn();
    const { result, rerender } = renderHook(
      ({ me }) => useGetStartedOverview(me, markSeen),
      { initialProps: { me: { onboardingSeen: false } as { onboardingSeen: boolean } } },
    );

    act(() => result.current.dismiss());
    expect(markSeen).toHaveBeenCalledTimes(1);

    // Once the server reports it seen, dismissing again is a no-op.
    rerender({ me: { onboardingSeen: true } });
    act(() => result.current.dismiss());
    expect(markSeen).toHaveBeenCalledTimes(1);
  });

  it("never auto-opens when the user has already seen it", () => {
    const markSeen = vi.fn();
    const { result } = renderHook(() =>
      useGetStartedOverview({ onboardingSeen: true }, markSeen),
    );
    expect(result.current.open).toBe(false);
  });
});
