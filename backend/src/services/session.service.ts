import { prisma } from "../config/prisma.js";
import { AdminStatus } from "../../generated/prisma/client.js";
import {
    createAccessToken,
    generateRefreshToken,
    hashRefreshToken,
} from "./token.service.js";
import {
    createSessionCsrfToken,
} from "./csrf.service.js";

const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface CreateSessionInput {
    adminId: string;
    ipAddress?: string;
    userAgent?: string;
}
interface GetActiveSessionsInput {
    adminId: string;
    currentSessionId: string;
}
interface RevokeAdminSessionByIdInput {
    adminId: string;
    sessionId: string;
}
interface RevokeAllAdminSessionsInput {
    adminId: string;
}

export async function createAdminSession(
    input: CreateSessionInput
) {
    const refreshToken = generateRefreshToken();
    const refreshTokenHash = hashRefreshToken(refreshToken);

    const expiresAt = new Date(
        Date.now() + REFRESH_TOKEN_TTL_MS
    );

    // Create session, initial refresh token,
    // and initial CSRF token atomically.
    const session = await prisma.$transaction(async (tx) => {
        const newSession = await tx.adminSession.create({
            data: {
                adminUserId: input.adminId,
                refreshTokenHash,
                ipAddress: input.ipAddress,
                userAgent: input.userAgent,
                expiresAt,
            },
        });

        // Generate a CSRF token bound to this session.
        const csrf = createSessionCsrfToken(
            newSession.id,
            newSession.expiresAt
        );

        // Store the CSRF token hash.
        await tx.adminSession.update({
            where: {
                id: newSession.id,
            },
            data: {
                csrfTokenHash: csrf.tokenHash,
            },
        });

        // Register the initial refresh token.
        await tx.adminRefreshToken.create({
            data: {
                sessionId: newSession.id,
                tokenHash: refreshTokenHash,
                expiresAt,
            },
        });

        return {
            ...newSession,
            csrfToken: csrf.token,
        };
    });

    const accessToken = await createAccessToken(
        input.adminId,
        session.id
    );

    return {
        sessionId: session.id,
        accessToken,
        refreshToken,
        csrfToken: session.csrfToken,
        expiresAt: session.expiresAt,
    };
}

