import { prisma } from "../config/prisma.js";
import { OtpPurpose } from "../../generated/prisma/client.js";
import {
    createHmac,
    randomInt,
    timingSafeEqual,
} from "node:crypto";

// Get OTP secret from environment variables
function getOtpSecret(): string {
    const secret = process.env.OTP_HMAC_SECRET;

    if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
        throw new Error(
            "OTP_HMAC_SECRET must contain at least 32 bytes."
        );
    }

    return secret;
}

// Generate a cryptographically secure 6-digit OTP
export function generateOtp(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

// Hash OTP using HMAC-SHA256
export function hashOtp(otp: string): string {
    if (!/^\d{6}$/.test(otp)) {
        throw new Error("OTP must be exactly 6 digits.");
    }
    return createHmac("sha256", getOtpSecret()).update(otp).digest("hex");
}

// Verify OTP against its stored hash
export function verifyOtpHash(
    otp: string,
    storedHash: string
): boolean {
    if (!/^\d{6}$/.test(otp)) {
        return false;
    }

    if (!/^[a-f0-9]{64}$/i.test(storedHash)) {
        return false;
    }

    const calculatedHash = Buffer.from(hashOtp(otp),"hex");

    const savedHash = Buffer.from(storedHash, "hex");

    return timingSafeEqual(calculatedHash, savedHash);
}
// OTP configuration
const OTP_TTL_MS = 2 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

// Create and store a new OTP challenge
export async function createOtpChallenge(
    adminUserId: string,
    purpose: OtpPurpose
) {
    // Generate a new OTP
    const otp = generateOtp();

    // Hash the OTP before storing it
    const codeHash = hashOtp(otp);

    // Calculate expiration time
    const now = new Date();
    const expiresAt = new Date(now.getTime() + OTP_TTL_MS);

    // Invalidate previous unused challenges and create a new one
    const challenge = await prisma.$transaction(async (tx) => {
        await tx.adminOtpChallenge.updateMany({
            where: {
                adminUserId,
                purpose,
                consumedAt: null,
            },
            data: {
                consumedAt: now,
            },
        });

        return tx.adminOtpChallenge.create({
            data: {
                adminUserId,
                codeHash,
                purpose,
                expiresAt,
                attempts: 0,
                maxAttempts: MAX_OTP_ATTEMPTS,
            },
        });
    });

    // Return the OTP for the SMS service
    return {
        id: challenge.id,
        otp,
        expiresAt: challenge.expiresAt,
        maxAttempts: challenge.maxAttempts,
    };
}

// Verify an OTP challenge
export async function verifyOtpChallenge(
    challengeId: string,
    adminUserId: string,
    otp: string,
    purpose: OtpPurpose
): Promise<boolean> {

    const now = new Date();
    // Find the OTP challenge
    const challenge = await prisma.adminOtpChallenge.findUnique({
        where: {
            id: challengeId,
        },
    });
    // Check whether the challenge exists
    if (!challenge) {
        return false;
    }
    if (challenge.adminUserId !== adminUserId) return false;
    // Check the OTP purpose
    if (challenge.purpose !== purpose) {
        return false;
    }
    // Check whether the challenge has already been consumed
    if (challenge.consumedAt !== null) {
        return false;
    }
    // Check expiration
    if (challenge.expiresAt <= now) {
        return false;
    }
    // Check maximum attempts
    if (challenge.attempts >= challenge.maxAttempts) {
        return false;
    }
    // Verify the submitted OTP
    const isValid = verifyOtpHash(otp, challenge.codeHash);
    // If OTP is incorrect, increment attempts
    if (!isValid) {
        await prisma.adminOtpChallenge.updateMany({
            where: {
                id: challengeId,
                adminUserId,
                purpose,
                consumedAt: null,
                expiresAt: {
                    gt: now,
                },
                attempts: {
                    lt: challenge.maxAttempts,
                },
            },
            data: {
                attempts: {
                    increment: 1,
                },
            },
        });
        return false;
    }
    // Consume the challenge if OTP is correct
    const result = await prisma.adminOtpChallenge.updateMany({
        where: {
            id: challengeId,
            adminUserId,
            purpose,
            consumedAt: null,
            expiresAt: {
                gt: now,
            },
            attempts: {
                lt: challenge.maxAttempts,
            },
        },
        data: {
            consumedAt: now,
        },
    });
    return result.count === 1;
}