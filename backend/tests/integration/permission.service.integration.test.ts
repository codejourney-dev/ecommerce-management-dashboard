
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

// Protect the test database before importing Prisma.
function assertTestDatabase(): void {
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

// Import database-dependent modules after the guard.
const { prisma } = await import("../../src/config/prisma.js");

const { AdminStatus } = await import(
    "../../generated/prisma/client.js"
);

const { hasPermission } = await import(
    "../../src/services/permission.service.js"
);

// Track created records for cleanup.
const adminIds: string[] = [];
const roleIds: string[] = [];
const permissionIds: string[] = [];

afterAll(async () => {
    try {
        if (roleIds.length > 0) {
            await prisma.rolePermission.deleteMany({
                where: {
                    roleId: { in: roleIds },
                },
            });
        }

        if (adminIds.length > 0) {
            await prisma.adminUser.deleteMany({
                where: {
                    id: { in: adminIds },
                },
            });
        }

        if (roleIds.length > 0) {
            await prisma.role.deleteMany({
                where: {
                    id: { in: roleIds },
                },
            });
        }

        if (permissionIds.length > 0) {
            await prisma.permission.deleteMany({
                where: {
                    id: { in: permissionIds },
                },
            });
        }
    } finally {
        await prisma.$disconnect();
    }
});

describe("Admin Permission Service", () => {
    it("should immediately reflect permission assignment and removal", async () => {
        // Arrange: create an active, verified admin.
        const uniqueId = randomUUID();

        const admin = await prisma.adminUser.create({
            data: {
                name: "Permission Integration Test",
                email: `permission-${uniqueId}@example.test`,
                phone: `+989${uniqueId.replaceAll("-", "").slice(0, 10)}`,
                passwordHash: "integration-test-only",
                status: AdminStatus.ACTIVE,
                phoneVerifiedAt: new Date(),
            },
        });

        adminIds.push(admin.id);

        // Create a role.
        const role = await prisma.role.create({
            data: {
                name: `test-role-${uniqueId}`,
                description: "Integration test role",
            },
        });

        roleIds.push(role.id);

        // Create a permission.
        const permission = await prisma.permission.create({
            data: {
                name: `test.permission.${uniqueId}`,
                description: "Integration test permission",
            },
        });

        permissionIds.push(permission.id);

        // Assign the role to the admin.
        await prisma.adminUserRole.create({
            data: {
                adminUserId: admin.id,
                roleId: role.id,
            },
        });

        // Initially, the role does not have this permission.
        expect(
            await hasPermission(admin.id, permission.name)
        ).toBe(false);

        // Act: grant the permission to the role.
        await prisma.rolePermission.create({
            data: {
                roleId: role.id,
                permissionId: permission.id,
            },
        });

        // Assert: permission must become effective immediately.
        expect(
            await hasPermission(admin.id, permission.name)
        ).toBe(true);

        // Act: remove the permission from the role.
        await prisma.rolePermission.delete({
            where: {
                roleId_permissionId: {
                    roleId: role.id,
                    permissionId: permission.id,
                },
            },
        });

        // Assert: permission must be denied immediately.
        expect(
            await hasPermission(admin.id, permission.name)
        ).toBe(false);
    });
});
