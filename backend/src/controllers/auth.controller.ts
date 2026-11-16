import type { Request, Response } from "express";
import {
    adminLogin,
    verifyAdminOtp,
} from "../services/auth.service.js";
import {
    refreshAdminSession,
    revokeAdminSession,
    getActiveAdminSessions,
    revokeAdminSessionById,
    revokeAllAdminSessions,
} from "../services/session.service.js";

function clearAdminSessionCookies(res: Response): void {
    res.clearCookie("admin_refresh_token", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/api/auth/admin",
    });

    res.clearCookie("csrf_token", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
    });
}

export async function adminLoginController(
    req: Request,
    res: Response
) {
    try {
        const { email, password } = req.body;

        if (
            typeof email !== "string" ||
            typeof password !== "string" ||
            !email.trim() ||
            !password
        ) {
            return res.status(400).json({
                status: "error",
                message: "Email and password are required.",
            });
        }

        const result = await adminLogin({
            email,
            password,
        });

        return res.status(200).json({
            status: "success",
            message: "OTP sent successfully.",
            data: result,
        });
    } catch (error) {
        if (
            error instanceof Error &&
            error.message === "Invalid email or password."
        ) {
            return res.status(401).json({
                status: "error",
                message: "Invalid email or password.",
            });
        }

        console.error("Admin login error:", error);

        return res.status(500).json({
            status: "error",
            message: "Unable to process login request.",
        });
    }
}

export async function verifyAdminOtpController(
    req: Request,
    res: Response
) {
    try {
        const { challengeId, otp } = req.body;

        if (
            typeof challengeId !== "string" ||
            typeof otp !== "string" ||
            !challengeId.trim() ||
            !/^\d{6}$/.test(otp)
        ) {
            return res.status(400).json({
                status: "error",
                message: "A valid challenge ID and six-digit OTP are required.",
            });
        }

        const result = await verifyAdminOtp({
            challengeId,
            otp,
            ipAddress: req.ip,
            userAgent: req.get("user-agent") ?? undefined,
        });

        // Set refresh token cookie
        res.cookie(
            "admin_refresh_token",
            result.session.refreshToken,
            {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "lax",
                path: "/api/auth/admin",
                maxAge: 7 * 24 * 60 * 60 * 1000,
            }
        );

        // Set session CSRF cookie
        res.cookie("csrf_token", result.session.csrfToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            path: "/",
            expires: result.session.expiresAt,
        });

        return res.status(200).json({
            status: "success",
            message: "Login successful.",
            data: {
                admin: result.admin,
                accessToken: result.session.accessToken,
                csrfToken: result.session.csrfToken,
            },
        });

    } catch (error) {
        if (
            error instanceof Error &&
            error.message === "Invalid or expired verification code."
        ) {
            return res.status(401).json({
                status: "error",
                message: "Invalid or expired verification code.",
            });
        }

        console.error("OTP verification error:", error);

        return res.status(500).json({
            status: "error",
            message: "Unable to verify the code.",
        });
    }
}

export async function refreshAdminSessionController(
    req: Request,
    res: Response
) {
    try {
        const refreshToken = req.cookies?.admin_refresh_token;

        if (
            typeof refreshToken !== "string" ||
            !refreshToken
        ) {
            return res.status(401).json({
                status: "error",
                message: "Refresh token is required.",
            });
        }

        const result = await refreshAdminSession(refreshToken);

        res.cookie(
            "admin_refresh_token",
            result.refreshToken,
            {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "lax",
                path: "/api/auth/admin",
                expires: result.expiresAt,
            }
        );

        res.cookie("csrf_token", result.csrfToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            path: "/",
            expires: result.expiresAt,
        });

        return res.status(200).json({
            status: "success",
            message: "Token refreshed successfully.",
            data: {
                admin: result.admin,
                accessToken: result.accessToken,
                csrfToken: result.csrfToken,
            },
        });
    } catch (error) {
        if (
            error instanceof Error &&
            error.message === "Invalid or expired refresh token."
        ) {
            return res.status(401).json({
                status: "error",
                message: "Invalid or expired refresh token.",
            });
        }

        console.error("Token refresh error:", error);

        return res.status(500).json({
            status: "error",
            message: "Unable to refresh token.",
        });
    }
}

export async function logoutAdminController(
    req: Request,
    res: Response
) {
    try {
        const refreshToken = req.cookies?.admin_refresh_token;

        if (typeof refreshToken === "string" && refreshToken) {
            await revokeAdminSession(refreshToken);
        }

        res.clearCookie("admin_refresh_token", {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            path: "/api/auth/admin",
        });
        res.clearCookie("csrf_token", {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            path: "/",
        });

        return res.status(200).json({
            status: "success",
            message: "Logout successful.",
        });
    } catch (error) {
        console.error("Admin logout error:", error);

        return res.status(500).json({
            status: "error",
            message: "Unable to process logout request.",
        });
    }
}

export async function getAdminSessionsController(
    req: Request,
    res: Response
) {
    try {
        const auth = req.adminAuth;

        if (!auth) {
            return res.status(401).json({
                status: "error",
                message: "Authentication required.",
            });
        }

        const sessions = await getActiveAdminSessions({
            adminId: auth.adminUserId,
            currentSessionId: auth.sessionId,
        });

        return res.status(200).json({
            status: "success",
            data: {
                sessions,
            },
        });
    } catch (error) {
        console.error("Get admin sessions error:", error);

        return res.status(500).json({
            status: "error",
            message: "Unable to retrieve active sessions.",
        });
    }
}

export async function revokeAdminSessionController(
    req: Request,
    res: Response
) {
    try {
        const auth = req.adminAuth;

        if (!auth) {
            return res.status(401).json({
                status: "error",
                message: "Authentication required.",
            });
        }

        const sessionId = req.params.sessionId;

        if (typeof sessionId !== "string" || !sessionId.trim()) {
            res.status(400).json({
                status: "error",
                message: "Valid session ID is required.",
            });
            return;
        }

        const revoked = await revokeAdminSessionById({
            adminId: auth.adminUserId,
            sessionId,
        });

        if (!revoked) {
            return res.status(404).json({
                status: "error",
                message: "Active session not found.",
            });
        }

        // If the current session was revoked,
        // clear its authentication cookies.
        if (sessionId === auth.sessionId) {
            clearAdminSessionCookies(res);
        }

        return res.status(200).json({
            status: "success",
            message: "Session revoked successfully.",
        });
    } catch (error) {
        console.error("Revoke admin session error:", error);

        return res.status(500).json({
            status: "error",
            message: "Unable to revoke session.",
        });
    }
}

export async function revokeAllAdminSessionsController(
    req: Request,
    res: Response
) {
    try {
        const auth = req.adminAuth;

        if (!auth) {
            return res.status(401).json({
                status: "error",
                message: "Authentication required.",
            });
        }

        const revokedCount = await revokeAllAdminSessions({
            adminId: auth.adminUserId,
        });

        // The current session is also revoked.
        clearAdminSessionCookies(res);

        return res.status(200).json({
            status: "success",
            message: "All sessions revoked successfully.",
            data: {
                revokedCount,
            },
        });
    } catch (error) {
        console.error("Revoke all admin sessions error:", error);

        return res.status(500).json({
            status: "error",
            message: "Unable to revoke all sessions.",
        });
    }
}