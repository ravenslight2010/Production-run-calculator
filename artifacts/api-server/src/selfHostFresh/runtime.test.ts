import { afterAll, describe, expect, it, vi } from "vitest";
import express from "express";
import { once } from "node:events";
import type { Server } from "node:http";
const log = vi.hoisted(() => vi.fn());
vi.mock("../lib/logger", () => ({ logger: { info: log } }));
vi.mock("@workspace/db", () => {
  throw new Error("Fresh authority boundary must not import a database");
});
import * as heals from "./dataHeals";
import { sourceLibraryReconciliationStatus } from "./sourceReconciliation";
import router, {
  publicSourceLibraryReconciliationCaptureRouter,
} from "./captureRoutes";

const servers: Server[] = [];
afterAll(() => {
  for (const server of servers) {
    server.closeAllConnections();
    server.close();
  }
});
describe("fresh compiled runtime authority", () => {
  it("does not execute/claim historical repairs or manufacture marker results", async () => {
    await heals.runDataHeals();
    expect(heals.AUTOMATIC_DATA_HEAL_IDS).toEqual([]);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ event: "legacy_repairs_not_applicable" }),
      expect.any(String),
    );
    for (const operation of [
      heals.registeredAutomaticDataHeals,
      heals.runProfileNameLinkStubPurge,
      heals.runWorkbookImportStubPurge,
      heals.runAug19SavedSpecProfileRepair,
      heals.runAug19SavedSpecProfileRepairV2,
      heals.runSourceLibraryReconciliationHeal,
      heals.runSourceLibraryReconciliationHealV2,
      heals.runSpecAliasContextHygieneRepair,
    ]) {
      expect(operation).toThrow(/authority is unavailable/);
    }
  });
  it("reports the absent historical audit honestly without report/SHA/marker/count proof", async () => {
    expect(await sourceLibraryReconciliationStatus()).toEqual({
      status: "not-applicable",
      buildProfile: "self-host-fresh",
      reason: "legacy-production-audit-not-packaged",
      findings: [],
    });
  });
  it.each(["public", "private"])(
    "rejects every capture/diagnostics method with the %s router before DB/report work",
    async (name) => {
      const app = express();
      app.use(
        "/api",
        name === "public"
          ? publicSourceLibraryReconciliationCaptureRouter
          : router,
      );
      const server = app.listen(0, "127.0.0.1");
      servers.push(server);
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Missing test port");
      for (const endpoint of ["capture", "diagnostics"])
        for (const method of [
          "GET",
          "POST",
          "PUT",
          "DELETE",
          "OPTIONS",
          "HEAD",
        ]) {
          const response = await fetch(
            `http://127.0.0.1:${address.port}/api/profile-data/source-library-reconciliation/${endpoint}`,
            { method },
          );
          expect(response.status).toBe(409);
          expect(response.headers.get("cache-control")).toBe("no-store");
          if (method !== "HEAD")
            expect(await response.json()).toEqual({
              status: "not-applicable",
              buildProfile: "self-host-fresh",
              reason: "legacy-production-audit-not-packaged",
            });
        }
    },
  );
});
