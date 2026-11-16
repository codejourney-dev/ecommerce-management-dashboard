import "dotenv/config";

const accessTokenSecret = process.env.JWT_ACCESS_SECRET;
const csrfSecret = process.env.CSRF_SECRET;

if (!accessTokenSecret || Buffer.byteLength(accessTokenSecret, "utf8") < 32) {
    throw new Error(
        "JWT_ACCESS_SECRET must contain at least 32 bytes."
    );
}

if (!csrfSecret || Buffer.byteLength(csrfSecret, "utf8") < 32) {
    throw new Error(
        "CSRF_SECRET must contain at least 32 bytes."
    );
}

export const authConfig = {
    accessToken: {
        secret: new TextEncoder().encode(accessTokenSecret),
        expiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? "15m",
    },
    csrf: {
        secret: new TextEncoder().encode(csrfSecret),
    },
};