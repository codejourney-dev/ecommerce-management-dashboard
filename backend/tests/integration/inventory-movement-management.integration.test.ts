import { config } from "dotenv";
config({ path: ".env.test" });

import { randomUUID } from "node:crypto";
import {
    afterAll,
    afterEach,
    beforeAll,
    describe,
    expect,
    it,
} from "vitest";
import request from "supertest";

// -----------------------------------------------------------------------------
// Safety guard: this suite may only use the dedicated migration-test database.
// -----------------------------------------------------------------------------

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
}

const databaseName = new URL(databaseUrl).pathname.replace(/^\/+/, "");

if (databaseName !== "ecommerce_dashboard_migration_test") {
    throw new Error(
        `Unsafe integration-test database: "${databaseName}". ` +
        "Inventory movement tests may run only against ecommerce_dashboard_migration_test.",
    );
}

// Import database-dependent modules only after the safety guard.
const { prisma } = await import("../../src/config/prisma.js");
const { AdminStatus, MovementType } = await import(
    "../../generated/prisma/client.js"
);
const { createAccessToken, hashRefreshToken } = await import(
    "../../src/services/token.service.js"
);
const { createSessionCsrfToken } = await import(
    "../../src/services/csrf.service.js"
);
const { default: app } = await import("../../src/app.js");

type AuthContext = {
    adminId: string;
    accessToken: string;
    allowedOrigin: string;
};

const createdWarehouseIds: string[] = [];
const createdVariantIds: string[] = [];
const createdProductIds: string[] = [];
const createdAdminIds: string[] = [];
const createdRoleIds: string[] = [];
const createdSessionIds: string[] = [];

let permittedAdmin: AuthContext;
let restrictedAdmin: AuthContext;

// -----------------------------------------------------------------------------
// Authentication and API helpers
// -----------------------------------------------------------------------------

function getAllowedOrigin(): string {
    const origin = process.env.FRONTEND_ORIGINS
        ?.split(",")
        .map((value) => value.trim())
        .find(Boolean);

    if (!origin) {
        throw new Error("FRONTEND_ORIGINS must contain an allowed origin.");
    }

    return origin;
}

async function createAdmin(name: string) {
    const suffix = randomUUID();

    const admin = await prisma.adminUser.create({
        data: {
            name,
            email: `movement-test-${suffix}@example.test`,
            phone: `+989${suffix.replaceAll("-", "").slice(0, 10)}`,
            passwordHash: "integration-test-only",
            status: AdminStatus.ACTIVE,
            phoneVerifiedAt: new Date(),
        },
    });

    createdAdminIds.push(admin.id);
    return admin;
}

async function createAuthContext(adminId: string): Promise<AuthContext> {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    const session = await prisma.adminSession.create({
        data: {
            adminUserId: adminId,
            refreshTokenHash: hashRefreshToken(randomUUID()),
            expiresAt,
            ipAddress: "127.0.0.1",
            userAgent: "vitest-inventory-movement-management",
        },
    });

    createdSessionIds.push(session.id);

    const csrf = createSessionCsrfToken(session.id, session.expiresAt);

    await prisma.adminSession.update({
        where: { id: session.id },
        data: { csrfTokenHash: csrf.tokenHash },
    });

    const accessToken = await createAccessToken(adminId, session.id);

    return {
        adminId,
        accessToken,
        allowedOrigin: getAllowedOrigin(),
    };
}

function api(auth: AuthContext) {
    return {
        get(path: string) {
            return request(app)
                .get(path)
                .set("Authorization", `Bearer ${auth.accessToken}`);
        },
    };
}

