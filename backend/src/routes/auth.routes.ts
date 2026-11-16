import { Router } from "express";
import {
    adminLoginController,
    verifyAdminOtpController,
    refreshAdminSessionController,
    logoutAdminController,
    getAdminSessionsController,
    revokeAdminSessionController,
    revokeAllAdminSessionsController,
} from "../controllers/auth.controller.js";
import {
    issuePreAuthCsrfToken,
    verifyPreAuthCsrf,
    verifySessionCsrf,
} from "../middlewares/csrf.middleware.js";
import { authenticateAdmin } from "../middlewares/authenticate.middleware.js";

const router = Router();
//Retrieve CSRF Token
router.get("/csrf", issuePreAuthCsrfToken);
// Admin authentication
router.post("/admin/login", verifyPreAuthCsrf, adminLoginController);
router.post("/admin/verify-otp", verifyPreAuthCsrf, verifyAdminOtpController);

router.post("/admin/refresh", verifySessionCsrf, refreshAdminSessionController);
router.post("/admin/logout", verifySessionCsrf, logoutAdminController);
// Active session management
router.get("/admin/sessions", authenticateAdmin, getAdminSessionsController);
router.delete("/admin/sessions/:sessionId", authenticateAdmin, verifySessionCsrf, revokeAdminSessionController);
router.post("/admin/sessions/revoke-all", authenticateAdmin, verifySessionCsrf, revokeAllAdminSessionsController);
export default router;