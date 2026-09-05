// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import AiStatusNotice from "./AiStatusNotice";

afterEach(() => cleanup());

describe("AiStatusNotice", () => {
  it("explains that deterministic results remain available when AI is unavailable", () => {
    render(<AiStatusNotice status="unavailable" feature="AI matching" />);

    expect(screen.getByRole("status").textContent).toContain(
      "AI matching unavailable. Deterministic results are still available.",
    );
  });

  it.each(["deterministic", "enriched"] as const)("stays hidden for %s results", (status) => {
    const { container } = render(<AiStatusNotice status={status} />);

    expect(container.firstChild).toBeNull();
  });
});