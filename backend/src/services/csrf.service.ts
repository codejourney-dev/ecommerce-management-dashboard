
import {
    createHmac,
    createHash,
    randomBytes,
    timingSafeEqual,
} from "node:crypto";

import { authConfig } from "../config/auth.config.js";
import { prisma } from "../config/prisma.js";

const CSRF_TOKEN_BYTES = 32;
const PRE_AUTH_CSRF_TTL_MS = 10 * 60 * 1000;

// Token payload types
interface PreAuthPayload {
    version: 1;
    type: "pre-auth";
    nonce: string;
    expiresAt: number;
}

interface SessionPayload {
    version: 1;
    type: "session";
    sessionId: string;
    nonce: string;
    expiresAt: number;
}

type CsrfPayload = PreAuthPayload | SessionPayload;
// Sign token payload using HMAC-SHA256
function signPayload(payload: string): string {
    return createHmac("sha256", authConfig.csrf.secret)
        .update(payload)
        .digest("hex");
}
// Create a signed token
function createSignedToken(payload: CsrfPayload): string {
    const encodedPayload = Buffer
        .from(JSON.stringify(payload))
        .toString("base64url");

    const signature = signPayload(encodedPayload);

    return `${encodedPayload}.${signature}`;
}
// Verify token signature and decode payload
function decodeToken(
    token: string
): CsrfPayload | null {
    try {
        const parts = token.split(".");

        if (parts.length !== 2) {
            return null;
        }

        const [encodedPayload, signature] = parts;

        if (
            !encodedPayload ||
            !signature ||
            !/^[a-f0-9]{64}$/.test(signature)
        ) {
            return null;
        }

        const expectedSignature = signPayload(encodedPayload);

        const expectedBuffer = Buffer.from(
            expectedSignature,
            "hex"
        );

        const providedBuffer = Buffer.from(
            signature,
            "hex"
        );

        if (
            !timingSafeEqual(
                expectedBuffer,
                providedBuffer
            )
        ) {
            return null;
        }

        const payload = JSON.parse(
            Buffer.from(
                encodedPayload,
                "base64url"
            ).toString("utf8")
        );

        if (
            !payload ||
            payload.version !== 1 ||
            typeof payload.expiresAt !== "number" ||
            !Number.isSafeInteger(payload.expiresAt) ||
            payload.expiresAt <= Date.now() ||
            typeof payload.nonce !== "string" ||
            !/^[a-f0-9]{64}$/.test(payload.nonce)
        ) {
            return null;
        }

        if (payload.type === "pre-auth") {
            return payload as PreAuthPayload;
        }

        if (
            payload.type === "session" &&
            typeof payload.sessionId === "string" &&
            payload.sessionId.length > 0
        ) {
            return payload as SessionPayload;
        }

        return null;
    } catch {
        return null;
    }
}
// Hash the complete CSRF token before database storage
export function hashCsrfToken(token: string): string {
    return createHash("sha256")
        .update(token)
        .digest("hex");
}
// Generate a pre-authentication CSRF token
export function generatePreAuthCsrfToken() {
    const now = Date.now();

    const expiresAt =
        now + PRE_AUTH_CSRF_TTL_MS;

    const payload: PreAuthPayload = {
        version: 1,
        type: "pre-auth",
        nonce: randomBytes(CSRF_TOKEN_BYTES).toString("hex"),
        expiresAt,
    };

    return {
        token: createSignedToken(payload),
        expiresAt: new Date(expiresAt),
    };
}

export function createSessionCsrfToken(
    sessionId: string,
    sessionExpiresAt: Date
) {
    const now = new Date();
    const expiresAt = sessionExpiresAt.getTime();

    if (
        !sessionId ||
        Number.isNaN(expiresAt) ||
        expiresAt <= now.getTime()
    ) {
        throw new Error("Invalid or expired session.");
    }

    const payload: SessionPayload = {
        version: 1,
        type: "session",
        sessionId,
        nonce: randomBytes(CSRF_TOKEN_BYTES).toString("hex"),
        expiresAt,
    };

    const token = createSignedToken(payload);

    return {
        token,
        tokenHash: hashCsrfToken(token),
        expiresAt: sessionExpiresAt,
    };
}
// Generate and store a session-bound CSRF token
export async function generateSessionCsrfToken(
    sessionId: string,
    sessionExpiresAt: Date
) {
    const csrf = createSessionCsrfToken(
        sessionId,
        sessionExpiresAt
    );

    const updated = await prisma.adminSession.updateMany({
        where: {
            id: sessionId,
            revokedAt: null,
            expiresAt: { gt: new Date() },
        },
        data: {
            csrfTokenHash: csrf.tokenHash,
        },
    });

    if (updated.count !== 1) {
        throw new Error("Invalid or expired session.");
    }

    return {
        token: csrf.token,
        expiresAt: csrf.expiresAt,
    };
}
// Verify a pre-authentication CSRF token
export function verifyPreAuthCsrfToken(
    token: string
): boolean {
    const payload = decodeToken(token);

    return payload?.type === "pre-auth";
}
// Verify a session-bound CSRF token
export async function verifySessionCsrfToken(
    token: string
): Promise<boolean> {
    const payload = decodeToken(token);

    if (!payload || payload.type !== "session") {
        return false;
    }

    const session = await prisma.adminSession.findUnique({
        where: {
            id: payload.sessionId,
        },
        select: {
            csrfTokenHash: true,
            expiresAt: true,
            revokedAt: true,
        },
    });

    if (
        !session ||
        session.revokedAt !== null ||
        session.expiresAt <= new Date() ||
        session.expiresAt.getTime() < payload.expiresAt ||
        !session.csrfTokenHash
    ) {
        return false;
    }

    const expectedHash = hashCsrfToken(token);

    const expectedBuffer = Buffer.from(
        expectedHash,
        "hex"
    );

    const storedBuffer = Buffer.from(
        session.csrfTokenHash,
        "hex"
    );

    if (
        storedBuffer.length !== expectedBuffer.length
    ) {
        return false;
    }

    return timingSafeEqual(
        expectedBuffer,
        storedBuffer
    );
}
