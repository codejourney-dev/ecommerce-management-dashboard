
import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";

import { AdminStatus } from "../../generated/prisma/client.js";

const mocks = vi.hoisted(() => ({
    transaction: vi.fn(),

    sessionCreate: vi.fn(),
    sessionUpdate: vi.fn(),
    sessionUpdateMany: vi.fn(),

    refreshTokenFindUnique: vi.fn(),
    refreshTokenUpdateMany: vi.fn(),
    refreshTokenCreate: vi.fn(),

    createAccessToken: vi.fn(),
    generateRefreshToken: vi.fn(),
    hashRefreshToken: vi.fn(),

    createSessionCsrfToken: vi.fn(),
}));

vi.mock("../../src/config/prisma.js", () => ({
    prisma: {
        $transaction: mocks.transaction,

        adminSession: {
            create: mocks.sessionCreate,
            update: mocks.sessionUpdate,
            updateMany: mocks.sessionUpdateMany,
        },

        adminRefreshToken: {
            findUnique: mocks.refreshTokenFindUnique,
            updateMany: mocks.refreshTokenUpdateMany,
            create: mocks.refreshTokenCreate,
        },
    },
}));

vi.mock("../../src/services/token.service.js", () => ({
    createAccessToken: mocks.createAccessToken,
    generateRefreshToken: mocks.generateRefreshToken,
    hashRefreshToken: mocks.hashRefreshToken,
}));

vi.mock("../../src/services/csrf.service.js", () => ({
    createSessionCsrfToken: mocks.createSessionCsrfToken,
}));

import {
    createAdminSession,
    refreshAdminSession,
    revokeAdminSession,
} from "../../src/services/session.service.js";


