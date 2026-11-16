
import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("../../src/services/csrf.service.js", async (importOriginal) => {
    const actual =
        await importOriginal<
            typeof import("../../src/services/csrf.service.js")
        >();

    return {
        ...actual,
        verifySessionCsrfToken: vi.fn(),
    };
});

import app from "../../src/app.js";
import {
    verifySessionCsrfToken,
} from "../../src/services/csrf.service.js";

describe("CSRF Middleware Integration", () => {
    const allowedOrigin = "http://localhost:5173";

    beforeEach(() => {
        vi.clearAllMocks();
        process.env.FRONTEND_ORIGINS = allowedOrigin;
    });

    // Helper: get CSRF cookie from response
    function getCsrfCookie(response: request.Response): string {
        const cookies = response.headers["set-cookie"];

        if (!cookies || cookies.length === 0) {
            throw new Error("CSRF cookie was not set.");
        }

        const cookie = cookies[0]?.split(";")[0];

        if (!cookie) {
            throw new Error("Invalid CSRF cookie.");
        }

        return cookie;
    }

    // Helper: issue a pre-auth CSRF token
    async function getPreAuthToken() {
        const response = await request(app)
            .get("/api/auth/csrf")
            .set("Origin", allowedOrigin);

        return {
            token: response.body.data.csrfToken as string,
            cookie: getCsrfCookie(response),
        };
    }

    describe("Pre-authentication CSRF", () => {
        it("should issue a CSRF token", async () => {
            const response = await request(app)
                .get("/api/auth/csrf")
                .set("Origin", allowedOrigin);

            expect(response.status).toBe(200);
            expect(response.body.data.csrfToken).toBeDefined();
            expect(response.headers["set-cookie"]).toBeDefined();
        });

        it("should reject a request without CSRF token", async () => {
            const response = await request(app)
                .post("/api/auth/admin/login")
                .set("Origin", allowedOrigin)
                .send({});

            expect(response.status).toBe(403);
            expect(response.body.message).toBe(
                "CSRF token is required or invalid."
            );
        });

        it("should reject a request from an untrusted origin", async () => {
            const response = await request(app)
                .post("/api/auth/admin/login")
                .set("Origin", "https://malicious.example")
                .send({});

            expect(response.status).toBe(403);
            expect(response.body.message).toBe(
                "Request origin is not allowed."
            );
        });

        it("should reject requests without Origin", async () => {
            const response = await request(app)
                .post("/api/auth/admin/login")
                .send({
                    email: "admin@example.com",
                    password: "password",
                });

            expect(response.status).toBe(403);
            expect(response.body.message).toBe(
                "Request origin is not allowed."
            );
        });

        it("should reject mismatched cookie and header tokens", async () => {
            const { token, cookie } = await getPreAuthToken();

            const response = await request(app)
                .post("/api/auth/admin/login")
                .set("Origin", allowedOrigin)
                .set("Cookie", cookie)
                .set("X-CSRF-Token", `${token}tampered`)
                .send({});

            expect(response.status).toBe(403);
            expect(response.body.message).toBe(
                "CSRF token is required or invalid."
            );
        });

        it("should reject a tampered CSRF token", async () => {
            const { token } = await getPreAuthToken();

            const [payload, signature] = token.split(".");

            if (!payload || !signature) {
                throw new Error("Invalid CSRF token format.");
            }

            const tamperedSignature =
                signature.slice(0, -1) +
                (signature.endsWith("a") ? "b" : "a");

            const tamperedToken =
                `${payload}.${tamperedSignature}`;

            const response = await request(app)
                .post("/api/auth/admin/login")
                .set("Origin", allowedOrigin)
                .set("Cookie", `csrf_token=${tamperedToken}`)
                .set("X-CSRF-Token", tamperedToken)
                .send({});

            expect(response.status).toBe(403);
            expect(response.body.message).toBe(
                "Invalid or expired CSRF token."
            );
        });

        it("should allow a request with a valid CSRF token", async () => {
            const { token, cookie } = await getPreAuthToken();

            const response = await request(app)
                .post("/api/auth/admin/login")
                .set("Origin", allowedOrigin)
                .set("Cookie", cookie)
                .set("X-CSRF-Token", token)
                .send({});

            // CSRF middleware passes the request to the controller.
            expect(response.status).toBe(400);
            expect(response.body.message).toBe(
                "Email and password are required."
            );
        });
    });

    describe("Session CSRF", () => {
        const sessionToken = "mock-session-csrf-token";
        const sessionCookie = `csrf_token=${sessionToken}`;

        it("should allow a valid session CSRF token", async () => {
            vi.mocked(verifySessionCsrfToken)
                .mockResolvedValue(true);

            const response = await request(app)
                .post("/api/auth/admin/refresh")
                .set("Origin", allowedOrigin)
                .set("Cookie", sessionCookie)
                .set("X-CSRF-Token", sessionToken)
                .send({});

            expect(verifySessionCsrfToken)
                .toHaveBeenCalledWith(sessionToken);

            // The request must pass the CSRF middleware.
            expect(response.status).not.toBe(403);
        });

        it("should reject an invalid session CSRF token", async () => {
            vi.mocked(verifySessionCsrfToken)
                .mockResolvedValue(false);

            const response = await request(app)
                .post("/api/auth/admin/refresh")
                .set("Origin", allowedOrigin)
                .set("Cookie", sessionCookie)
                .set("X-CSRF-Token", sessionToken)
                .send({});

            expect(response.status).toBe(403);
            expect(response.body.message).toBe(
                "Invalid or expired CSRF token."
            );
        });
    });
});
