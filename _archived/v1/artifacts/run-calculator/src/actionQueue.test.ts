import { describe, expect, it } from "vitest";
import { actionQueueDestination } from "./actionQueue";

describe("actionQueueDestination", () => {
  it.each([
    ["incident", { kind: "tab", tab: "incidents" }],
    ["sync", { kind: "tab", tab: "summary" }],
    ["import", { kind: "manage", category: "import" }],
    ["production-rule", { kind: "manage", category: "rules" }],
    ["data-health", { kind: "manage", category: "audit" }],
    ["report", { kind: "manage", category: "audit" }],
  ] as const)("routes %s items to their owning workflow", (sourceType, expected) => {
    expect(actionQueueDestination({ sourceType })).toEqual(expected);
  });
});