export async function refreshAdminSession(
    refreshToken: string
) {
    if (!refreshToken) {
        throw new Error("Invalid or expired refresh token.");
    }

    const oldTokenHash = hashRefreshToken(refreshToken);
    const now = new Date();

    // Find the token in the refresh-token history.
    const tokenRecord = await prisma.adminRefreshToken.findUnique({
        where: {
            tokenHash: oldTokenHash,
        },
        include: {
            session: {
                include: {
                    adminUser: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                            status: true,
                            phoneVerifiedAt: true,
                            deletedAt: true,
                        },
                    },
                },
            },
        },
    });

    if (!tokenRecord) {
        throw new Error("Invalid or expired refresh token.");
    }

    const session = tokenRecord.session;

    // Detect reuse of an already-consumed refresh token.
    if (tokenRecord.usedAt !== null) {
        await prisma.adminSession.updateMany({
            where: {
                id: session.id,
                revokedAt: null,
            },
            data: {
                revokedAt: now,
            },
        });

        throw new Error("Invalid or expired refresh token.");
    }

    // Validate token, session, and admin account.
    if (
        tokenRecord.expiresAt <= now ||
        session.revokedAt !== null ||
        session.expiresAt <= now ||
        session.refreshTokenHash !== oldTokenHash ||
        session.adminUser.status !== AdminStatus.ACTIVE ||
        session.adminUser.phoneVerifiedAt === null ||
        session.adminUser.deletedAt !== null
    ) {
        throw new Error("Invalid or expired refresh token.");
    }

    // Generate the replacement refresh token.
    const newRefreshToken = generateRefreshToken();
    const newRefreshTokenHash = hashRefreshToken(newRefreshToken);

    const newExpiresAt = new Date(
        now.getTime() + REFRESH_TOKEN_TTL_MS
    );

    // Generate a new session-bound CSRF token.
    const csrf = createSessionCsrfToken(
        session.id,
        newExpiresAt
    );

    // Consume the old token and register the new one atomically.
    let rotationSucceeded = false;

    try {
        rotationSucceeded = await prisma.$transaction(async (tx) => {

            // Step 1: Consume the old refresh token.
            const consumed = await tx.adminRefreshToken.updateMany({
                where: {
                    tokenHash: oldTokenHash,
                    sessionId: session.id,
                    usedAt: null,
                    expiresAt: {
                        gt: now,
                    },
                },
                data: {
                    usedAt: now,
                },
            });

            if (consumed.count !== 1) {
                return false;
            }

            // Step 2: Update the session with the new token.
            const updatedSession = await tx.adminSession.updateMany({
                where: {
                    id: session.id,
                    refreshTokenHash: oldTokenHash,
                    revokedAt: null,
                    expiresAt: {
                        gt: now,
                    },
                },
                data: {
                    refreshTokenHash: newRefreshTokenHash,
                    csrfTokenHash: csrf.tokenHash,
                    expiresAt: newExpiresAt,
                },
            });

            // Roll back the transaction if the session
            // could not be updated.
            if (updatedSession.count !== 1) {
                throw new Error("SESSION_ROTATION_CONFLICT");
            }

            // Step 3: Save the new refresh token in history.
            await tx.adminRefreshToken.create({
                data: {
                    sessionId: session.id,
                    tokenHash: newRefreshTokenHash,
                    expiresAt: newExpiresAt,
                },
            });

            return true;
        });

    } catch (error) {
        if (
            !(error instanceof Error) ||
            error.message !== "SESSION_ROTATION_CONFLICT"
        ) {
            throw error;
        }
    }

    // Handle a failed rotation and check for token reuse.
    if (!rotationSucceeded) {
        const latestToken = await prisma.adminRefreshToken.findUnique({
            where: {
                tokenHash: oldTokenHash,
            },
            select: {
                usedAt: true,
                sessionId: true,
            },
        });

        if (latestToken?.usedAt !== null && latestToken?.usedAt !== undefined) {
            await prisma.adminSession.updateMany({
                where: {
                    id: latestToken.sessionId,
                    revokedAt: null,
                },
                data: {
                    revokedAt: now,
                },
            });
        }

        throw new Error("Invalid or expired refresh token.");
    }

    // Create the access token only after successful rotation.
    const accessToken = await createAccessToken(
        session.adminUserId,
        session.id
    );

    return {
        admin: {
            id: session.adminUser.id,
            name: session.adminUser.name,
            email: session.adminUser.email,
        },
        sessionId: session.id,
        accessToken,
        refreshToken: newRefreshToken,
        csrfToken: csrf.token,
        expiresAt: newExpiresAt,
    };
}

export async function revokeAdminSession(
    refreshToken: string
): Promise<void> {
    if (!refreshToken) {
        return;
    }

    const refreshTokenHash = hashRefreshToken(refreshToken);

    await prisma.$transaction(async (tx) => {
        // Find the refresh token in its history.
        const tokenRecord = await tx.adminRefreshToken.findUnique({
            where: {
                tokenHash: refreshTokenHash,
            },
            select: {
                sessionId: true,
            },
        });

        // Unknown token: nothing to revoke.
        if (!tokenRecord) {
            return;
        }

        // Revoke the session regardless of whether
        // this refresh token has already been rotated.
        await tx.adminSession.updateMany({
            where: {
                id: tokenRecord.sessionId,
                revokedAt: null,
            },
            data: {
                revokedAt: new Date(),
            },
        });
    });
}

export async function getActiveAdminSessions(
    input: GetActiveSessionsInput
) {
    const now = new Date();

    const sessions = await prisma.adminSession.findMany({
        where: {
            adminUserId: input.adminId,
            revokedAt: null,
            expiresAt: {
                gt: now,
            },
        },
        select: {
            id: true,
            ipAddress: true,
            userAgent: true,
            createdAt: true,
            expiresAt: true,
        },
        orderBy: {
            createdAt: "desc",
        },
    });

    return sessions.map((session) => ({
        ...session,
        isCurrent: session.id === input.currentSessionId,
    }));
}

export async function revokeAdminSessionById(
    input: RevokeAdminSessionByIdInput
): Promise<boolean> {
    const now = new Date();

    const result = await prisma.adminSession.updateMany({
        where: {
            id: input.sessionId,
            adminUserId: input.adminId,
            revokedAt: null,
            expiresAt: {
                gt: now,
            },
        },
        data: {
            revokedAt: now,
        },
    });

    return result.count === 1;
}

export async function revokeAllAdminSessions(
    input: RevokeAllAdminSessionsInput
): Promise<number> {
    const now = new Date();

    const result = await prisma.adminSession.updateMany({
        where: {
            adminUserId: input.adminId,
            revokedAt: null,
        },
        data: {
            revokedAt: now,
        },
    });

    return result.count;
}