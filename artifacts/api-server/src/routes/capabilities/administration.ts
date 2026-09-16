import { Router, type IRouter } from "express";
import rolesRouter from "../roles";
import webPushRouter from "../webPush";
import masterDataHealthRouter from "../masterDataHealth";
import profileDataHealthRouter from "../profileDataHealth";
import supervisorPinRouter from "../supervisorPin";
import sandboxRouter from "../sandbox";
import auditLogsRouter from "../auditLogs";
import backgroundOperationDiagnosticsRouter from "../backgroundOperationDiagnostics";

/** Staff access, diagnostics, audit, and controlled administrative operations. */
const router: IRouter = Router();

router.use(rolesRouter);
router.use(webPushRouter);
router.use(masterDataHealthRouter);
router.use(profileDataHealthRouter);
router.use(supervisorPinRouter);
router.use(sandboxRouter);
router.use(auditLogsRouter);
router.use(backgroundOperationDiagnosticsRouter);

export default router;