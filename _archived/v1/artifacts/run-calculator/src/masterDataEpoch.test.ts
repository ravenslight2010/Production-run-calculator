import { beforeEach, expect, it } from "vitest";
import { masterDataEpochReadReceipt, prepareMasterDataEpochRequest, masterDataEpoch, resetMasterDataEpochs } from "./masterDataEpoch";
beforeEach(() => resetMasterDataEpochs());
const receipt = (epoch: string) => new Response("{}", { headers: { "x-master-data-epoch": epoch } });
it("never rebases an already prepared request after a later canonical GET", () => {
  masterDataEpochReadReceipt("/api/ingredients")(receipt("1"));
  const prepared = prepareMasterDataEpochRequest("/api/ingredients", { method: "POST", body: "{}" });
  masterDataEpochReadReceipt("/api/ingredients")(receipt("2"));
  expect(new Headers(prepareMasterDataEpochRequest("/api/ingredients", prepared)?.headers).get("x-master-data-epoch")).toBe("1");
  expect(new Headers(prepareMasterDataEpochRequest("/api/ingredients", { method: "POST" })?.headers).get("x-master-data-epoch")).toBe("2");
});
it("ignores old-identity receipts, mutation responses, unrelated resources and foreign origins", () => {
  const old = masterDataEpochReadReceipt("/api/ingredients");
  resetMasterDataEpochs(); old(receipt("9"));
  masterDataEpochReadReceipt("/api/ingredients", { method: "POST" })(receipt("9"));
  masterDataEpochReadReceipt("https://outside.invalid/api/ingredients")(receipt("9"));
  masterDataEpochReadReceipt("/api/me")(receipt("9"));
  expect(masterDataEpoch("ingredients")).toBe("unbound");
});
it("binds all bootstrap pools but never unrelated operational commands", () => {
  masterDataEpochReadReceipt("/api/master-data/bootstrap")(receipt("4"));
  expect(masterDataEpoch("ingredients")).toBe("4");
  expect(masterDataEpoch("mixes")).toBe("4");
  const operational = { method: "POST", body: "{}" };
  expect(prepareMasterDataEpochRequest("/api/sync/operational-intents", operational)).toBe(operational);
});
