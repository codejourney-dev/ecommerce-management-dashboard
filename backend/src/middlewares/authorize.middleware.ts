
import type { RequestHandler } from "express";
import { hasPermission } from "../services/permission.service.js";

export function authorize(
  permissionName: string
): RequestHandler {
  return async (req, res, next) => {
    try {
      // Check authentication
      if (!req.adminAuth) {
        res.status(401).json({
          status: "error",
          message: "Authentication required.",
        });
        return;
      }

      // Check permission
      const allowed = await hasPermission(
        req.adminAuth.adminUserId,
        permissionName
      );

      if (!allowed) {
        res.status(403).json({
          status: "error",
          message: "You do not have permission to perform this action.",
        });
        return;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
