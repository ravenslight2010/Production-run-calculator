import { beforeEach, describe, expect, it } from "vitest";
import { claimAlertReceipt, hasAlertReceipt, recordAlertReceipt } from "./alertReceipts";

describe("local push alert receipt dedupe", () => {
  beforeEach(() => localStorage.clear());

  it("recognizes a received stable alert ID", async () => {
    await recordAlertReceipt("run-7:batch:3");
    await expect(hasAlertReceipt("run-7:batch:3")).resolves.toBe(true);
    await expect(hasAlertReceipt("run-7:batch:4")).resolves.toBe(false);
  });

  it("keeps receipt storage bounded", async () => {
    for (let index = 0; index < 205; index += 1) await recordAlertReceipt(`alert-${index}`);
    await expect(hasAlertReceipt("alert-0")).resolves.toBe(false);
    await expect(hasAlertReceipt("alert-204")).resolves.toBe(true);
  });

  it("allows only one concurrent claimant to display an alert", async () => {
    const claims = await Promise.all([
      claimAlertReceipt("same-logical-alert"),
      claimAlertReceipt("same-logical-alert"),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
  });
});