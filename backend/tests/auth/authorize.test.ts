
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
}));

vi.mock("../../src/services/permission.service.js", () => ({
  hasPermission: mocks.hasPermission,
}));

import { authorize } from "../../src/middlewares/authorize.middleware.js";

function createMocks(adminAuth?: {
  adminUserId: string;
  sessionId: string;
}) {
  const req = {
    adminAuth,
  } as unknown as Request;

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;

  const next = vi.fn() as NextFunction;

  return { req, res, next };
}

describe("Authorization Middleware", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("should return 401 when admin is not authenticated", async () => {
    const { req, res, next } = createMocks();

    await authorize("products.create")(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mocks.hasPermission).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("should return 403 when admin does not have permission", async () => {
    mocks.hasPermission.mockResolvedValue(false);

    const { req, res, next } = createMocks({
      adminUserId: "admin-123",
      sessionId: "session-123",
    });

    await authorize("products.create")(req, res, next);

    expect(mocks.hasPermission).toHaveBeenCalledWith(
      "admin-123",
      "products.create"
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("should call next when admin has permission", async () => {
    mocks.hasPermission.mockResolvedValue(true);

    const { req, res, next } = createMocks({
      adminUserId: "admin-123",
      sessionId: "session-123",
    });

    await authorize("products.create")(req, res, next);

    expect(mocks.hasPermission).toHaveBeenCalledWith(
      "admin-123",
      "products.create"
    );
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("should pass permission service errors to the error handler", async () => {
    const error = new Error("Database connection failed");
    mocks.hasPermission.mockRejectedValue(error);

    const { req, res, next } = createMocks({
      adminUserId: "admin-123",
      sessionId: "session-123",
    });

    await authorize("products.create")(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(res.status).not.toHaveBeenCalled();
  });
});
