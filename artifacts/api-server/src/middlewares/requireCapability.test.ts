import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { requireManagerRole } from "./requireCapability";

function response() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  return { res: { status } as unknown as Response, status, json };
}

describe("requireManagerRole", () => {
  it.each(["supervisor", "qc-manager", "operator", "custom-reviewer", undefined])(
    "rejects the non-manager role %s even if an earlier capability gate allowed it",
    (role) => {
      const { res, status, json } = response();
      const next = vi.fn() as NextFunction;
      requireManagerRole({ role } as Request, res, next);
      expect(status).toHaveBeenCalledWith(403);
      expect(json).toHaveBeenCalledWith({ error: "Manager role required" });
      expect(next).not.toHaveBeenCalled();
    },
  );

  it("allows the literal manager role", () => {
    const { res, status } = response();
    const next = vi.fn() as NextFunction;
    requireManagerRole({ role: "manager" } as Request, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
  });
});