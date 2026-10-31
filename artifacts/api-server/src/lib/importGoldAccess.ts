import type { RequestHandler } from "express";
import { requireAnyCapability } from "../middlewares/requireCapability";

export const requireGoldRetentionCapability = requireAnyCapability(["manage-staff", "manage-qc"]);

export const requireGoldRetentionRole: RequestHandler = (req, res, next) => {
  // Capability alone does not grant this source-approval/retention surface.
  if (req.role === "manager" || req.role === "qc-manager") {
    next();
    return;
  }
  res.status(403).json({ error: "Manager or QC Manager role required" });
};
