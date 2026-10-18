import { describe, expect, it } from "vitest";
import { serializeErrorForLog } from "./logger";

describe("safe error log serialization", () => {
  it("retains bounded error identity without serializing diagnostic payloads", () => {
    const sensitiveValue = "synthetic-lease-value";
    const error = Object.assign(
      new Error(`Failed query: select * from server_jobs where lease_token = ${sensitiveValue}`),
      {
        code: "08006",
        query: "select * from server_jobs where lease_token = $1",
        params: [sensitiveValue],
      },
    );

    const serialized = serializeErrorForLog(error);

    expect(serialized).toEqual({ type: "Error", code: "08006" });
    expect(JSON.stringify(serialized)).not.toContain(sensitiveValue);
    expect(serialized).not.toHaveProperty("message");
    expect(serialized).not.toHaveProperty("query");
    expect(serialized).not.toHaveProperty("params");
  });

  it("does not copy arbitrary thrown values into logs", () => {
    expect(serializeErrorForLog("sensitive thrown value")).toEqual({ type: "NonError" });
  });
});
