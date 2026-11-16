
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";

import {
    createOtpChallenge,
    generateOtp,
    hashOtp,
    verifyOtpHash,
    verifyOtpChallenge,
} from "../../src/services/otp.service.js";

import { OtpPurpose } from "../../generated/prisma/client.js";

const mocks = vi.hoisted(() => ({
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    create: vi.fn(),
    transactionUpdateMany: vi.fn(),
    transactionCreate: vi.fn(),
}));

vi.mock("../../src/config/prisma.js", () => ({
    prisma: {
        adminOtpChallenge: {
            findUnique: mocks.findUnique,
            updateMany: mocks.updateMany,
            create: mocks.create,
        },

        $transaction: vi.fn(async (callback) => {
            return callback({
                adminOtpChallenge: {
                    updateMany: mocks.transactionUpdateMany,
                    create: mocks.transactionCreate,
                },
            });
        }),
    },
}));

const ADMIN_ID = "admin-123";
const CHALLENGE_ID = "challenge-123";
const VALID_OTP = "123456";
const INVALID_OTP = "654321";
const PURPOSE = OtpPurpose.LOGIN;

const SECRET = "test-secret-that-is-at-least-32-bytes-long";

function createChallenge(overrides = {}) {
    return {
        id: CHALLENGE_ID,
        adminUserId: ADMIN_ID,
        codeHash: hashOtp(VALID_OTP),
        purpose: PURPOSE,
        expiresAt: new Date(Date.now() + 120_000),
        attempts: 0,
        maxAttempts: 5,
        consumedAt: null,
        ...overrides,
    };
}

