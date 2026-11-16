import { prisma } from "../config/prisma.js";
import { verifyPassword } from "./password.service.js";
import {
    createOtpChallenge,
    verifyOtpChallenge
} from "./otp.service.js";
import { sendOtpSms } from "./sms/sms.service.js";
import { OtpPurpose, AdminStatus } from "../../generated/prisma/client.js";
import { createAdminSession } from "./session.service.js";

interface AdminLoginInput {
    email: string;
    password: string;
}

export async function adminLogin(input: AdminLoginInput) {
    const { email, password } = input;

    const admin = await prisma.adminUser.findUnique({
        where: {
            email: email.trim().toLowerCase(),
        },
    });

    // Use the same error for invalid credentials and unavailable accounts.
    if (
        !admin ||
        admin.deletedAt !== null ||
        admin.status !== AdminStatus.ACTIVE ||
        admin.phoneVerifiedAt === null
    ) {
        throw new Error("Invalid email or password.");
    }

    const isPasswordValid = await verifyPassword(
        password,
        admin.passwordHash
    );

    if (!isPasswordValid) {
        throw new Error("Invalid email or password.");
    }

    const challenge = await createOtpChallenge(
        admin.id,
        OtpPurpose.LOGIN
    );

    try {
        await sendOtpSms({
            phone: admin.phone,
            code: challenge.otp,
            purpose: OtpPurpose.LOGIN,
        });
    } catch (error) {
        // Invalidate the challenge if sending the SMS fails.
        await prisma.adminOtpChallenge.updateMany({
            where: {
                id: challenge.id,
                consumedAt: null,
            },
            data: {
                consumedAt: new Date(),
            },
        });

        throw new Error("Unable to send verification code.");
    }

    return {
        challengeId: challenge.id,
        expiresAt: challenge.expiresAt,
    };
}

interface VerifyAdminOtpInput {
    challengeId: string;
    otp: string;
    ipAddress?: string;
    userAgent?: string;
}

export async function verifyAdminOtp(
    input: VerifyAdminOtpInput
) {
    const {
        challengeId,
        otp,
        ipAddress,
        userAgent,
    } = input;

    const challenge = await prisma.adminOtpChallenge.findUnique({
        where: {
            id: challengeId,
        },
        select: {
            adminUserId: true,
            purpose: true,
        },
    });

    if (
        !challenge ||
        challenge.purpose !== OtpPurpose.LOGIN
    ) {
        throw new Error("Invalid or expired verification code.");
    }

    const admin = await prisma.adminUser.findFirst({
        where: {
            id: challenge.adminUserId,
            status: AdminStatus.ACTIVE,
            phoneVerifiedAt: {
                not: null,
            },
            deletedAt: null,
        },
        select: {
            id: true,
            name: true,
            email: true,
        },
    });

    if (!admin) {
        throw new Error("Invalid or expired verification code.");
    }

    const isOtpValid = await verifyOtpChallenge(
        challengeId,
        admin.id,
        otp,
        OtpPurpose.LOGIN
    );

    if (!isOtpValid) {
        throw new Error("Invalid or expired verification code.");
    }

    const session = await createAdminSession({
        adminId: admin.id,
        ipAddress,
        userAgent,
    });

    return {
        admin: {
            id: admin.id,
            name: admin.name,
            email: admin.email,
        },
        session,
    };
}