import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginStartup,
  markStartupFailed,
  resetStartupHealthForTests,
} from "./startupHealth";
import { startupGate } from "./startupGate";

describe("startupGate", () => {
  beforeEach(() => {
    resetStartupHealthForTests();
  });

  it("returns structured stage and correlation diagnostics for a failed startup", () => {
    beginStartup(1_000);
    markStartupFailed("seed_roles", "seed_roles_failed", 1_250);
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const next = vi.fn();

    startupGate(
      { id: "request-123" } as Request,
      { status } as unknown as Response,
      next as NextFunction,
    );

    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith({
      error: "Service is not ready",
      status: "failed",
      stage: "seed_roles",
      durationMs: 250,
      errorCode: "seed_roles_failed",
      correlationId: "request-123",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("allows requests only after startup becomes ready", () => {
    const next = vi.fn();

    startupGate({} as Request, {} as Response, next as NextFunction);

    expect(next).toHaveBeenCalledOnce();
  });
});
