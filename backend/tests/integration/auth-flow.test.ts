
import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import {
    createSessionCsrfToken,
    generateSessionCsrfToken,
} from "../../src/services/csrf.service.js";

const mocks = vi.hoisted(() => ({
    adminLogin: vi.fn(),
    verifyAdminOtp: vi.fn(),
    refreshAdminSession: vi.fn(),
    revokeAdminSession: vi.fn(),
    verifyAccessToken: vi.fn(),
    findSession: vi.fn(),
    sessionActive: true,
    updateSession: vi.fn(),
    findCsrfSession: vi.fn(),
    sessionCsrfTokenHash: null as string | null,
}));

vi.mock("../../src/services/auth.service.js", () => ({
    adminLogin: mocks.adminLogin,
    verifyAdminOtp: mocks.verifyAdminOtp,
}));

vi.mock("../../src/services/session.service.js", () => ({
    refreshAdminSession: mocks.refreshAdminSession,
    revokeAdminSession: mocks.revokeAdminSession,
}));

vi.mock("../../src/services/token.service.js", () => ({
    verifyAccessToken: mocks.verifyAccessToken,
}));

vi.mock("../../src/config/prisma.js", () => ({
    prisma: {
        adminSession: {
            findFirst: mocks.findSession,
            updateMany: mocks.updateSession,
            findUnique: mocks.findCsrfSession,
        },
    },
}));

import app from "../../src/app.js";
import { authenticateAdmin } from "../../src/middlewares/authenticate.middleware.js";

// Test-only protected route
app.get(
    "/api/test/protected",
    authenticateAdmin,
    (req, res) => {
        res.status(200).json({
            status: "success",
            adminUserId: req.adminAuth?.adminUserId,
        });
    }
);