describe("Admin Session Service", () => {
    const adminId = "admin-123";
    const sessionId = "session-123";

    const oldRefreshToken = "old-refresh-token";
    const newRefreshToken = "new-refresh-token";

    const oldTokenHash = "hashed-old-token";
    const newTokenHash = "hashed-new-token";

    const csrfToken = "new-csrf-token";
    const csrfTokenHash = "hashed-csrf-token";

    const now = new Date();

    const futureDate = new Date(
        now.getTime() + 7 * 24 * 60 * 60 * 1000
    );

    const admin = {
        id: adminId,
        name: "Test Admin",
        email: "admin@example.com",
        status: AdminStatus.ACTIVE,
        phoneVerifiedAt: now,
        deletedAt: null,
    };

    const activeSession = {
        id: sessionId,
        adminUserId: adminId,
        refreshTokenHash: oldTokenHash,
        csrfTokenHash: "old-csrf-hash",
        expiresAt: futureDate,
        revokedAt: null,
        adminUser: admin,
    };

    const activeTokenRecord = {
        id: "refresh-row-123",
        sessionId,
        tokenHash: oldTokenHash,
        createdAt: now,
        expiresAt: futureDate,
        usedAt: null,
        session: activeSession,
    };

    const tx = {
        adminSession: {
            create: mocks.sessionCreate,
            update: mocks.sessionUpdate,
            updateMany: mocks.sessionUpdateMany,
        },

        adminRefreshToken: {
            findUnique: mocks.refreshTokenFindUnique,
            updateMany: mocks.refreshTokenUpdateMany,
            create: mocks.refreshTokenCreate,
        },
    };

    beforeEach(() => {
        vi.resetAllMocks();

        mocks.hashRefreshToken.mockImplementation(
            (token: string) => `hashed-${token}`
        );

        mocks.generateRefreshToken
            .mockReturnValueOnce(newRefreshToken)
            .mockReturnValue("generated-refresh-token");

        mocks.createAccessToken.mockResolvedValue(
            "access-token-123"
        );

        mocks.createSessionCsrfToken.mockReturnValue({
            token: csrfToken,
            tokenHash: csrfTokenHash,
        });

        mocks.transaction.mockImplementation(
            async (callback) => callback(tx)
        );

        mocks.sessionCreate.mockResolvedValue({
            id: sessionId,
            adminUserId: adminId,
            refreshTokenHash: oldTokenHash,
            expiresAt: futureDate,
        });

        mocks.sessionUpdate.mockResolvedValue({
            id: sessionId,
            csrfTokenHash,
        });

        mocks.sessionUpdateMany.mockResolvedValue({
            count: 1,
        });

        mocks.refreshTokenFindUnique.mockResolvedValue(
            activeTokenRecord
        );

        mocks.refreshTokenUpdateMany.mockResolvedValue({
            count: 1,
        });

        mocks.refreshTokenCreate.mockResolvedValue({
            id: "new-refresh-row",
            sessionId,
            tokenHash: newTokenHash,
            expiresAt: futureDate,
            usedAt: null,
        });
    });

    // 1. Create a session and its initial refresh token.
    it("should create a session and store its initial refresh token atomically", async () => {
        mocks.generateRefreshToken
            .mockReset()
            .mockReturnValue(oldRefreshToken);

        mocks.hashRefreshToken
            .mockReset()
            .mockReturnValue(oldTokenHash);

        const result = await createAdminSession({
            adminId,
            ipAddress: "127.0.0.1",
            userAgent: "Vitest",
        });

        expect(mocks.transaction).toHaveBeenCalledTimes(1);

        expect(mocks.sessionCreate).toHaveBeenCalledWith({
            data: expect.objectContaining({
                adminUserId: adminId,
                refreshTokenHash: oldTokenHash,
                ipAddress: "127.0.0.1",
                userAgent: "Vitest",
                expiresAt: expect.any(Date),
            }),
        });

        expect(mocks.createSessionCsrfToken).toHaveBeenCalledWith(
            sessionId,
            futureDate
        );

        expect(mocks.sessionUpdate).toHaveBeenCalledWith({
            where: {
                id: sessionId,
            },
            data: {
                csrfTokenHash,
            },
        });

        expect(mocks.refreshTokenCreate).toHaveBeenCalledWith({
            data: expect.objectContaining({
                sessionId,
                tokenHash: oldTokenHash,
                expiresAt: expect.any(Date),
            }),
        });

        expect(mocks.createAccessToken).toHaveBeenCalledWith(
            adminId,
            sessionId
        );

        expect(result).toEqual({
            sessionId,
            accessToken: "access-token-123",
            refreshToken: oldRefreshToken,
            csrfToken,
            expiresAt: futureDate,
        });
    });
    // 2. Successfully rotate refresh and CSRF tokens.
    it("should rotate refresh and CSRF tokens successfully", async () => {
        mocks.hashRefreshToken
            .mockReturnValueOnce(oldTokenHash)
            .mockReturnValueOnce(newTokenHash);

        const result = await refreshAdminSession(
            oldRefreshToken
        );

        expect(
            mocks.refreshTokenFindUnique
        ).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    tokenHash: oldTokenHash,
                },
            })
        );

        expect(
            mocks.refreshTokenUpdateMany
        ).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    tokenHash: oldTokenHash,
                    usedAt: null,
                }),
                data: {
                    usedAt: expect.any(Date),
                },
            })
        );

        expect(
            mocks.sessionUpdateMany
        ).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    id: sessionId,
                    refreshTokenHash: oldTokenHash,
                    revokedAt: null,
                }),
                data: expect.objectContaining({
                    refreshTokenHash: newTokenHash,
                    csrfTokenHash,
                    expiresAt: expect.any(Date),
                }),
            })
        );

        expect(
            mocks.refreshTokenCreate
        ).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    sessionId,
                    tokenHash: newTokenHash,
                    expiresAt: expect.any(Date),
                }),
            })
        );

        expect(result).toEqual(
            expect.objectContaining({
                admin: {
                    id: adminId,
                    name: admin.name,
                    email: admin.email,
                },
                sessionId,
                accessToken: "access-token-123",
                refreshToken: newRefreshToken,
                csrfToken,
                expiresAt: expect.any(Date),
            })
        );
    });
    // 3. Reject an empty refresh token.
    it("should reject an empty refresh token", async () => {
        await expect(
            refreshAdminSession("")
        ).rejects.toThrow(
            "Invalid or expired refresh token."
        );

        expect(
            mocks.refreshTokenFindUnique
        ).not.toHaveBeenCalled();

        expect(mocks.transaction).not.toHaveBeenCalled();
    });
    // 4. Reject an unknown refresh token.
    it("should reject an unknown refresh token", async () => {
        mocks.refreshTokenFindUnique.mockResolvedValue(null);

        await expect(
            refreshAdminSession("unknown-token")
        ).rejects.toThrow(
            "Invalid or expired refresh token."
        );

        expect(
            mocks.transaction
        ).not.toHaveBeenCalled();

        expect(
            mocks.sessionUpdateMany
        ).not.toHaveBeenCalled();
    });
    // 5. Detect reuse of an already consumed refresh token.
    it("should revoke the session when a used refresh token is reused", async () => {
        mocks.refreshTokenFindUnique.mockResolvedValue({
            ...activeTokenRecord,
            usedAt: new Date(
                now.getTime() - 1000
            ),
        });

        await expect(
            refreshAdminSession(oldRefreshToken)
        ).rejects.toThrow(
            "Invalid or expired refresh token."
        );

        expect(
            mocks.sessionUpdateMany
        ).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    id: sessionId,
                    revokedAt: null,
                },
                data: {
                    revokedAt: expect.any(Date),
                },
            })
        );

        expect(
            mocks.transaction
        ).not.toHaveBeenCalled();
    });

    it("should revoke the session when a previously rotated refresh token is reused", async () => {
        mocks.hashRefreshToken
            .mockReturnValueOnce(oldTokenHash)
            .mockReturnValueOnce(newTokenHash)
            .mockReturnValueOnce(oldTokenHash);

        mocks.refreshTokenFindUnique
            .mockResolvedValueOnce(activeTokenRecord)
            .mockResolvedValueOnce({
                ...activeTokenRecord,
                usedAt: new Date(),
            });

        // First request: successful rotation
        const firstResult = await refreshAdminSession(
            oldRefreshToken
        );

        expect(firstResult.refreshToken).toBe(newRefreshToken);

        // Second request: reuse the old refresh token
        await expect(
            refreshAdminSession(oldRefreshToken)
        ).rejects.toThrow(
            "Invalid or expired refresh token."
        );

        // The session must be revoked
        expect(
            mocks.sessionUpdateMany
        ).toHaveBeenLastCalledWith(
            expect.objectContaining({
                where: {
                    id: sessionId,
                    revokedAt: null,
                },
                data: {
                    revokedAt: expect.any(Date),
                },
            })
        );

        // No new access token should be created for the reused token
        expect(
            mocks.createAccessToken
        ).toHaveBeenCalledTimes(1);
    });
    // 6. Reject expired, revoked or invalid admin sessions.
    it.each([
        {
            name: "expired session",
            changes: {
                expiresAt: new Date(
                    now.getTime() - 1000
                ),
            },
        },
        {
            name: "revoked session",
            changes: {
                revokedAt: new Date(),
            },
        },
        {
            name: "inactive admin",
            changes: {
                adminUser: {
                    ...admin,
                    status: "INACTIVE",
                },
            },
        },
        {
            name: "unverified admin phone",
            changes: {
                adminUser: {
                    ...admin,
                    phoneVerifiedAt: null,
                },
            },
        },
        {
            name: "deleted admin",
            changes: {
                adminUser: {
                    ...admin,
                    deletedAt: new Date(),
                },
            },
        },
    ])(
        "should reject a refresh request for $name",
        async ({ changes }) => {
            mocks.refreshTokenFindUnique.mockResolvedValue({
                ...activeTokenRecord,
                session: {
                    ...activeSession,
                    ...changes,
                },
            });

            await expect(
                refreshAdminSession(oldRefreshToken)
            ).rejects.toThrow(
                "Invalid or expired refresh token."
            );

            expect(
                mocks.transaction
            ).not.toHaveBeenCalled();
        }
    );
    // 7. Handle concurrent refresh requests safely.
    it("should reject a refresh request when another request has already consumed the token", async () => {
        mocks.hashRefreshToken
            .mockReturnValueOnce(oldTokenHash)
            .mockReturnValueOnce(newTokenHash);

        mocks.refreshTokenUpdateMany.mockResolvedValue({
            count: 0,
        });

        mocks.refreshTokenFindUnique
            .mockResolvedValueOnce(activeTokenRecord)
            .mockResolvedValueOnce({
                ...activeTokenRecord,
                usedAt: new Date(),
            });

        await expect(
            refreshAdminSession(oldRefreshToken)
        ).rejects.toThrow(
            "Invalid or expired refresh token."
        );

        expect(
            mocks.refreshTokenUpdateMany
        ).toHaveBeenCalled();

        expect(
            mocks.sessionUpdateMany
        ).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    id: sessionId,
                    revokedAt: null,
                },
                data: {
                    revokedAt: expect.any(Date),
                },
            })
        );
    });
});