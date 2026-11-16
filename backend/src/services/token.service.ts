
import { SignJWT, jwtVerify } from "jose";
import { createHash, randomBytes } from "node:crypto";
import { authConfig } from "../config/auth.config.js";

export async function createAccessToken(
  adminId: string,
  sessionId: string
): Promise<string> {
  return new SignJWT({
    role: "admin",
    sessionId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(adminId)
    .setIssuedAt()
    .setExpirationTime(authConfig.accessToken.expiresIn)
    .sign(authConfig.accessToken.secret);
}

export async function verifyAccessToken(
  token: string
): Promise<{ adminId: string; sessionId: string } | null> {
  try {
    const { payload } = await jwtVerify(
      token,
      authConfig.accessToken.secret,
      {
        algorithms: ["HS256"],
      }
    );

    if (
      typeof payload.sub !== "string" ||
      typeof payload.sessionId !== "string"
    ) {
      return null;
    }

    return {
      adminId: payload.sub,
      sessionId: payload.sessionId,
    };
  } catch {
    return null;
  }
}

// Generates 32 cryptographically random bytes.
export function generateRefreshToken(): string {
  return randomBytes(32).toString("hex");
}

// Hashes the raw refresh token using SHA-256.
export function hashRefreshToken(token: string): string {
  return createHash("sha256")
    .update(token)
    .digest("hex");
}
