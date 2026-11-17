import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeferredSurface } from "./DeferredDepartmentSurface";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DeferredSurface", () => {
  it("contains a deferred load while preserving a visible loading state", async () => {
    let resolve!: (module: { default: () => JSX.Element }) => void;
    const load = vi.fn(
      () =>
        new Promise<{ default: () => JSX.Element }>((done) => {
          resolve = done;
        }),
    );

    render(<DeferredSurface label="dough recipes" load={load} componentProps={{}} />);

    expect(screen.getByRole("status").textContent).toContain("Loading dough recipes");

    await act(async () => {
      resolve({ default: () => <h3>Dough Recipes</h3> });
    });

    expect(await screen.findByRole("heading", { name: "Dough Recipes" })).not.toBeNull();
  });

  it("contains a failed child render and offers a working retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let attempt = 0;
    const load = vi.fn(async () => {
      attempt += 1;
      return attempt === 1
        ? {
            default: () => {
              throw new Error("recipe render failed");
            },
          }
        : { default: () => <h3>Dough Recipes</h3> };
    });

    render(<DeferredSurface label="named recipes" load={load} componentProps={{}} />);

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Couldn’t load named recipes",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry named recipes" }));

    expect(await screen.findByRole("heading", { name: "Dough Recipes" })).not.toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
  });
});