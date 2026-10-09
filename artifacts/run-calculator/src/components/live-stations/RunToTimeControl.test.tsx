// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RunToTimeControl } from "./RunToTimeControl";

afterEach(cleanup);

describe("RunToTimeControl", () => {
  it("uses a keyboard-editable text field and commits a valid time on blur", () => {
    const onCommit = vi.fn();
    render(<RunToTimeControl value="19:15" onCommit={onCommit} />);

    const input = screen.getByRole("textbox", { name: /run until time/i });
    expect(input.getAttribute("type")).toBe("text");
    expect((input as HTMLInputElement).value).toBe("7:15 PM");

    fireEvent.change(input, { target: { value: "8:30 PM" } });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith("20:30");
  });

  it("does not commit invalid text and explains the accepted formats", () => {
    const onCommit = vi.fn();
    render(<RunToTimeControl value="19:15" onCommit={onCommit} />);

    const input = screen.getByRole("textbox", { name: /run until time/i });
    fireEvent.change(input, { target: { value: "25:90" } });
    fireEvent.blur(input);

    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("Enter a time like 7:15 PM or 19:15.");
  });

  it("sets the default time with one tap", () => {
    const onCommit = vi.fn();
    render(<RunToTimeControl value="18:00" onCommit={onCommit} />);

    fireEvent.click(screen.getByTestId("button-run-to-time-default"));
    expect(onCommit).toHaveBeenCalledWith("19:15");
  });
});