describe("Authentication Flow Integration", () => {
    const allowedOrigin = "http://localhost:5173";
    let sessionExpiresAt: Date;
    beforeEach(() => {
        vi.resetAllMocks();
        sessionExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const initialCsrf = createSessionCsrfToken("session-123",sessionExpiresAt);
        mocks.sessionCsrfTokenHash = initialCsrf.tokenHash;
        mocks.sessionActive = true;
        mocks.adminLogin.mockResolvedValue({
            challengeId: "challenge-123",
            expiresAt: new Date(Date.now() + 120_000),
        });
        mocks.verifyAdminOtp.mockResolvedValue({
            admin: {
                id: "admin-123",
                name: "Test Admin",
            },
            session: {
                sessionId: "session-123",
                accessToken: "access-token-123",
                refreshToken: "refresh-token-123",
                csrfToken: initialCsrf.token,
                expiresAt: sessionExpiresAt,
            },
        });
        mocks.refreshAdminSession.mockImplementation(async () => {
            const expiresAt = new Date(
                Date.now() + 7 * 24 * 60 * 60 * 1000
            );

            const csrf = await generateSessionCsrfToken(
                "session-123",
                expiresAt
            );
            sessionExpiresAt = expiresAt;
            return {
                admin: {
                    id: "admin-123",
                    name: "Test Admin",
                },
                sessionId: "session-123",
                accessToken: "refreshed-access-token",
                refreshToken: "rotated-refresh-token",
                csrfToken: csrf.token,
                expiresAt,
            };
        });
        mocks.revokeAdminSession.mockImplementation(async () => {
            mocks.sessionActive = false;
        });
        mocks.verifyAccessToken.mockResolvedValue({
            adminId: "admin-123",
            sessionId: "session-123",
        });
        mocks.findSession.mockImplementation(async () => {
            return mocks.sessionActive
                ? { id: "session-123" }
                : null;
        });
        mocks.updateSession.mockImplementation(async (args) => {
            if (args.data.csrfTokenHash) {
                mocks.sessionCsrfTokenHash = args.data.csrfTokenHash;
            }
            if (args.data.expiresAt) {
                sessionExpiresAt = args.data.expiresAt;
            }
            return { count: 1 };
        });
        mocks.findCsrfSession.mockImplementation(async () => ({
            csrfTokenHash: mocks.sessionCsrfTokenHash,
            expiresAt: sessionExpiresAt,
            revokedAt: null,
        }));
    });

    it("should complete login, OTP, protected access, refresh and logout", async () => {
        const agent = request.agent(app);

        // 1. Obtain CSRF token
        const csrfResponse = await agent
            .get("/api/auth/csrf")
            .set("Origin", allowedOrigin);

        expect(csrfResponse.status).toBe(200);

        const csrfToken: unknown =
            csrfResponse.body.data?.csrfToken;

        if (
            typeof csrfToken !== "string" ||
            !csrfToken
        ) {
            throw new Error("Failed to obtain CSRF token.");
        }

        // 2. Admin login
        const loginResponse = await agent
            .post("/api/auth/admin/login")
            .set("Origin", allowedOrigin)
            .set("X-CSRF-Token", csrfToken)
            .send({
                email: "admin@example.com",
                password: "StrongPassword123!",
            });

        expect(loginResponse.status).toBe(200);
        expect(loginResponse.body.data.challengeId).toBe(
            "challenge-123"
        );

        // 3. Verify OTP and create session
        const otpResponse = await agent
            .post("/api/auth/admin/verify-otp")
            .set("Origin", allowedOrigin)
            .set("X-CSRF-Token", csrfToken)
            .send({
                challengeId: "challenge-123",
                otp: "123456",
            });

        expect(otpResponse.status).toBe(200);
        const sessionCsrfToken: unknown = otpResponse.body.data?.csrfToken;
        if (
            typeof sessionCsrfToken !== "string" ||
            !sessionCsrfToken
        ) {
            throw new Error("Failed to obtain session CSRF token.");
        }
        expect(otpResponse.body.data.accessToken).toBe(
            "access-token-123"
        );
        expect(otpResponse.headers["set-cookie"]).toBeDefined();

        // 4. Access protected route
        const protectedResponse = await agent
            .get("/api/test/protected")
            .set("Authorization", "Bearer access-token-123");

        expect(protectedResponse.status).toBe(200);
        expect(protectedResponse.body.adminUserId).toBe("admin-123");

        // 5. Refresh session
        const refreshResponse = await agent
          .post("/api/auth/admin/refresh")
          .set("Origin", allowedOrigin)
          .set("X-CSRF-Token", sessionCsrfToken);expect(refreshResponse.status).toBe(200);
        expect(refreshResponse.body.data.accessToken).toBe(
            "refreshed-access-token"
        );
        expect(refreshResponse.body.data.csrfToken).not.toBe(
            sessionCsrfToken
        );
        // 6. Access protected route with refreshed token
        const refreshedAccessResponse = await agent
            .get("/api/test/protected")
            .set("Authorization", "Bearer refreshed-access-token");
        
        expect(refreshedAccessResponse.status).toBe(200);

        const refreshedCsrfToken: unknown =
            refreshResponse.body.data?.csrfToken;
        if (
            typeof refreshedCsrfToken !== "string" ||
            !refreshedCsrfToken
        ) {
            throw new Error("Failed to obtain refreshed CSRF token.");
        }

        // 7. Logout
        const logoutResponse = await agent
          .post("/api/auth/admin/logout")
          .set("Origin", allowedOrigin)
          .set("X-CSRF-Token", refreshedCsrfToken);

        expect(logoutResponse.status).toBe(200);

        expect(mocks.revokeAdminSession).toHaveBeenCalledWith(
            "rotated-refresh-token"
        );
        expect(logoutResponse.headers["set-cookie"]).toBeDefined();
        // 8. Access must be denied after logout
        const afterLogoutResponse = await agent
            .get("/api/test/protected")
            .set("Authorization", "Bearer refreshed-access-token");

        expect(afterLogoutResponse.status).toBe(401);
    });
});