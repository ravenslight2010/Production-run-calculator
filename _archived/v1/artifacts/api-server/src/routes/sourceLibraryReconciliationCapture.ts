import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import { CaptureSourceLibraryReconciliationBody } from "@workspace/api-zod";
import { pool } from "@workspace/db";
import { rateLimit } from "../middlewares/rateLimit";
import { PostgresRateLimitStore } from "../middlewares/rateLimitStore";
import { getBuildInfo } from "../lib/buildInfo";
import {
  captureSourceLibraryReconciliation,
  captureSourceLibraryReconciliationDiagnosticsFromPublishedApp,
  captureSourceLibraryReconciliationFromPublishedApp,
  SOURCE_LIBRARY_CAPTURE_REQUEST_MAX_BYTES,
  SourceLibraryCaptureFailure,
} from "../lib/sourceLibraryReconciliationCapture";
import {
  DEFAULT_SOURCE_LIBRARY_POOL_EXCEPTIONS,
  loadSourceLibraryPoolExceptionApproval,
} from "../../../../scripts/src/source-library-reconciliation-capture-core.mjs";
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
const POOL_EXCEPTION_FILE = path.basename(DEFAULT_SOURCE_LIBRARY_POOL_EXCEPTIONS);

function readReviewedReportBundle(): {
  reportBytes: Buffer;
  reviewedReportSha256: string;
  poolExceptionApproval: ReturnType<typeof loadSourceLibraryPoolExceptionApproval>;
} {
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
  const poolExceptionPath =
    process.env.NODE_ENV === "production"
      ? path.join(baseDirectory, POOL_EXCEPTION_FILE)
      : path.resolve(baseDirectory, DEFAULT_SOURCE_LIBRARY_POOL_EXCEPTIONS);
  const reportBytes = fs.readFileSync(reportPath);
  return {
    reportBytes,
    reviewedReportSha256: fs.readFileSync(reportShaPath, "utf8").trim(),
    poolExceptionApproval: loadSourceLibraryPoolExceptionApproval(
      poolExceptionPath,
      reportBytes,
      baseDirectory,
    ),
  };
}

const router = Router();

const publicCaptureRateWindowMs = 15 * 60 * 1000;
const publicCaptureRateLimit = rateLimit({
  windowMs: publicCaptureRateWindowMs,
  max: 5,
  keyGenerator: () => "source-library-public-capture",
  store:
    process.env.NODE_ENV === "production"
      ? new PostgresRateLimitStore(publicCaptureRateWindowMs, {
          enableSweep: false,
        })
      : undefined,
});

export const publicSourceLibraryReconciliationCaptureRouter = Router();

publicSourceLibraryReconciliationCaptureRouter.get(
  "/profile-data/source-library-reconciliation/capture",
  (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  },
  publicCaptureRateLimit,
  async (req, res): Promise<void> => {
    if (process.env.NODE_ENV !== "production") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    try {
      const report = readReviewedReportBundle();
      const output = await captureSourceLibraryReconciliationFromPublishedApp({
        pool,
        ...report,
        buildInfo: getBuildInfo(),
      });
      res.status(200).json(output);
    } catch (error) {
      if (error instanceof SourceLibraryCaptureFailure) {
        req.log.warn(
          { captureFailure: error.code, statusCode: error.statusCode },
          "public source-library reconciliation capture did not complete",
        );
        res.status(error.statusCode).json({ error: error.publicMessage });
        return;
      }
      req.log.error(
        { captureFailure: "unexpected" },
        "public source-library reconciliation capture failed",
      );
      res.status(500).json({
        error: "Source-library reconciliation capture failed",
      });
    }
  },
);

publicSourceLibraryReconciliationCaptureRouter.get(
  "/profile-data/source-library-reconciliation/diagnostics",
  (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  },
  publicCaptureRateLimit,
  async (req, res): Promise<void> => {
    if (process.env.NODE_ENV !== "production") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    try {
      const report = readReviewedReportBundle();
      const output =
        await captureSourceLibraryReconciliationDiagnosticsFromPublishedApp({
          pool,
          ...report,
          buildInfo: getBuildInfo(),
        });
      res.status(200).json(output);
    } catch (error) {
      if (error instanceof SourceLibraryCaptureFailure) {
        req.log.warn(
          { captureFailure: error.code, statusCode: error.statusCode },
          "public source-library reconciliation diagnostics did not complete",
        );
        res.status(error.statusCode).json({ error: error.publicMessage });
        return;
      }
      req.log.error(
        { captureFailure: "unexpected" },
        "public source-library reconciliation diagnostics failed",
      );
      res.status(500).json({
        error: "Source-library reconciliation diagnostics failed",
      });
    }
  },
);

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