async function assignInventoryViewPermission(adminId: string) {
    const suffix = randomUUID();

    const role = await prisma.role.create({
        data: {
            name: `movement-test-${suffix.slice(0, 8)}`,
            description: "Temporary role for inventory movement integration tests",
        },
    });

    createdRoleIds.push(role.id);

    const permission = await prisma.permission.upsert({
        where: { name: "inventory.view" },
        update: {},
        create: {
            name: "inventory.view",
            description: "Integration test permission: inventory.view",
        },
    });

    await prisma.rolePermission.create({
        data: {
            roleId: role.id,
            permissionId: permission.id,
        },
    });

    await prisma.adminUserRole.create({
        data: {
            adminUserId: adminId,
            roleId: role.id,
        },
    });
}

function expectStatus(
    response: { status: number },
    status: number,
) {
    expect(response.status).toBe(status);
}

// -----------------------------------------------------------------------------
// Database fixtures
// -----------------------------------------------------------------------------

async function createWarehouse() {
    const suffix = randomUUID();

    const warehouse = await prisma.warehouse.create({
        data: {
            name: `Movement test warehouse ${suffix}`,
            code: `MOV-WH-${suffix}`,
            address: `Movement integration test address ${suffix}`,
        },
    });

    createdWarehouseIds.push(warehouse.id);
    return warehouse;
}

async function createVariant() {
    const suffix = randomUUID();

    const product = await prisma.product.create({
        data: {
            name: `Movement fixture product ${suffix}`,
            slug: `movement-fixture-product-${suffix}`,
            description: "Created by inventory-movement-management.integration.test.ts",
        },
    });

    createdProductIds.push(product.id);

    const variant = await prisma.productVariant.create({
        data: {
            productId: product.id,
            sku: `MOV-FIXTURE-${suffix}`,
            title: `Movement fixture variant ${suffix}`,
            priceRial: 1250000n,
        },
    });

    createdVariantIds.push(variant.id);
    return { product, variant };
}

async function createMovementFixture(input: {
    movementType?: (typeof MovementType)[keyof typeof MovementType];
    quantityDelta?: number;
    referenceType?: string;
    referenceId?: string | null;
    createdBy?: string | null;
    createdAt?: Date;
} = {}) {
    const warehouse = await createWarehouse();
    const { product, variant } = await createVariant();

    const movement = await prisma.inventoryMovement.create({
        data: {
            variantId: variant.id,
            warehouseId: warehouse.id,
            movementType: input.movementType ?? MovementType.STOCKIN,
            quantityDelta: input.quantityDelta ?? 5,
            referenceType: input.referenceType ?? "MANUAL",
            referenceId: input.referenceId ?? randomUUID(),
            note: "Inventory movement integration test",
            createdBy: input.createdBy === undefined
                ? permittedAdmin.adminId
                : input.createdBy,
            ...(input.createdAt ? { createdAt: input.createdAt } : {}),
        },
    });

    return { warehouse, product, variant, movement };
}

// -----------------------------------------------------------------------------
// Setup
// -----------------------------------------------------------------------------

beforeAll(async () => {
    const admin = await createAdmin("Inventory Movement Integration Admin");
    await assignInventoryViewPermission(admin.id);
    permittedAdmin = await createAuthContext(admin.id);

    const noPermissionAdmin = await createAdmin(
        "Inventory Movement Restricted Integration Admin",
    );
    restrictedAdmin = await createAuthContext(noPermissionAdmin.id);
});

// -----------------------------------------------------------------------------
// Cleanup
// -----------------------------------------------------------------------------

afterEach(async () => {
    const variantIds = createdVariantIds.splice(0);

    if (variantIds.length) {
        await prisma.inventoryMovement.deleteMany({
            where: { variantId: { in: variantIds } },
        });

        await prisma.inventory.deleteMany({
            where: { variantId: { in: variantIds } },
        });

        await prisma.productVariant.deleteMany({
            where: { id: { in: variantIds } },
        });
    }

    if (createdWarehouseIds.length) {
        await prisma.warehouse.deleteMany({
            where: { id: { in: createdWarehouseIds.splice(0) } },
        });
    }

    if (createdProductIds.length) {
        await prisma.product.deleteMany({
            where: { id: { in: createdProductIds.splice(0) } },
        });
    }
});

