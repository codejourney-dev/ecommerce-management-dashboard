
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

// 1. Protect the main database.
function assertTestDatabase() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const databaseName = new URL(databaseUrl).pathname;

  if (databaseName !== "/ecommerce_dashboard_migration_test") {
    throw new Error(
      "Refusing to run integration tests outside the test database."
    );
  }
}

assertTestDatabase();

// 2. Import database-dependent modules after the guard.
const { prisma } = await import("../../src/config/prisma.js");
const { AdminStatus } = await import(
  "../../generated/prisma/client.js"
);

const {
  createAdminSession,
  refreshAdminSession,
  revokeAdminSession,
  revokeAdminSessionById,
} = await import("../../src/services/session.service.js");

const { hashRefreshToken } = await import(
  "../../src/services/token.service.js"
);

const adminIds: string[] = [];

afterAll(async () => {
    try {
        if (adminIds.length > 0) {
            await prisma.adminUser.deleteMany({
                where: {
                    id: { in: adminIds },
                },
            });
        }
    } finally {
        await prisma.$disconnect();
    }
});

describe("Concurrent Refresh Integration", () => {
  it("should detect concurrent reuse and revoke the session", async () => {
    // 3. Create an isolated test admin.
    const admin = await prisma.adminUser.create({
      data: {
        name: "Concurrent Refresh Test",
        email: `refresh-${randomUUID()}@example.test`,
        phone: `+989${Date.now().toString().slice(-10)}`,
        passwordHash: "integration-test-only",
        status: AdminStatus.ACTIVE,
        phoneVerifiedAt: new Date(),
      },
    });

    adminIds.push(admin.id);

    // 4. Create a real session.
    const initialSession = await createAdminSession({
      adminId: admin.id,
      userAgent: "vitest-concurrent-refresh",
    });

    // 5. Send two simultaneous refresh requests.
    const results = await Promise.allSettled([
      refreshAdminSession(initialSession.refreshToken),
      refreshAdminSession(initialSession.refreshToken),
    ]);

    // 6. Exactly one request should succeed.
    const successful = results.filter(
      (result) => result.status === "fulfilled"
    );

    const failed = results.filter(
      (result) => result.status === "rejected"
    );

    expect(successful).toHaveLength(1);
    expect(failed).toHaveLength(1);

    // 7. Safely narrow the successful result.
    const successResult = successful[0];

    if (!successResult || successResult.status !== "fulfilled") {
      throw new Error("Expected one successful refresh.");
    }

    // 8. Read the actual PostgreSQL records.
    const finalSession = await prisma.adminSession.findUnique({
      where: { id: initialSession.sessionId },
      include: { refreshTokens: true },
    });

    const originalToken = await prisma.adminRefreshToken.findUnique({
      where: {
        tokenHash: hashRefreshToken(initialSession.refreshToken),
      },
    });

    // 9. Verify token rotation.
    expect(originalToken?.usedAt).not.toBeNull();

    expect(finalSession?.refreshTokens).toHaveLength(2);

    expect(finalSession?.refreshTokenHash).toBe(
      hashRefreshToken(successResult.value.refreshToken)
    );

    // 10. Verify reuse detection.
    expect(finalSession?.revokedAt).not.toBeNull();
  });

  it("should keep the session revoked when refresh and revoke run concurrently", async () => {
      // Arrange: create an isolated test admin.
      const admin = await prisma.adminUser.create({
          data: {
              name: "Concurrent Refresh Revoke Test",
              email: `refresh-revoke-${randomUUID()}@example.test`,
              phone: `+989${Date.now().toString().slice(-10)}`,
              passwordHash: "integration-test-only",
              status: AdminStatus.ACTIVE,
              phoneVerifiedAt: new Date(),
          },
      });

      adminIds.push(admin.id);

      // Create a real session.
      const initialSession = await createAdminSession({
          adminId: admin.id,
          userAgent: "vitest-concurrent-refresh-revoke",
      });

      // Act: refresh and revoke the same session simultaneously.
      const [refreshResult, revokeResult] = await Promise.allSettled([
          refreshAdminSession(initialSession.refreshToken),

          revokeAdminSessionById({
              adminId: admin.id,
              sessionId: initialSession.sessionId,
          }),
      ]);

      // Revoke must complete successfully.
      expect(revokeResult.status).toBe("fulfilled");

      if (revokeResult.status !== "fulfilled") {
          throw new Error("Expected session revocation to succeed.");
      }

      expect(revokeResult.value).toBe(true);

      // Read the final session state.
      const finalSession = await prisma.adminSession.findUnique({
          where: { id: initialSession.sessionId },
      });

      expect(finalSession).not.toBeNull();

      // The session must remain revoked regardless of the race outcome.
      expect(finalSession?.revokedAt).not.toBeNull();

      // A refresh token must not be usable after revocation.
      const tokenToCheck =
          refreshResult.status === "fulfilled"
              ? refreshResult.value.refreshToken
              : initialSession.refreshToken;

      await expect(
          refreshAdminSession(tokenToCheck)
      ).rejects.toThrow();
  });

  it("should revoke the session when logout uses the old refresh token after rotation", async () => {
      // Arrange
      const admin = await prisma.adminUser.create({
          data: {
              name: "Logout Refresh Race Test",
              email: `logout-refresh-${randomUUID()}@example.test`,
              phone: `+989${Date.now().toString().slice(-10)}`,
              passwordHash: "integration-test-only",
              status: AdminStatus.ACTIVE,
              phoneVerifiedAt: new Date(),
          },
      });

      adminIds.push(admin.id);

      const initialSession = await createAdminSession({
          adminId: admin.id,
          userAgent: "vitest-logout-refresh-race",
      });

      // Act 1: Refresh completes and rotates the token.
      const refreshed = await refreshAdminSession(
          initialSession.refreshToken
      );

      // Act 2: Logout arrives with the old refresh token.
      await revokeAdminSession(initialSession.refreshToken);

      // Assert: The session must be revoked.
      const finalSession = await prisma.adminSession.findUnique({
          where: { id: initialSession.sessionId },
      });

      expect(finalSession?.revokedAt).not.toBeNull();

      // The newly issued refresh token must also be unusable.
      await expect(
          refreshAdminSession(refreshed.refreshToken)
      ).rejects.toThrow();
  });

});
