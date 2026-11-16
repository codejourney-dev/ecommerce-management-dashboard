
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";

// 1. Protect the test database before importing Prisma.
function assertTestDatabase(): void {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
        throw new Error("DATABASE_URL is required.");
    }

    const databaseName = new URL(databaseUrl).pathname;

    if (databaseName !== "/ecommerce_dashboard_migration_test") {
        throw new Error(
            "Refusing to run integration tests outside the test database."
        );
    }
}

assertTestDatabase();
const { createSessionCsrfToken } = await import(
    "../../src/services/csrf.service.js"
);

// 2. Import database-dependent modules after the guard.
const { prisma } = await import("../../src/config/prisma.js");

const { AdminStatus } = await import(
    "../../generated/prisma/client.js"
);

const { createAccessToken, hashRefreshToken } = await import(
    "../../src/services/token.service.js"
);

const { default: app } = await import("../../src/app.js");

// 3. Keep track of test admins for cleanup.
const adminIds: string[] = [];

afterAll(async () => {
    try {
        if (adminIds.length > 0) {
            await prisma.adminUser.deleteMany({
                where: {
                    id: { in: adminIds },
                },
            });
        }
    } finally {
        await prisma.$disconnect();
    }
});

// 4. Create an isolated test admin.
async function createTestAdmin(name: string) {
    const uniqueId = randomUUID();

    const admin = await prisma.adminUser.create({
        data: {
            name,
            email: `session-test-${uniqueId}@example.test`,
            phone: `+989${uniqueId.replaceAll("-", "").slice(0, 10)}`,
            passwordHash: "integration-test-only",
            status: AdminStatus.ACTIVE,
            phoneVerifiedAt: new Date(),
        },
    });

    adminIds.push(admin.id);

    return admin;
}

// 5. Create a session directly in the test database.
async function createTestSession(input: {
    adminId: string;
    expiresAt: Date;
    revokedAt?: Date | null;
    userAgent?: string;
}) {
    return prisma.adminSession.create({
        data: {
            adminUserId: input.adminId,
            refreshTokenHash: hashRefreshToken(randomUUID()),
            expiresAt: input.expiresAt,
            revokedAt: input.revokedAt ?? null,
            ipAddress: "127.0.0.1",
            userAgent: input.userAgent ?? "vitest-session-test",
        },
    });
}

