
import type { RequestHandler } from "express";
import { prisma } from "../config/prisma.js";
import { verifyAccessToken } from "../services/token.service.js";

export const authenticateAdmin: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const authHeader = req.headers.authorization;

    // Check Authorization header
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({
        status: "error",
        message: "Authentication required.",
      });
      return;
    }

    const token = authHeader.slice(7);

    // Verify JWT
    const payload = await verifyAccessToken(token);

    if (!payload) {
      res.status(401).json({
        status: "error",
        message: "Invalid or expired access token.",
      });
      return;
    }

    // Verify session and admin status
    const session = await prisma.adminSession.findFirst({
      where: {
        id: payload.sessionId,
        adminUserId: payload.adminId,
        revokedAt: null,
        expiresAt: {
          gt: new Date(),
        },
        adminUser: {
          is: {
            status: "ACTIVE",
            deletedAt: null,
            phoneVerifiedAt: {
              not: null,
            },
          },
        },
      },
      select: {
        id: true,
      },
    });

    if (!session) {
      res.status(401).json({
        status: "error",
        message: "Session is invalid or expired.",
      });
      return;
    }

    // Attach authenticated admin to request
    req.adminAuth = {
      adminUserId: payload.adminId,
      sessionId: payload.sessionId,
    };

    next();
  } catch (error) {
    next(error);
  }
};
