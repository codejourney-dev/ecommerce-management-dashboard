
import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
    prismaMock: {
        adminSession: {
            updateMany: vi.fn(),
            findUnique: vi.fn(),
        },
    },
}));

vi.mock("../../src/config/prisma.js", () => ({
    prisma: prismaMock,
}));

import {
    generatePreAuthCsrfToken,
    generateSessionCsrfToken,
    verifyPreAuthCsrfToken,
    verifySessionCsrfToken,
} from "../../src/services/csrf.service.js";

describe("CSRF Service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("Pre-authentication", () => {
        it("should generate a valid pre-auth CSRF token", () => {
            const { token, expiresAt } = generatePreAuthCsrfToken();

            expect(token).toBeTypeOf("string");
            expect(expiresAt).toBeInstanceOf(Date);
            expect(verifyPreAuthCsrfToken(token)).toBe(true);
        });

        it("should reject a tampered token", () => {
            const { token } = generatePreAuthCsrfToken();
            const parts = token.split(".");
            const signature = parts[1];

            expect(
                verifyPreAuthCsrfToken(
                    `${parts[0]}.${signature?.slice(0, -1)}a`
                )
            ).toBe(false);
        });

        it("should reject an invalid token", () => {
            expect(verifyPreAuthCsrfToken("invalid-token")).toBe(false);
            expect(verifyPreAuthCsrfToken("")).toBe(false);
        });
    });

    describe("Session CSRF", () => {
        const sessionId = "test-session-id";
        const sessionExpiresAt = new Date(
            Date.now() + 60 * 60 * 1000
        );

        it("should generate and store a session CSRF token", async () => {
            prismaMock.adminSession.updateMany.mockResolvedValue({
                count: 1,
            });

            const result = await generateSessionCsrfToken(
                sessionId,
                sessionExpiresAt
            );

            expect(result.token).toBeTypeOf("string");
            expect(result.expiresAt).toEqual(sessionExpiresAt);

            expect(
                prismaMock.adminSession.updateMany
            ).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        id: sessionId,
                        revokedAt: null,
                    }),
                    data: {
                        csrfTokenHash: expect.any(String),
                    },
                })
            );
        });

        it("should reject an invalid or expired session", async () => {
            prismaMock.adminSession.updateMany.mockResolvedValue({
                count: 0,
            });

            await expect(
                generateSessionCsrfToken(
                    sessionId,
                    sessionExpiresAt
                )
            ).rejects.toThrow("Invalid or expired session.");
        });

        it("should verify a valid session CSRF token", async () => {
            prismaMock.adminSession.updateMany.mockResolvedValue({
                count: 1,
            });

            const { token } = await generateSessionCsrfToken(
                sessionId,
                sessionExpiresAt
            );

            const crypto = await import(
                "../../src/services/csrf.service.js"
            );

            prismaMock.adminSession.findUnique.mockImplementation(
                async () => {
                    const { hashCsrfToken } = crypto;

                    return {
                        csrfTokenHash: hashCsrfToken(token),
                        expiresAt: sessionExpiresAt,
                        revokedAt: null,
                    };
                }
            );

            await expect(
                verifySessionCsrfToken(token)
            ).resolves.toBe(true);
        });

        it("should reject a revoked session", async () => {
            prismaMock.adminSession.findUnique.mockResolvedValue({
                csrfTokenHash: "a".repeat(64),
                expiresAt: sessionExpiresAt,
                revokedAt: new Date(),
            });

            await expect(
                verifySessionCsrfToken("invalid.token")
            ).resolves.toBe(false);
        });

        it("should reject a session with no stored CSRF hash", async () => {
            prismaMock.adminSession.updateMany.mockResolvedValue({
                count: 1,
            });

            const { token } = await generateSessionCsrfToken(
                sessionId,
                sessionExpiresAt
            );

            prismaMock.adminSession.findUnique.mockResolvedValue({
                csrfTokenHash: null,
                expiresAt: sessionExpiresAt,
                revokedAt: null,
            });

            await expect(
                verifySessionCsrfToken(token)
            ).resolves.toBe(false);
        });

        it("should invalidate the previous token after rotation", async () => {
            prismaMock.adminSession.updateMany.mockResolvedValue({
                count: 1,
            });

            const firstToken = await generateSessionCsrfToken(
                sessionId,
                sessionExpiresAt
            );

            const secondToken = await generateSessionCsrfToken(
                sessionId,
                sessionExpiresAt
            );

            // Simulate the latest hash stored in the database.
            const { hashCsrfToken } = await import(
                "../../src/services/csrf.service.js"
            );

            prismaMock.adminSession.findUnique.mockResolvedValue({
                csrfTokenHash: hashCsrfToken(secondToken.token),
                expiresAt: sessionExpiresAt,
                revokedAt: null,
            });

            await expect(
                verifySessionCsrfToken(firstToken.token)
            ).resolves.toBe(false);

            await expect(
                verifySessionCsrfToken(secondToken.token)
            ).resolves.toBe(true);
        });
    });
});