async function createAuthenticatedAdminContext(adminId: string) {
    const currentSession = await createTestSession({
        adminId,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        userAgent: "edge-case-current-session",
    });

    const csrf = createSessionCsrfToken(
        currentSession.id,
        currentSession.expiresAt
    );

    await prisma.adminSession.update({
        where: { id: currentSession.id },
        data: { csrfTokenHash: csrf.tokenHash },
    });

    const accessToken = await createAccessToken(
        adminId,
        currentSession.id
    );

    const allowedOrigin = process.env.FRONTEND_ORIGINS
        ?.split(",")[0]
        ?.trim();

    if (!allowedOrigin) {
        throw new Error("FRONTEND_ORIGINS is not configured.");
    }

    return {
        currentSession,
        csrf,
        accessToken,
        allowedOrigin,
    };
}
describe("Admin Session Management API", () => {
    it("should return only the authenticated admin's active sessions", async () => {
        // Arrange: create two different admins.
        const adminA = await createTestAdmin("Session Test Admin A");
        const adminB = await createTestAdmin("Session Test Admin B");

        const now = new Date();

        // Admin A: current active session.
        const currentSession = await createTestSession({
            adminId: adminA.id,
            expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
            userAgent: "current-session",
        });

        // Admin A: another active session.
        const anotherActiveSession = await createTestSession({
            adminId: adminA.id,
            expiresAt: new Date(now.getTime() + 2 * 60 * 60 * 1000),
            userAgent: "another-active-session",
        });

        // Admin A: expired session.
        const expiredSession = await createTestSession({
            adminId: adminA.id,
            expiresAt: new Date(now.getTime() - 60 * 1000),
            userAgent: "expired-session",
        });

        // Admin A: revoked session.
        const revokedSession = await createTestSession({
            adminId: adminA.id,
            expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
            revokedAt: now,
            userAgent: "revoked-session",
        });

        // Admin B: active session that must remain private.
        const foreignSession = await createTestSession({
            adminId: adminB.id,
            expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
            userAgent: "foreign-session",
        });

        // Create a real access token for Admin A's current session.
        const accessToken = await createAccessToken(
            adminA.id,
            currentSession.id
        );

        // Act: request active sessions through the real Express app.
        const response = await request(app)
            .get("/api/auth/admin/sessions")
            .set("Authorization", `Bearer ${accessToken}`);

        // Assert: successful response.
        expect(response.status).toBe(200);
        expect(response.body.status).toBe("success");

        const sessions = response.body.data.sessions;

        expect(sessions).toHaveLength(2);

        const returnedIds = sessions.map(
            (session: { id: string }) => session.id
        );

        // Only Admin A's active sessions should be returned.
        expect(returnedIds).toContain(currentSession.id);
        expect(returnedIds).toContain(anotherActiveSession.id);

        expect(returnedIds).not.toContain(expiredSession.id);
        expect(returnedIds).not.toContain(revokedSession.id);
        expect(returnedIds).not.toContain(foreignSession.id);

        // The current session must be identified correctly.
        const currentResult = sessions.find(
            (session: { id: string }) =>
                session.id === currentSession.id
        );

        expect(currentResult?.isCurrent).toBe(true);

        const anotherResult = sessions.find(
            (session: { id: string }) =>
                session.id === anotherActiveSession.id
        );

        expect(anotherResult?.isCurrent).toBe(false);

        // Sensitive hashes must never appear in the API response.
        for (const session of sessions) {
            expect(session).not.toHaveProperty("refreshTokenHash");
            expect(session).not.toHaveProperty("csrfTokenHash");
        }
    });

    it("should not allow an admin to revoke another admin's session", async () => {
        // Arrange: create two admins.
        const adminA = await createTestAdmin("Revoke Test Admin A");
        const adminB = await createTestAdmin("Revoke Test Admin B");

        const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

        // Admin A's authenticated session.
        const currentSession = await createTestSession({
            adminId: adminA.id,
            expiresAt,
            userAgent: "admin-a-session",
        });

        // Admin B's session: the target of the revoke request.
        const foreignSession = await createTestSession({
            adminId: adminB.id,
            expiresAt,
            userAgent: "admin-b-session",
        });

        // Create and persist a valid CSRF token for Admin A.
        const csrf = createSessionCsrfToken(
            currentSession.id,
            currentSession.expiresAt
        );

        await prisma.adminSession.update({
            where: { id: currentSession.id },
            data: {
                csrfTokenHash: csrf.tokenHash,
            },
        });

        const accessToken = await createAccessToken(
            adminA.id,
            currentSession.id
        );

        // Act: Admin A attempts to revoke Admin B's session.
        const response = await request(app)
            .delete(`/api/auth/admin/sessions/${foreignSession.id}`)
            .set("Authorization", `Bearer ${accessToken}`)
            .set("Origin", "http://localhost:5173")
            .set("Cookie", `csrf_token=${csrf.token}`)
            .set("x-csrf-token", csrf.token);

        // Assert: the API must reject the request.
        expect(response.status).toBe(404);
        expect(response.body.message).toBe("Active session not found.");

        // Admin B's session must remain active.
        const unchangedSession = await prisma.adminSession.findUnique({
            where: { id: foreignSession.id },
        });

        expect(unchangedSession?.revokedAt).toBeNull();
    });

    it("should successfully revoke another active session owned by the authenticated admin", async () => {
        // Arrange: create an admin.
        const admin = await createTestAdmin("Session Revoke Test Admin");

        const now = new Date();

        // Create the current session.
        const currentSession = await createTestSession({
            adminId: admin.id,
            expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
            userAgent: "current-session",
        });

        // Create another active session owned by the same admin.
        const targetSession = await createTestSession({
            adminId: admin.id,
            expiresAt: new Date(now.getTime() + 2 * 60 * 60 * 1000),
            userAgent: "target-session",
        });

        // Create and persist a CSRF token bound to the current session.
        const csrf = createSessionCsrfToken(
            currentSession.id,
            currentSession.expiresAt
        );

        await prisma.adminSession.update({
            where: { id: currentSession.id },
            data: { csrfTokenHash: csrf.tokenHash },
        });

        // Create an access token for the current session.
        const accessToken = await createAccessToken(
            admin.id,
            currentSession.id
        );

        const allowedOrigin = process.env.FRONTEND_ORIGINS
            ?.split(",")[0]
            ?.trim();

        expect(allowedOrigin).toBeTruthy();

        // Act: revoke the other session.
        const response = await request(app)
            .delete(`/api/auth/admin/sessions/${targetSession.id}`)
            .set("Authorization", `Bearer ${accessToken}`)
            .set("Origin", allowedOrigin!)
            .set("Cookie", `csrf_token=${csrf.token}`)
            .set("x-csrf-token", csrf.token);

        // Assert: successful response.
        expect(response.status).toBe(200);
        expect(response.body.status).toBe("success");

        // The target session must be revoked in the database.
        const revokedSession = await prisma.adminSession.findUnique({
            where: { id: targetSession.id },
            select: {
                revokedAt: true,
            },
        });

        expect(revokedSession).not.toBeNull();
        expect(revokedSession?.revokedAt).not.toBeNull();

        // The current session must remain active.
        const unchangedCurrentSession = await prisma.adminSession.findUnique({
            where: { id: currentSession.id },
            select: {
                revokedAt: true,
            },
        });

        expect(unchangedCurrentSession?.revokedAt).toBeNull();

        // Cookies should not be cleared when revoking another session.
        expect(response.headers["set-cookie"]).toBeUndefined();
    });

    it("should revoke the current session, clear cookies, and reject its access token", async () => {
        // Arrange: create an admin and its current session.
        const admin = await createTestAdmin("Current Session Revoke Test");

        const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

        const currentSession = await createTestSession({
            adminId: admin.id,
            expiresAt,
            userAgent: "current-session",
        });

        // Generate and persist a CSRF token for this session.
        const csrf = createSessionCsrfToken(
            currentSession.id,
            currentSession.expiresAt
        );

        await prisma.adminSession.update({
            where: { id: currentSession.id },
            data: { csrfTokenHash: csrf.tokenHash },
        });

        const accessToken = await createAccessToken(
            admin.id,
            currentSession.id
        );

        const allowedOrigin = process.env.FRONTEND_ORIGINS
            ?.split(",")[0]
            ?.trim();

        expect(allowedOrigin).toBeTruthy();

        // Act: revoke the current session.
        const response = await request(app)
            .delete(`/api/auth/admin/sessions/${currentSession.id}`)
            .set("Authorization", `Bearer ${accessToken}`)
            .set("Origin", allowedOrigin!)
            .set("Cookie", `csrf_token=${csrf.token}`)
            .set("x-csrf-token", csrf.token);

        // Assert: the revoke request succeeds.
        expect(response.status).toBe(200);
        expect(response.body.status).toBe("success");

        // The session must be revoked in the database.
        const revokedSession = await prisma.adminSession.findUnique({
            where: { id: currentSession.id },
            select: {
                revokedAt: true,
            },
        });

        expect(revokedSession?.revokedAt).not.toBeNull();

        // Both session cookies must be cleared.
        const setCookieHeader = response.headers["set-cookie"];

        const setCookies = Array.isArray(setCookieHeader)
            ? setCookieHeader
            : setCookieHeader
                ? [setCookieHeader]
                : [];

        expect(setCookies).toHaveLength(2);

        expect(
            setCookies.some((cookie) =>
                cookie.startsWith("admin_refresh_token=;")
            )
        ).toBe(true);

        expect(
            setCookies.some((cookie) =>
                cookie.startsWith("csrf_token=;")
            )
        ).toBe(true);

        // The same access token must no longer authenticate the admin.
        const protectedResponse = await request(app)
            .get("/api/auth/admin/sessions")
            .set("Authorization", `Bearer ${accessToken}`);

        expect(protectedResponse.status).toBe(401);
    });

    it("should revoke all active sessions, clear cookies, and reject the current access token", async () => {
        // Arrange: create two admins.
        const adminA = await createTestAdmin("Revoke All Test");
        const adminB = await createTestAdmin("Other Admin Test");

        const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

        // Admin A: current session and another active session.
        const currentSession = await createTestSession({
            adminId: adminA.id,
            expiresAt,
            userAgent: "current-session",
        });

        const anotherSession = await createTestSession({
            adminId: adminA.id,
            expiresAt,
            userAgent: "another-session",
        });

        // Admin B: a session that must remain untouched.
        const foreignSession = await createTestSession({
            adminId: adminB.id,
            expiresAt,
            userAgent: "foreign-session",
        });

        // Generate and persist the CSRF token for the current session.
        const csrf = createSessionCsrfToken(
            currentSession.id,
            currentSession.expiresAt
        );

        await prisma.adminSession.update({
            where: { id: currentSession.id },
            data: { csrfTokenHash: csrf.tokenHash },
        });

        const accessToken = await createAccessToken(
            adminA.id,
            currentSession.id
        );

        const allowedOrigin = process.env.FRONTEND_ORIGINS
            ?.split(",")[0]
            ?.trim();

        expect(allowedOrigin).toBeTruthy();

        // Act: revoke all sessions belonging to Admin A.
        const response = await request(app)
            .post("/api/auth/admin/sessions/revoke-all")
            .set("Authorization", `Bearer ${accessToken}`)
            .set("Origin", allowedOrigin!)
            .set("Cookie", `csrf_token=${csrf.token}`)
            .set("x-csrf-token", csrf.token);

        // Assert: the request succeeds and reports two revoked sessions.
        expect(response.status).toBe(200);
        expect(response.body.status).toBe("success");
        expect(response.body.data.revokedCount).toBe(2);

        // Both sessions belonging to Admin A must be revoked.
        const adminASessions = await prisma.adminSession.findMany({
            where: { adminUserId: adminA.id },
            select: {
                id: true,
                revokedAt: true,
            },
        });

        expect(adminASessions).toHaveLength(2);
        expect(adminASessions.every((session) => session.revokedAt !== null))
            .toBe(true);

        // Admin B's session must remain active.
        const adminBSession = await prisma.adminSession.findUnique({
            where: { id: foreignSession.id },
            select: {
                revokedAt: true,
            },
        });

        expect(adminBSession?.revokedAt).toBeNull();

        // Both session cookies must be cleared.
        const setCookieHeader = response.headers["set-cookie"];

        const setCookies = Array.isArray(setCookieHeader)
            ? setCookieHeader
            : setCookieHeader
                ? [setCookieHeader]
                : [];

        expect(setCookies).toHaveLength(2);

        expect(
            setCookies.some((cookie) =>
                cookie.startsWith("admin_refresh_token=;")
            )
        ).toBe(true);

        expect(
            setCookies.some((cookie) =>
                cookie.startsWith("csrf_token=;")
            )
        ).toBe(true);

        // The current access token must no longer authenticate.
        const protectedResponse = await request(app)
            .get("/api/auth/admin/sessions")
            .set("Authorization", `Bearer ${accessToken}`);

        expect(protectedResponse.status).toBe(401);
    });

    it.each([
        "expired",
        "already-revoked",
        "unknown",
    ] as const)(
        "should return 404 when trying to revoke a %s session",
        async (targetState) => {
            // Arrange
            const admin = await createTestAdmin(
                `Revoke Edge Case ${targetState}`
            );

            const {
                accessToken,
                csrf,
                allowedOrigin,
            } = await createAuthenticatedAdminContext(admin.id);

            let targetSessionId: string;
            let originalRevokedAt: Date | null = null;

            if (targetState === "expired") {
                const targetSession = await createTestSession({
                    adminId: admin.id,
                    expiresAt: new Date(Date.now() - 60 * 1000),
                    userAgent: "expired-target-session",
                });

                targetSessionId = targetSession.id;
            } else if (targetState === "already-revoked") {
                originalRevokedAt = new Date(
                    Date.now() - 5 * 60 * 1000
                );

                const targetSession = await createTestSession({
                    adminId: admin.id,
                    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
                    revokedAt: originalRevokedAt,
                    userAgent: "already-revoked-session",
                });

                targetSessionId = targetSession.id;
            } else {
                targetSessionId = randomUUID();
            }

            // Act
            const response = await request(app)
                .delete(`/api/auth/admin/sessions/${targetSessionId}`)
                .set("Authorization", `Bearer ${accessToken}`)
                .set("Origin", allowedOrigin)
                .set("Cookie", `csrf_token=${csrf.token}`)
                .set("x-csrf-token", csrf.token);

            // Assert
            expect(response.status).toBe(404);
            expect(response.body.message).toBe(
                "Active session not found."
            );

            // Existing sessions must remain unchanged.
            if (targetState !== "unknown") {
                const unchangedSession = await prisma.adminSession.findUnique({
                    where: { id: targetSessionId },
                    select: {
                        revokedAt: true,
                    },
                });

                expect(unchangedSession).not.toBeNull();

                if (targetState === "expired") {
                    expect(unchangedSession?.revokedAt).toBeNull();
                } else {
                    expect(unchangedSession?.revokedAt).toEqual(
                        originalRevokedAt
                    );
                }
            }
        }
    );

    it("should revoke all unrevoked sessions, including expired ones, without changing already revoked or foreign sessions", async () => {
        // Arrange
        const adminA = await createTestAdmin(
            "Revoke All Edge Case Admin A"
        );

        const adminB = await createTestAdmin(
            "Revoke All Edge Case Admin B"
        );

        const {
            currentSession,
            accessToken,
            csrf,
            allowedOrigin,
        } = await createAuthenticatedAdminContext(adminA.id);

        // Admin A: another active session.
        const anotherActiveSession = await createTestSession({
            adminId: adminA.id,
            expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
            userAgent: "another-active-session",
        });

        // Admin A: expired but not revoked session.
        const expiredSession = await createTestSession({
            adminId: adminA.id,
            expiresAt: new Date(Date.now() - 60 * 1000),
            userAgent: "expired-unrevoked-session",
        });

        // Admin A: already revoked session.
        const originalRevokedAt = new Date(
            Date.now() - 5 * 60 * 1000
        );

        const alreadyRevokedSession = await createTestSession({
            adminId: adminA.id,
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
            revokedAt: originalRevokedAt,
            userAgent: "already-revoked-session",
        });

        // Admin B: session that must remain untouched.
        const foreignSession = await createTestSession({
            adminId: adminB.id,
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
            userAgent: "foreign-session",
        });

        // Act
        const response = await request(app)
            .post("/api/auth/admin/sessions/revoke-all")
            .set("Authorization", `Bearer ${accessToken}`)
            .set("Origin", allowedOrigin)
            .set("Cookie", `csrf_token=${csrf.token}`)
            .set("x-csrf-token", csrf.token);

        // Assert: current, another active, and expired sessions are revoked.
        expect(response.status).toBe(200);
        expect(response.body.status).toBe("success");
        expect(response.body.data.revokedCount).toBe(3);

        const adminASessions = await prisma.adminSession.findMany({
            where: { adminUserId: adminA.id },
            select: {
                id: true,
                revokedAt: true,
            },
        });

        const revokedAtById = new Map(
            adminASessions.map((session) => [
                session.id,
                session.revokedAt,
            ])
        );

        expect(revokedAtById.get(currentSession.id)).not.toBeNull();
        expect(revokedAtById.get(anotherActiveSession.id)).not.toBeNull();
        expect(revokedAtById.get(expiredSession.id)).not.toBeNull();

        // An already revoked session must not be counted or modified.
        expect(revokedAtById.get(alreadyRevokedSession.id)).toEqual(
            originalRevokedAt
        );

        // Another admin's session must remain untouched.
        const unchangedForeignSession = await prisma.adminSession.findUnique({
            where: { id: foreignSession.id },
            select: {
                revokedAt: true,
            },
        });

        expect(unchangedForeignSession?.revokedAt).toBeNull();
    });

    it("should revoke a session only once when two revoke requests run concurrently", async () => {
        // Arrange
        const admin = await createTestAdmin(
            "Concurrent Session Revoke Test"
        );

        const {
            accessToken,
            csrf,
            allowedOrigin,
        } = await createAuthenticatedAdminContext(admin.id);

        const targetSession = await createTestSession({
            adminId: admin.id,
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
            userAgent: "concurrent-revoke-target",
        });

        // Act: send two requests simultaneously.
        const responses = await Promise.all([
            request(app)
                .delete(`/api/auth/admin/sessions/${targetSession.id}`)
                .set("Authorization", `Bearer ${accessToken}`)
                .set("Origin", allowedOrigin)
                .set("Cookie", `csrf_token=${csrf.token}`)
                .set("x-csrf-token", csrf.token),

            request(app)
                .delete(`/api/auth/admin/sessions/${targetSession.id}`)
                .set("Authorization", `Bearer ${accessToken}`)
                .set("Origin", allowedOrigin)
                .set("Cookie", `csrf_token=${csrf.token}`)
                .set("x-csrf-token", csrf.token),
        ]);

        // Assert: exactly one request should revoke the session.
        const successCount = responses.filter(
            (response) => response.status === 200
        ).length;

        const notFoundCount = responses.filter(
            (response) => response.status === 404
        ).length;

        expect(successCount).toBe(1);
        expect(notFoundCount).toBe(1);

        // The session must be revoked exactly once.
        const finalSession = await prisma.adminSession.findUnique({
            where: { id: targetSession.id },
            select: {
                revokedAt: true,
            },
        });

        expect(finalSession).not.toBeNull();
        expect(finalSession?.revokedAt).not.toBeNull();
    });

    it("should immediately reject an access token when the admin is suspended", async () => {
        // Arrange
        const admin = await createTestAdmin(
            "Admin Status Change Test"
        );

        const {
            accessToken,
        } = await createAuthenticatedAdminContext(admin.id);

        // Initially, the admin should be authenticated.
        const initialResponse = await request(app)
            .get("/api/auth/admin/sessions")
            .set("Authorization", `Bearer ${accessToken}`);

        expect(initialResponse.status).toBe(200);

        // Act: suspend the admin.
        await prisma.adminUser.update({
            where: { id: admin.id },
            data: {
                status: AdminStatus.SUSPENDED,
            },
        });

        // Assert: the same access token must now be rejected.
        const suspendedResponse = await request(app)
            .get("/api/auth/admin/sessions")
            .set("Authorization", `Bearer ${accessToken}`);

        expect(suspendedResponse.status).toBe(401);

        // Restore the admin's status.
        await prisma.adminUser.update({
            where: { id: admin.id },
            data: {
                status: AdminStatus.ACTIVE,
            },
        });

        // The same token should work again.
        const restoredResponse = await request(app)
            .get("/api/auth/admin/sessions")
            .set("Authorization", `Bearer ${accessToken}`);

        expect(restoredResponse.status).toBe(200);
    });
});
