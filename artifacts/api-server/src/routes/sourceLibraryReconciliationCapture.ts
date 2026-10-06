import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import { CaptureSourceLibraryReconciliationBody } from "@workspace/api-zod";
import { pool } from "@workspace/db";
import { getBuildInfo } from "../lib/buildInfo";
import {
  captureSourceLibraryReconciliation,
  SOURCE_LIBRARY_CAPTURE_REQUEST_MAX_BYTES,
  SourceLibraryCaptureFailure,
} from "../lib/sourceLibraryReconciliationCapture";
import {
  requireCapability,
  requireLiveScope,
  requireManagerRole,
} from "../middlewares/requireCapability";

const REPORT_FILE = "source-library-reconciliation-report.json";
const REPORT_SHA_FILE = "source-library-reconciliation-report.sha256";
const SOURCE_REPORT_PATH =
  "attached_assets/source-library/audits/source-library-reconciliation-2026-08-26.json";
const SOURCE_REPORT_SHA_PATH =
  "attached_assets/source-library/audits/source-library-reconciliation-2026-08-26.sha256";

function readReviewedReportBundle(): { reportBytes: Buffer; reviewedReportSha256: string } {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const baseDirectory =
    process.env.NODE_ENV === "production"
      ? moduleDirectory
      : path.resolve(moduleDirectory, "../../../../");
  const reportPath =
    process.env.NODE_ENV === "production"
      ? path.join(baseDirectory, REPORT_FILE)
      : path.resolve(baseDirectory, SOURCE_REPORT_PATH);
  const reportShaPath =
    process.env.NODE_ENV === "production"
      ? path.join(baseDirectory, REPORT_SHA_FILE)
      : path.resolve(baseDirectory, SOURCE_REPORT_SHA_PATH);
  return {
    reportBytes: fs.readFileSync(reportPath),
    reviewedReportSha256: fs.readFileSync(reportShaPath, "utf8").trim(),
  };
}

const router = Router();

router.post(
  "/profile-data/source-library-reconciliation/capture",
  (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  },
  requireLiveScope,
  requireCapability("manage-staff"),
  requireManagerRole,
  async (req, res): Promise<void> => {
    const serializedBody = JSON.stringify(req.body);
    if (
      serializedBody !== undefined &&
      Buffer.byteLength(serializedBody, "utf8") >
        SOURCE_LIBRARY_CAPTURE_REQUEST_MAX_BYTES
    ) {
      res.status(413).json({ error: "Request body too large" });
      return;
    }

    const parsed = CaptureSourceLibraryReconciliationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid source-library capture request" });
      return;
    }

    try {
      const report = readReviewedReportBundle();
      const output = await captureSourceLibraryReconciliation(
        parsed.data,
        {
          pool,
          ...report,
          buildInfo: getBuildInfo(),
        },
      );
      res.status(200).json(output);
    } catch (error) {
      if (error instanceof SourceLibraryCaptureFailure) {
        req.log.warn(
          { captureFailure: error.code, statusCode: error.statusCode },
          "source-library reconciliation capture did not complete",
        );
        res.status(error.statusCode).json({ error: error.publicMessage });
        return;
      }
      req.log.error(
        { captureFailure: "unexpected" },
        "source-library reconciliation capture failed",
      );
      res.status(500).json({ error: "Source-library reconciliation capture failed" });
    }
  },
);

export default router;
