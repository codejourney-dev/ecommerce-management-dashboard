
import type { RequestHandler } from "express";
import {
    generatePreAuthCsrfToken,
    verifyPreAuthCsrfToken,
    verifySessionCsrfToken,
} from "../services/csrf.service.js";

const CSRF_COOKIE_NAME = "csrf_token";

const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
};

function isAllowedOrigin(origin: unknown): boolean {
    const allowedOrigins = (process.env.FRONTEND_ORIGINS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);

    return (
        typeof origin === "string" &&
        allowedOrigins.includes(origin)
    );
}

function rejectCsrf(res: Parameters<RequestHandler>[1], message: string) {
    res.status(403).json({
        status: "error",
        message,
    });
}

function getTokens(req: Parameters<RequestHandler>[0]) {
    return {
        cookieToken: req.cookies?.[CSRF_COOKIE_NAME],
        headerToken: req.headers["x-csrf-token"],
    };
}

function hasMatchingTokens(
    cookieToken: unknown,
    headerToken: unknown,
): cookieToken is string {
    return (
        typeof cookieToken === "string" &&
        typeof headerToken === "string" &&
        cookieToken.length > 0 &&
        cookieToken === headerToken
    );
}

// Issue a pre-authentication CSRF token
export const issuePreAuthCsrfToken: RequestHandler = (_req, res, next) => {
    try {
        const { token } = generatePreAuthCsrfToken();

        res.cookie(CSRF_COOKIE_NAME, token, cookieOptions);

        res.status(200).json({
            status: "success",
            data: { csrfToken: token },
        });
    } catch (error) {
        next(error);
    }
};

// Verify CSRF token before authentication
export const verifyPreAuthCsrf: RequestHandler = (req, res, next) => {
    const { cookieToken, headerToken } = getTokens(req);

    if (!isAllowedOrigin(req.headers.origin)) {
        rejectCsrf(res, "Request origin is not allowed.");
        return;
    }

    if (!hasMatchingTokens(cookieToken, headerToken)) {
        rejectCsrf(res, "CSRF token is required or invalid.");
        return;
    }

    if (!verifyPreAuthCsrfToken(cookieToken)) {
        rejectCsrf(res, "Invalid or expired CSRF token.");
        return;
    }

    next();
};

// Verify CSRF token bound to an authenticated session
export const verifySessionCsrf: RequestHandler = async (req, res, next) => {
    try {
        const { cookieToken, headerToken } = getTokens(req);

        if (!isAllowedOrigin(req.headers.origin)) {
            rejectCsrf(res, "Request origin is not allowed.");
            return;
        }

        if (!hasMatchingTokens(cookieToken, headerToken)) {
            rejectCsrf(res, "CSRF token is required or invalid.");
            return;
        }

        const isValid = await verifySessionCsrfToken(cookieToken);

        if (!isValid) {
            rejectCsrf(res, "Invalid or expired CSRF token.");
            return;
        }

        next();
    } catch (error) {
        next(error);
    }
};