describe("OTP Service", () => {
    beforeEach(() => {
        vi.clearAllMocks();

        process.env.OTP_HMAC_SECRET = SECRET;

        mocks.transactionUpdateMany.mockResolvedValue({
            count: 1,
        });

        mocks.transactionCreate.mockResolvedValue({
            id: CHALLENGE_ID,
            expiresAt: new Date(Date.now() + 120_000),
            maxAttempts: 5,
        });

        mocks.updateMany.mockResolvedValue({
            count: 1,
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // 1. Generate OTP
    describe("generateOtp", () => {
        it("should generate a six-digit OTP", () => {
            const otp = generateOtp();

            expect(otp).toMatch(/^\d{6}$/);
        });

        it("should generate OTPs within the valid range", () => {
            const otp = Number(generateOtp());

            expect(otp).toBeGreaterThanOrEqual(0);
            expect(otp).toBeLessThan(1_000_000);
        });
    });

    // 2. Hash OTP
    describe("hashOtp", () => {
        it("should generate a SHA-256 HMAC hash", () => {
            const hash = hashOtp(VALID_OTP);

            expect(hash).toMatch(/^[a-f0-9]{64}$/);
            expect(hash).not.toBe(VALID_OTP);
        });

        it("should reject an OTP that is not six digits", () => {
            expect(() => hashOtp("12345")).toThrow(
                "OTP must be exactly 6 digits."
            );

            expect(() => hashOtp("1234567")).toThrow(
                "OTP must be exactly 6 digits."
            );

            expect(() => hashOtp("abcdef")).toThrow(
                "OTP must be exactly 6 digits."
            );
        });

        it("should reject a missing or short HMAC secret", () => {
            delete process.env.OTP_HMAC_SECRET;

            expect(() => hashOtp(VALID_OTP)).toThrow(
                "OTP_HMAC_SECRET must contain at least 32 bytes."
            );

            process.env.OTP_HMAC_SECRET = "short-secret";

            expect(() => hashOtp(VALID_OTP)).toThrow(
                "OTP_HMAC_SECRET must contain at least 32 bytes."
            );
        });
    });

    // 3. Verify OTP hash
    describe("verifyOtpHash", () => {
        it("should accept a correct OTP", () => {
            const hash = hashOtp(VALID_OTP);

            expect(verifyOtpHash(VALID_OTP, hash)).toBe(true);
        });

        it("should reject an incorrect OTP", () => {
            const hash = hashOtp(VALID_OTP);

            expect(verifyOtpHash(INVALID_OTP, hash)).toBe(false);
        });

        it("should reject an invalid OTP format", () => {
            const hash = hashOtp(VALID_OTP);

            expect(verifyOtpHash("123", hash)).toBe(false);
            expect(verifyOtpHash("abcdef", hash)).toBe(false);
        });

        it("should reject an invalid stored hash", () => {
            expect(
                verifyOtpHash(VALID_OTP, "invalid-hash")
            ).toBe(false);
        });
    });

    // 4. Create OTP challenge
    describe("createOtpChallenge", () => {
        it("should create and store a new OTP challenge", async () => {
            const result = await createOtpChallenge(
                ADMIN_ID,
                PURPOSE
            );

            expect(result.id).toBe(CHALLENGE_ID);
            expect(result.otp).toMatch(/^\d{6}$/);
            expect(result.maxAttempts).toBe(5);

            expect(result.expiresAt.getTime()).toBeGreaterThan(
                Date.now()
            );

            expect(mocks.transactionUpdateMany).toHaveBeenCalledWith({
                where: {
                    adminUserId: ADMIN_ID,
                    purpose: PURPOSE,
                    consumedAt: null,
                },
                data: {
                    consumedAt: expect.any(Date),
                },
            });

            expect(mocks.transactionCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    adminUserId: ADMIN_ID,
                    purpose: PURPOSE,
                    codeHash: expect.stringMatching(/^[a-f0-9]{64}$/),
                    attempts: 0,
                    maxAttempts: 5,
                    expiresAt: expect.any(Date),
                }),
            });

            expect(mocks.transactionCreate).toHaveBeenCalledTimes(1);
            const storedData = mocks.transactionCreate.mock.calls[0]?.[0]?.data;
            expect(storedData).toBeDefined();
            expect(storedData.codeHash).not.toBe(result.otp);
        });

        it("should invalidate previous unused challenges", async () => {
            await createOtpChallenge(ADMIN_ID, PURPOSE);

            expect(mocks.transactionUpdateMany).toHaveBeenCalledTimes(1);

            expect(mocks.transactionUpdateMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        adminUserId: ADMIN_ID,
                        purpose: PURPOSE,
                        consumedAt: null,
                    }),
                    data: {
                        consumedAt: expect.any(Date),
                    },
                })
            );
        });
    });

    // 5. Verify OTP challenge
    describe("verifyOtpChallenge", () => {
        it("should accept a valid OTP and consume the challenge", async () => {
            mocks.findUnique.mockResolvedValue(createChallenge());

            const result = await verifyOtpChallenge(
                CHALLENGE_ID,
                ADMIN_ID,
                VALID_OTP,
                PURPOSE
            );

            expect(result).toBe(true);

            expect(mocks.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        id: CHALLENGE_ID,
                        adminUserId: ADMIN_ID,
                        purpose: PURPOSE,
                        consumedAt: null,
                        expiresAt: {
                            gt: expect.any(Date),
                        },
                        attempts: {
                            lt: 5,
                        },
                    }),
                    data: {
                        consumedAt: expect.any(Date),
                    },
                })
            );
        });

        it("should reject an incorrect OTP and increment attempts", async () => {
            mocks.findUnique.mockResolvedValue(createChallenge());

            const result = await verifyOtpChallenge(
                CHALLENGE_ID,
                ADMIN_ID,
                INVALID_OTP,
                PURPOSE
            );

            expect(result).toBe(false);

            expect(mocks.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        id: CHALLENGE_ID,
                        consumedAt: null,
                        attempts: {
                            lt: 5,
                        },
                    }),
                    data: {
                        attempts: {
                            increment: 1,
                        },
                    },
                })
            );
        });

        it("should reject a challenge that does not exist", async () => {
            mocks.findUnique.mockResolvedValue(null);

            const result = await verifyOtpChallenge(
                CHALLENGE_ID,
                ADMIN_ID,
                VALID_OTP,
                PURPOSE
            );

            expect(result).toBe(false);
            expect(mocks.updateMany).not.toHaveBeenCalled();
        });

        it("should reject a challenge belonging to another admin", async () => {
            mocks.findUnique.mockResolvedValue(
                createChallenge({
                    adminUserId: "another-admin",
                })
            );

            const result = await verifyOtpChallenge(
                CHALLENGE_ID,
                ADMIN_ID,
                VALID_OTP,
                PURPOSE
            );

            expect(result).toBe(false);
            expect(mocks.updateMany).not.toHaveBeenCalled();
        });

        it("should reject a challenge with a different purpose", async () => {
            mocks.findUnique.mockResolvedValue(
                createChallenge({
                    purpose: OtpPurpose.PASSWORD_RESET,
                })
            );

            const result = await verifyOtpChallenge(
                CHALLENGE_ID,
                ADMIN_ID,
                VALID_OTP,
                PURPOSE
            );

            expect(result).toBe(false);
            expect(mocks.updateMany).not.toHaveBeenCalled();
        });

        it("should reject an expired challenge", async () => {
            mocks.findUnique.mockResolvedValue(
                createChallenge({
                    expiresAt: new Date(Date.now() - 1_000),
                })
            );

            const result = await verifyOtpChallenge(
                CHALLENGE_ID,
                ADMIN_ID,
                VALID_OTP,
                PURPOSE
            );

            expect(result).toBe(false);
            expect(mocks.updateMany).not.toHaveBeenCalled();
        });

        it("should reject an already consumed challenge", async () => {
            mocks.findUnique.mockResolvedValue(
                createChallenge({
                    consumedAt: new Date(),
                })
            );

            const result = await verifyOtpChallenge(
                CHALLENGE_ID,
                ADMIN_ID,
                VALID_OTP,
                PURPOSE
            );

            expect(result).toBe(false);
            expect(mocks.updateMany).not.toHaveBeenCalled();
        });

        it("should reject a challenge after maximum attempts", async () => {
            mocks.findUnique.mockResolvedValue(
                createChallenge({
                    attempts: 5,
                    maxAttempts: 5,
                })
            );

            const result = await verifyOtpChallenge(
                CHALLENGE_ID,
                ADMIN_ID,
                VALID_OTP,
                PURPOSE
            );

            expect(result).toBe(false);
            expect(mocks.updateMany).not.toHaveBeenCalled();
        });

        it("should reject a challenge when consuming it fails", async () => {
            mocks.findUnique.mockResolvedValue(createChallenge());

            mocks.updateMany.mockResolvedValue({
                count: 0,
            });

            const result = await verifyOtpChallenge(
                CHALLENGE_ID,
                ADMIN_ID,
                VALID_OTP,
                PURPOSE
            );

            expect(result).toBe(false);
        });

        it("should reject a challenge when another request has consumed it", async () => {
            mocks.findUnique.mockResolvedValue(createChallenge());

            mocks.updateMany
                .mockResolvedValueOnce({ count: 1 })
                .mockResolvedValueOnce({ count: 0 });

            const results = await Promise.all([
                verifyOtpChallenge(
                    CHALLENGE_ID,
                    ADMIN_ID,
                    VALID_OTP,
                    PURPOSE
                ),
                verifyOtpChallenge(
                    CHALLENGE_ID,
                    ADMIN_ID,
                    VALID_OTP,
                    PURPOSE
                ),
            ]);

            expect(results.filter(Boolean)).toHaveLength(1);
            expect(results.filter((value) => !value)).toHaveLength(1);
        });
    });
});