afterAll(async () => {
    try {
        if (createdAdminIds.length) {
            await prisma.adminUser.deleteMany({
                where: { id: { in: createdAdminIds.splice(0) } },
            });
        }

        if (createdSessionIds.length) {
            await prisma.adminSession.deleteMany({
                where: { id: { in: createdSessionIds.splice(0) } },
            });
        }

        if (createdRoleIds.length) {
            await prisma.role.deleteMany({
                where: { id: { in: createdRoleIds.splice(0) } },
            });
        }
    } finally {
        await prisma.$disconnect();
    }
});

// -----------------------------------------------------------------------------
// Inventory Movement API - dedicated /api/inventory-movements route
// -----------------------------------------------------------------------------

describe("Inventory Movement Management API", () => {
    // -------------------------------------------------------------------------
    // Authentication and authorization
    // -------------------------------------------------------------------------

    it("rejects requests without an access token", async () => {
        const response = await request(app).get("/api/inventory-movements");

        expectStatus(response, 401);
    });

    it("rejects an authenticated admin without inventory.view permission", async () => {
        const response = await api(restrictedAdmin).get(
            "/api/inventory-movements",
        );

        expectStatus(response, 403);
    });

    // -------------------------------------------------------------------------
    // Listing and pagination
    // -------------------------------------------------------------------------

    it("lists inventory movements with pagination metadata and related records", async () => {
        const first = await createMovementFixture();
        const second = await createMovementFixture({
            movementType: MovementType.STOCKOUT,
            quantityDelta: -2,
        });

        const response = await api(permittedAdmin).get(
            `/api/inventory-movements?warehouseId=${first.warehouse.id}&page=1&limit=10`,
        );

        expectStatus(response, 200);
        expect(response.body.status).toBe("success");
        expect(response.body.data).toHaveLength(1);
        expect(response.body.data[0]).toMatchObject({
            id: first.movement.id,
            movementType: MovementType.STOCKIN,
            variantId: first.variant.id,
            warehouseId: first.warehouse.id,
            createdBy: permittedAdmin.adminId,
            productVariants: {
                id: first.variant.id,
                product: {
                    id: first.product.id,
                },
            },
            warehouses: {
                id: first.warehouse.id,
            },
            adminUsers: {
                id: permittedAdmin.adminId,
            },
        });
        expect(response.body.pagination).toMatchObject({
            page: 1,
            limit: 10,
            total: 1,
            totalPages: 1,
        });

        // Ensure the second fixture is not accidentally included.
        expect(response.body.data[0].id).not.toBe(second.movement.id);
    });

    it("paginates movement results", async () => {
        await createMovementFixture();
        await createMovementFixture();
        await createMovementFixture();

        const firstPage = await api(permittedAdmin).get(
            "/api/inventory-movements?page=1&limit=2",
        );

        expectStatus(firstPage, 200);
        expect(firstPage.body.data).toHaveLength(2);
        expect(firstPage.body.pagination).toMatchObject({
            page: 1,
            limit: 2,
            total: 3,
            totalPages: 2,
        });

        const secondPage = await api(permittedAdmin).get(
            "/api/inventory-movements?page=2&limit=2",
        );

        expectStatus(secondPage, 200);
        expect(secondPage.body.data).toHaveLength(1);
        expect(secondPage.body.pagination).toMatchObject({
            page: 2,
            limit: 2,
            total: 3,
            totalPages: 2,
        });

        const firstPageIds = firstPage.body.data.map(
            (item: { id: string }) => item.id,
        );
        const secondPageIds = secondPage.body.data.map(
            (item: { id: string }) => item.id,
        );

        expect(firstPageIds).not.toContain(secondPageIds[0]);
    });

    it("returns an empty list when no movements match the filters", async () => {
        const response = await api(permittedAdmin).get(
            `/api/inventory-movements?variantId=${randomUUID()}`,
        );

        expectStatus(response, 200);
        expect(response.body.data).toEqual([]);
        expect(response.body.pagination.total).toBe(0);
    });

    // -------------------------------------------------------------------------
    // Filters
    // -------------------------------------------------------------------------

    it("filters movements by variant, warehouse, type and admin", async () => {
        const fixture = await createMovementFixture({
            movementType: MovementType.STOCKIN,
            quantityDelta: 9,
        });

        await createMovementFixture({
            movementType: MovementType.STOCKOUT,
            quantityDelta: -1,
        });

        const response = await api(permittedAdmin).get(
            `/api/inventory-movements?variantId=${fixture.variant.id}` +
            `&warehouseId=${fixture.warehouse.id}` +
            `&movementType=STOCKIN` +
            `&createdBy=${permittedAdmin.adminId}`,
        );

        expectStatus(response, 200);
        expect(response.body.data).toHaveLength(1);
        expect(response.body.data[0]).toMatchObject({
            id: fixture.movement.id,
            variantId: fixture.variant.id,
            warehouseId: fixture.warehouse.id,
            movementType: MovementType.STOCKIN,
            createdBy: permittedAdmin.adminId,
        });
    });

    it("filters movements by reference type and reference ID", async () => {
        const referenceId = randomUUID();

        const matching = await createMovementFixture({
            referenceType: "ORDER",
            referenceId,
        });

        await createMovementFixture({
            referenceType: "MANUAL",
            referenceId: randomUUID(),
        });

        const response = await api(permittedAdmin).get(
            `/api/inventory-movements?referenceType=ORDER&referenceId=${referenceId}`,
        );

        expectStatus(response, 200);
        expect(response.body.data).toHaveLength(1);
        expect(response.body.data[0]).toMatchObject({
            id: matching.movement.id,
            referenceType: "ORDER",
            referenceId,
        });
    });

    it("filters movements by an inclusive date range", async () => {
        const from = new Date("2026-11-10T00:00:00.000Z");
        const inside = new Date("2026-11-15T12:00:00.000Z");
        const to = new Date("2026-11-20T00:00:00.000Z");

        const matching = await createMovementFixture({ createdAt: inside });
        await createMovementFixture({
            createdAt: new Date("2026-11-05T12:00:00.000Z"),
        });
        await createMovementFixture({
            createdAt: new Date("2026-11-25T12:00:00.000Z"),
        });

        const response = await api(permittedAdmin).get(
            `/api/inventory-movements?from=${encodeURIComponent(from.toISOString())}` +
            `&to=${encodeURIComponent(to.toISOString())}`,
        );

        expectStatus(response, 200);
        const ids = response.body.data.map((item: { id: string }) => item.id);
        expect(ids).toContain(matching.movement.id);
        expect(response.body.data).toHaveLength(1);
    });

    // -------------------------------------------------------------------------
    // Validation
    // -------------------------------------------------------------------------

    it("rejects an invalid movement ID", async () => {
        const response = await api(permittedAdmin).get(
            "/api/inventory-movements/not-a-uuid",
        );

        expectStatus(response, 400);
    });

    it("returns 404 when a movement does not exist", async () => {
        const response = await api(permittedAdmin).get(
            `/api/inventory-movements/${randomUUID()}`,
        );

        expectStatus(response, 404);
        expect(response.body.code).toBe("INVENTORY_MOVEMENT_NOT_FOUND");
    });

    it("rejects an invalid variant filter UUID", async () => {
        const response = await api(permittedAdmin).get(
            "/api/inventory-movements?variantId=not-a-uuid",
        );

        expectStatus(response, 400);
        expect(response.body.code).toBe("INVALID_VARIANT_ID");
    });

    it("rejects an invalid warehouse filter UUID", async () => {
        const response = await api(permittedAdmin).get(
            "/api/inventory-movements?warehouseId=not-a-uuid",
        );

        expectStatus(response, 400);
        expect(response.body.code).toBe("INVALID_WAREHOUSE_ID");
    });

    it("rejects an invalid reference ID UUID", async () => {
        const response = await api(permittedAdmin).get(
            "/api/inventory-movements?referenceId=not-a-uuid",
        );

        expectStatus(response, 400);
        expect(response.body.code).toBe("INVALID_REFERENCE_ID");
    });

    it("rejects an invalid createdBy filter UUID", async () => {
        const response = await api(permittedAdmin).get(
            "/api/inventory-movements?createdBy=not-a-uuid",
        );

        expectStatus(response, 400);
        expect(response.body.code).toBe("INVALID_CREATED_BY");
    });

    it("rejects an unsupported movement type filter", async () => {
        const response = await api(permittedAdmin).get(
            "/api/inventory-movements?movementType=UNKNOWN",
        );

        expectStatus(response, 400);
        expect(response.body.code).toBe("INVALID_MOVEMENT_TYPE");
    });

    it("rejects an invalid date range", async () => {
        const response = await api(permittedAdmin).get(
            "/api/inventory-movements" +
            "?from=2026-11-20T12:00:00.000Z" +
            "&to=2026-11-19T12:00:00.000Z",
        );

        expectStatus(response, 400);
        expect(response.body.code).toBe("INVALID_DATE_RANGE");
    });

    it("rejects invalid pagination values", async () => {
        const response = await api(permittedAdmin).get(
            "/api/inventory-movements?page=0&limit=10",
        );

        expectStatus(response, 400);
    });

    // -------------------------------------------------------------------------
    // Movement details
    // -------------------------------------------------------------------------

    it("gets a movement by ID with variant, product, warehouse and admin details", async () => {
        const fixture = await createMovementFixture();

        const response = await api(permittedAdmin).get(
            `/api/inventory-movements/${fixture.movement.id}`,
        );

        expectStatus(response, 200);
        expect(response.body.status).toBe("success");
        expect(response.body.data).toMatchObject({
            id: fixture.movement.id,
            movementType: MovementType.STOCKIN,
            quantityDelta: 5,
            variantId: fixture.variant.id,
            warehouseId: fixture.warehouse.id,
            createdBy: permittedAdmin.adminId,
            productVariants: {
                id: fixture.variant.id,
                product: {
                    id: fixture.product.id,
                },
            },
            warehouses: {
                id: fixture.warehouse.id,
            },
            adminUsers: {
                id: permittedAdmin.adminId,
            },
        });
    });

    it("returns null admin relation when createdBy is null", async () => {
        const fixture = await createMovementFixture({ createdBy: null });

        const response = await api(permittedAdmin).get(
            `/api/inventory-movements/${fixture.movement.id}`,
        );

        expectStatus(response, 200);
        expect(response.body.data.createdBy).toBeNull();
        expect(response.body.data.adminUsers).toBeNull();
    });

    // -------------------------------------------------------------------------
    // Read-only audit history
    // -------------------------------------------------------------------------

    it("does not expose mutation endpoints for movement history", async () => {
        const fixture = await createMovementFixture();
        const path = `/api/inventory-movements/${fixture.movement.id}`;

        const postResponse = await request(app)
            .post("/api/inventory-movements")
            .set("Authorization", `Bearer ${permittedAdmin.accessToken}`)
            .send({ note: "Attempt to create audit history directly" });

        const patchResponse = await request(app)
            .patch(path)
            .set("Authorization", `Bearer ${permittedAdmin.accessToken}`)
            .send({ note: "Attempt to modify immutable history" });

        const deleteResponse = await request(app)
            .delete(path)
            .set("Authorization", `Bearer ${permittedAdmin.accessToken}`);

        expect(postResponse.status).toBe(404);
        expect(patchResponse.status).toBe(404);
        expect(deleteResponse.status).toBe(404);

        const stored = await prisma.inventoryMovement.findUnique({
            where: { id: fixture.movement.id },
        });

        expect(stored).not.toBeNull();
        expect(stored?.note).toBe("Inventory movement integration test");
    });
});
