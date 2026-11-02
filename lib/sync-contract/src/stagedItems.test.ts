import { describe, expect, it } from "vitest";
import {
  isStagedItemVersion,
  mergeStagedItemsFromPeer,
  mergeStagedItemsOnServer,
  type StagedItemRevision,
} from "./stagedItems";

const version = (
  revision: number,
  baseRevision: number,
  operationId: string,
  options: Partial<StagedItemRevision> = {},
): StagedItemRevision => ({
  revision,
  baseRevision,
  baseOperationId: options.baseOperationId ?? (baseRevision > 0 ? `parent:${baseRevision}` : ""),
  rootRevision: options.rootRevision ?? 0,
  rootOperationId: options.rootOperationId ?? "",
  chainId: options.chainId ?? operationId,
  operationId,
});

describe("staged item sync", () => {
  it("validates one-step row revisions and bounded operation identities", () => {
    expect(isStagedItemVersion(version(1, 0, "device-a:1"))).toBe(true);
    expect(isStagedItemVersion(version(2, 0, "device-a:2"))).toBe(false);
    expect(isStagedItemVersion(version(1, -1, "device-a:1"))).toBe(false);
    expect(isStagedItemVersion(version(1, 0, "bad operation id"))).toBe(false);
  });

  it("accepts an explicit uncheck over a legacy checked row", () => {
    const result = mergeStagedItemsOnServer(
      {
        stagedItems: { "run-a::cheese": false },
        stagedItemVersions: { "run-a::cheese": version(1, 0, "phone:1") },
      },
      { stagedItems: { "run-a::cheese": true } },
    );

    expect(result.stagedItems["run-a::cheese"]).toBe(false);
    expect(result.stagedItemVersions["run-a::cheese"]).toEqual(version(1, 0, "phone:1"));
    expect(result.conflictCount).toBe(0);
  });

  it("rejects a stale same-row check after a newer uncheck", () => {
    const result = mergeStagedItemsOnServer(
      {
        stagedItems: { "run-a::cheese": true },
        stagedItemVersions: {
          "run-a::cheese": version(2, 1, "sleeping-device:2", {
            baseOperationId: "sleeping-device:1",
            chainId: "sleeping-device:1",
          }),
        },
      },
      {
        stagedItems: { "run-a::cheese": false },
        stagedItemVersions: { "run-a::cheese": version(1, 0, "active-device:1") },
      },
    );

    expect(result.stagedItems["run-a::cheese"]).toBe(false);
    expect(result.stagedItemVersions["run-a::cheese"]).toEqual(version(1, 0, "active-device:1"));
    expect(result.conflictCount).toBe(1);
  });

  it("merges different rows independently and retries idempotently", () => {
    const current = {
      stagedItems: { "run-a::cheese": false, "run-a::sauce": true },
      stagedItemVersions: { "run-a::cheese": version(1, 0, "phone:1") },
    };
    const first = mergeStagedItemsOnServer(
      {
        stagedItems: { "run-a::cheese": false, "run-a::sauce": false },
        stagedItemVersions: { "run-a::cheese": version(1, 0, "phone:1"), "run-a::sauce": version(1, 0, "phone:2") },
      },
      current,
    );
    const retry = mergeStagedItemsOnServer(
      {
        stagedItems: { "run-a::cheese": false, "run-a::sauce": false },
        stagedItemVersions: { "run-a::cheese": version(1, 0, "phone:1"), "run-a::sauce": version(1, 0, "phone:2") },
      },
      first,
    );

    expect(first.stagedItems).toEqual({ "run-a::cheese": false, "run-a::sauce": false });
    expect(first.conflictCount).toBe(0);
    expect(retry.stagedItems).toEqual(first.stagedItems);
    expect(retry.conflictCount).toBe(0);
  });

  it("accepts an offline chain only when it descends from the canonical row", () => {
    const existing = {
      stagedItems: { "run-a::cheese": true },
      stagedItemVersions: {
        "run-a::cheese": version(1, 0, "phone:1", { chainId: "phone:1" }),
      },
    };
    const sameChain = {
      stagedItems: { "run-a::cheese": false },
      stagedItemVersions: {
        "run-a::cheese": version(3, 2, "phone:3", {
          baseOperationId: "phone:2",
          rootRevision: 0,
          rootOperationId: "",
          chainId: "phone:1",
        }),
      },
    };
    const staleBranch = {
      stagedItems: { "run-a::cheese": false },
      stagedItemVersions: {
        "run-a::cheese": version(3, 2, "other:3", {
          baseOperationId: "other:2",
          chainId: "other:1",
        }),
      },
    };

    expect(mergeStagedItemsOnServer(sameChain, existing, { acceptCurrentBaseSnapshot: true })
      .stagedItems["run-a::cheese"]).toBe(false);
    expect(mergeStagedItemsOnServer(staleBranch, existing, { acceptCurrentBaseSnapshot: true })
      .stagedItems["run-a::cheese"]).toBe(true);
  });

  it("converges concurrent same-row decisions deterministically", () => {
    const checked = {
      stagedItems: { "run-a::cheese": true },
      stagedItemVersions: { "run-a::cheese": version(1, 0, "device-b:1") },
    };
    const unchecked = {
      stagedItems: { "run-a::cheese": false },
      stagedItemVersions: { "run-a::cheese": version(1, 0, "device-a:1") },
    };
    const a = mergeStagedItemsOnServer(checked, unchecked);
    const b = mergeStagedItemsOnServer(unchecked, checked);

    expect(a.stagedItems).toEqual(b.stagedItems);
    expect(a.stagedItemVersions).toEqual(b.stagedItemVersions);
    expect(a.stagedItemVersions["run-a::cheese"]).toEqual(version(1, 0, "device-a:1"));
  });

  it("adopts canonical state instead of replaying a stale higher revision", () => {
    const result = mergeStagedItemsFromPeer(
      {
        stagedItems: { "run-a::cheese": true },
      stagedItemVersions: {
        "run-a::cheese": version(4, 3, "offline-device:4", {
          baseOperationId: "offline-device:3",
          chainId: "offline-device:1",
        }),
      },
      },
      {
        stagedItems: { "run-a::cheese": false },
        stagedItemVersions: { "run-a::cheese": version(3, 2, "server:3", { baseOperationId: "server:2" }) },
      },
    );

    expect(result.stagedItems["run-a::cheese"]).toBe(false);
    expect(result.stagedItemVersions["run-a::cheese"]).toEqual(
      version(3, 2, "server:3", { baseOperationId: "server:2" }),
    );
  });

  it("preserves a queued local chain only when the canonical peer is its parent", () => {
    const queued = {
      stagedItems: { "run-a::cheese": false },
      stagedItemVersions: {
        "run-a::cheese": version(2, 1, "phone:2", {
          baseOperationId: "phone:1",
          chainId: "phone:1",
        }),
      },
    };
    const ownParent = {
      stagedItems: { "run-a::cheese": true },
      stagedItemVersions: { "run-a::cheese": version(1, 0, "phone:1") },
    };
    const otherDevice = {
      stagedItems: { "run-a::cheese": true },
      stagedItemVersions: { "run-a::cheese": version(1, 0, "tablet:1") },
    };

    expect(mergeStagedItemsFromPeer(queued, ownParent).stagedItems["run-a::cheese"]).toBe(false);
    expect(mergeStagedItemsFromPeer(queued, otherDevice).stagedItems["run-a::cheese"]).toBe(true);
  });

  it("preserves legacy checked rows but never lets them override a versioned uncheck", () => {
    const first = mergeStagedItemsOnServer(
      { stagedItems: { "run-a::cheese": true } },
      { stagedItems: { "run-a::cheese": false }, stagedItemVersions: { "run-a::cheese": version(1, 0, "phone:1") } },
    );
    const second = mergeStagedItemsOnServer(
      { stagedItems: { "run-a::legacy": true } },
      { stagedItems: { "run-a::legacy": false } },
    );

    expect(first.stagedItems["run-a::cheese"]).toBe(false);
    expect(second.stagedItems["run-a::legacy"]).toBe(true);
  });
});
