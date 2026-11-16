
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";

const mocks = vi.hoisted(() => ({
  findSession: vi.fn(),
  verifyAccessToken: vi.fn(),
}));

vi.mock("../../src/config/prisma.js", () => ({
  prisma: {
    adminSession: {
      findFirst: mocks.findSession,
    },
  },
}));

vi.mock("../../src/services/token.service.js", () => ({
  verifyAccessToken: mocks.verifyAccessToken,
}));

import { authenticateAdmin } from "../../src/middlewares/authenticate.middleware.js";

function createMocks(authorization?: string) {
  const req = {
    headers: {
      authorization,
    },
  } as unknown as Request;

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;

  const next = vi.fn() as NextFunction;

  return { req, res, next };
}

describe("Authentication Middleware", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("should return 401 when Authorization header is missing", async () => {
    const { req, res, next } = createMocks();

    await authenticateAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      status: "error",
      message: "Authentication required.",
    });

    expect(mocks.verifyAccessToken).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("should return 401 when the token is invalid", async () => {
    mocks.verifyAccessToken.mockResolvedValue(null);

    const { req, res, next } = createMocks("Bearer invalid-token");

    await authenticateAdmin(req, res, next);

    expect(mocks.verifyAccessToken).toHaveBeenCalledWith("invalid-token");
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      status: "error",
      message: "Invalid or expired access token.",
    });

    expect(next).not.toHaveBeenCalled();
  });

  it("should return 401 when the session is invalid", async () => {
    mocks.verifyAccessToken.mockResolvedValue({
      adminId: "admin-123",
      sessionId: "session-123",
    });

    mocks.findSession.mockResolvedValue(null);

    const { req, res, next } = createMocks("Bearer valid-token");

    await authenticateAdmin(req, res, next);

    expect(mocks.findSession).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      status: "error",
      message: "Session is invalid or expired.",
    });

    expect(next).not.toHaveBeenCalled();
  });

  it("should attach admin information and call next when authentication succeeds", async () => {
    mocks.verifyAccessToken.mockResolvedValue({
      adminId: "admin-123",
      sessionId: "session-123",
    });

    mocks.findSession.mockResolvedValue({
      id: "session-123",
    });

    const { req, res, next } = createMocks("Bearer valid-token");

    await authenticateAdmin(req, res, next);

    expect(req.adminAuth).toEqual({
      adminUserId: "admin-123",
      sessionId: "session-123",
    });

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("should pass database errors to the error handler", async () => {
    const error = new Error("Database connection failed");

    mocks.verifyAccessToken.mockResolvedValue({
      adminId: "admin-123",
      sessionId: "session-123",
    });

    mocks.findSession.mockRejectedValue(error);

    const { req, res, next } = createMocks("Bearer valid-token");

    await authenticateAdmin(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(res.status).not.toHaveBeenCalled();
  });
});
