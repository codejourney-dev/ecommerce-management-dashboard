import { config } from "dotenv";
config({path: ".env.test"});
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
        "Inventory API tests may run only against ecommerce_dashboard_migration_test.",
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

// Keep these permissions aligned with inventory.routes.ts and seed-permissions.
const INVENTORY_PERMISSIONS = [
    "inventory.view",
    "inventory.manage",
] as const;

type AuthContext = {
    adminId: string;
    accessToken: string;
    csrfToken: string;
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
            email: `inventory-test-${suffix}@example.test`,
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
            userAgent: "vitest-inventory-management",
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
        csrfToken: csrf.token,
        allowedOrigin: getAllowedOrigin(),
    };
}

function api(auth: AuthContext) {
    const withAuth = (
        method: "get" | "post" | "patch",
        path: string,
    ) => {
        const call = request(app)[method](path).set(
            "Authorization",
            `Bearer ${auth.accessToken}`,
        );

        if (method === "get") {
            return call;
        }

        return call
            .set("Origin", auth.allowedOrigin)
            .set("Cookie", `csrf_token=${auth.csrfToken}`)
            .set("X-CSRF-Token", auth.csrfToken);
    };

    return {
        get(path: string) {
            return withAuth("get", path);
        },
        post(path: string, body?: unknown) {
            return withAuth("post", path).send(body ?? {});
        },
        patch(path: string, body?: unknown) {
            return withAuth("patch", path).send(body ?? {});
        },
    };
}

async function assignInventoryPermissions(adminId: string) {
    const suffix = randomUUID();

    const role = await prisma.role.create({
        data: {
            name: `inv-test-${suffix.slice(0, 8)}`,
            description: "Temporary role for inventory integration tests",
        },
    });

    createdRoleIds.push(role.id);

    const permissions = await Promise.all(
        INVENTORY_PERMISSIONS.map((name) =>
            prisma.permission.upsert({
                where: { name },
                update: {},
                create: {
                    name,
                    description: `Integration test permission: ${name}`,
                },
            }),
        ),
    );

    await prisma.rolePermission.createMany({
        data: permissions.map((permission) => ({
            roleId: role.id,
            permissionId: permission.id,
        })),
        skipDuplicates: true,
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

async function createWarehouse(input: {
    name?: string;
    isActive?: boolean;
} = {}) {
    const suffix = randomUUID();

    const warehouse = await prisma.warehouse.create({
        data: {
            name: input.name ?? `Inventory test warehouse ${suffix}`,
            code: `INV-WH-${suffix}`,
            address: `Inventory integration test address ${suffix}`,
            isActive: input.isActive ?? true,
        },
    });

    createdWarehouseIds.push(warehouse.id);
    return warehouse;
}

async function createVariant(input: {
    isActive?: boolean;
} = {}) {
    const suffix = randomUUID();

    const product = await prisma.product.create({
        data: {
            name: `Inventory fixture product ${suffix}`,
            slug: `inventory-fixture-product-${suffix}`,
            description: "Created by inventory-management.integration.test.ts",
        },
    });

    createdProductIds.push(product.id);

    const variant = await prisma.productVariant.create({
        data: {
            productId: product.id,
            sku: `INV-FIXTURE-${suffix}`,
            title: `Inventory fixture variant ${suffix}`,
            priceRial: 1250000n,
            isActive: input.isActive ?? true,
        },
    });

    createdVariantIds.push(variant.id);
    return { product, variant };
}

async function createInventoryFixture(input: {
    quantityOnHand?: number;
    quantityReserved?: number;
    reorderLevel?: number;
    warehouseActive?: boolean;
    variantActive?: boolean;
} = {}) {
    const warehouse = await createWarehouse({
        isActive: input.warehouseActive ?? true,
    });
    const { product, variant } = await createVariant({
        isActive: input.variantActive ?? true,
    });

    const inventory = await prisma.inventory.create({
        data: {
            variantId: variant.id,
            warehouseId: warehouse.id,
            quantityOnHand: input.quantityOnHand ?? 12,
            quantityReserved: input.quantityReserved ?? 2,
            reorderLevel: input.reorderLevel ?? 3,
        },
    });

    return { warehouse, product, variant, inventory };
}

function stockOperationPayload(
    variantId: string,
    warehouseId: string,
    overrides: Record<string, unknown> = {},
) {
    return {
        variantId,
        warehouseId,
        quantity: 3,
        note: "Inventory integration test movement",
        ...overrides,
    };
}

// -----------------------------------------------------------------------------
// Setup
// -----------------------------------------------------------------------------

beforeAll(async () => {
    const admin = await createAdmin("Inventory Integration Admin");
    await assignInventoryPermissions(admin.id);
    permittedAdmin = await createAuthContext(admin.id);

    const noPermissionAdmin = await createAdmin(
        "Inventory Restricted Integration Admin",
    );
    restrictedAdmin = await createAuthContext(noPermissionAdmin.id);
});

// -----------------------------------------------------------------------------
// Cleanup
// -----------------------------------------------------------------------------

afterEach(async () => {
    const variantIds = createdVariantIds.splice(0);

    // Inventory movements and inventory rows reference variants and warehouses.
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
// Inventory API
// -----------------------------------------------------------------------------

describe("Inventory Management API", () => {
    // -------------------------------------------------------------------------
    // Authentication, authorization and CSRF
    // -------------------------------------------------------------------------

    it("rejects requests without an access token", async () => {
        const response = await request(app).get("/api/inventory");
        expectStatus(response, 401);
    });

    it("rejects an authenticated admin without inventory.view permission", async () => {
        const response = await api(restrictedAdmin).get("/api/inventory");
        expectStatus(response, 403);
    });

    it("rejects an authenticated admin without inventory.manage permission", async () => {
        const fixture = await createInventoryFixture();

        const response = await api(restrictedAdmin).post(
            "/api/inventory/stock-in",
            stockOperationPayload(fixture.variant.id, fixture.warehouse.id),
        );

        expectStatus(response, 403);
    });

    it("rejects a mutation without a valid CSRF token", async () => {
        const fixture = await createInventoryFixture();

        const response = await request(app)
            .post("/api/inventory/stock-in")
            .set("Authorization", `Bearer ${permittedAdmin.accessToken}`)
            .set("Origin", permittedAdmin.allowedOrigin)
            .send(stockOperationPayload(fixture.variant.id, fixture.warehouse.id));

        expectStatus(response, 403);
    });

    // -------------------------------------------------------------------------
    // Inventory listing, filtering and details
    // -------------------------------------------------------------------------

    it("lists inventory with pagination metadata", async () => {
        const warehouse = await createWarehouse();
        const firstVariant = await createVariant();
        const secondVariant = await createVariant();

        const firstInventory = await prisma.inventory.create({
            data: {
                variantId: firstVariant.variant.id,
                warehouseId: warehouse.id,
                quantityOnHand: 8,
                quantityReserved: 1,
                reorderLevel: 2,
            },
        });

        const secondInventory = await prisma.inventory.create({
            data: {
                variantId: secondVariant.variant.id,
                warehouseId: warehouse.id,
                quantityOnHand: 9,
                quantityReserved: 2,
                reorderLevel: 3,
            },
        });

        const response = await api(permittedAdmin).get(
            `/api/inventory?warehouseId=${warehouse.id}&page=1&limit=1`,
        );

        expectStatus(response, 200);
        expect(response.body.status).toBe("success");
        expect(response.body.data).toHaveLength(1);
        expect(response.body.pagination).toMatchObject({
            page: 1,
            limit: 1,
            total: 2,
        });
        expect(
            [firstInventory.id, secondInventory.id],
        ).toContain(response.body.data[0].id);
    });

    it("filters inventory by low-stock status", async () => {
        const lowStock = await createInventoryFixture({
            quantityOnHand: 2,
            quantityReserved: 0,
            reorderLevel: 5,
        });
        const healthyStock = await createInventoryFixture({
            quantityOnHand: 20,
            quantityReserved: 0,
            reorderLevel: 5,
        });

        const response = await api(permittedAdmin).get(
            `/api/inventory?lowStock=true&warehouseId=${lowStock.warehouse.id}`,
        );

        expectStatus(response, 200);

        const ids = response.body.data.map((item: { id: string }) => item.id);
        expect(ids).toContain(lowStock.inventory.id);
        expect(ids).not.toContain(healthyStock.inventory.id);
    });

    it("filters inventory by warehouse and variant", async () => {
        const fixture = await createInventoryFixture();

        const response = await api(permittedAdmin).get(
            `/api/inventory?warehouseId=${fixture.warehouse.id}&variantId=${fixture.variant.id}`,
        );

        expectStatus(response, 200);
        expect(response.body.data).toHaveLength(1);
        expect(response.body.data[0].id).toBe(fixture.inventory.id);
    });

    it("rejects invalid inventory filter UUIDs", async () => {
        const response = await api(permittedAdmin).get(
            "/api/inventory?warehouseId=not-a-uuid",
        );

        expectStatus(response, 400);
        expect(response.body.code).toBe("INVALID_WAREHOUSE_ID");
    });

    it("gets an inventory record with calculated available and low-stock values", async () => {
        const fixture = await createInventoryFixture({
            quantityOnHand: 12,
            quantityReserved: 4,
            reorderLevel: 15,
        });

        const response = await api(permittedAdmin).get(
            `/api/inventory/${fixture.inventory.id}`,
        );

        expectStatus(response, 200);
        expect(response.body.data).toMatchObject({
            id: fixture.inventory.id,
            quantityOnHand: 12,
            quantityReserved: 4,
            quantityAvailable: 8,
            isLowStock: true,
        });
    });

    it("returns 404 when an inventory record does not exist", async () => {
        const response = await api(permittedAdmin).get(
            `/api/inventory/${randomUUID()}`,
        );

        expectStatus(response, 404);
        expect(response.body.code).toBe("INVENTORY_NOT_FOUND");
    });

    it("gets variant stock totals across multiple warehouses", async () => {
        const { variant } = await createVariant();
        const firstWarehouse = await createWarehouse();
        const secondWarehouse = await createWarehouse();

        await prisma.inventory.create({
            data: {
                variantId: variant.id,
                warehouseId: firstWarehouse.id,
                quantityOnHand: 10,
                quantityReserved: 2,
                reorderLevel: 3,
            },
        });

        await prisma.inventory.create({
            data: {
                variantId: variant.id,
                warehouseId: secondWarehouse.id,
                quantityOnHand: 7,
                quantityReserved: 1,
                reorderLevel: 2,
            },
        });

        const response = await api(permittedAdmin).get(
            `/api/inventory/variants/${variant.id}`,
        );

        expectStatus(response, 200);
        expect(response.body.data.inventory).toHaveLength(2);
        expect(response.body.data.totals).toEqual({
            quantityOnHand: 17,
            quantityReserved: 3,
            quantityAvailable: 14,
        });
    });

    // -------------------------------------------------------------------------
    // Reorder level
    // -------------------------------------------------------------------------

    it("updates the reorder level", async () => {
        const fixture = await createInventoryFixture({
            quantityOnHand: 10,
            quantityReserved: 2,
            reorderLevel: 3,
        });

        const response = await api(permittedAdmin).patch(
            `/api/inventory/${fixture.inventory.id}/reorder-level`,
            { reorderLevel: 12 },
        );

        expectStatus(response, 200);
        expect(response.body.data).toMatchObject({
            id: fixture.inventory.id,
            reorderLevel: 12,
            quantityAvailable: 8,
            isLowStock: true,
        });
    });

    it("rejects a negative reorder level", async () => {
        const fixture = await createInventoryFixture();

        const response = await api(permittedAdmin).patch(
            `/api/inventory/${fixture.inventory.id}/reorder-level`,
            { reorderLevel: -1 },
        );

        expectStatus(response, 400);
        expect(response.body.code).toBe("INVALID_REORDER_LEVEL");
    });

    // -------------------------------------------------------------------------
    // Stock in
    // -------------------------------------------------------------------------

    it("records stock-in, creates inventory when needed and attributes the movement to the authenticated admin", async () => {
        const warehouse = await createWarehouse();
        const { variant } = await createVariant();

        const response = await api(permittedAdmin).post(
            "/api/inventory/stock-in",
            stockOperationPayload(variant.id, warehouse.id, {
                quantity: 8,
                createdBy: randomUUID(),
            }),
        );

        expectStatus(response, 201);
        expect(response.body.data.inventory).toMatchObject({
            variantId: variant.id,
            warehouseId: warehouse.id,
            quantityOnHand: 8,
            quantityReserved: 0,
            quantityAvailable: 8,
        });
        expect(response.body.data.movement).toMatchObject({
            movementType: MovementType.STOCKIN,
            quantityDelta: 8,
            referenceType: "MANUAL",
            createdBy: permittedAdmin.adminId,
        });

        const storedMovement = await prisma.inventoryMovement.findUnique({
            where: { id: response.body.data.movement.id },
        });
        expect(storedMovement?.createdBy).toBe(permittedAdmin.adminId);
    });

    it("rejects zero stock-in quantity", async () => {
        const fixture = await createInventoryFixture();

        const response = await api(permittedAdmin).post(
            "/api/inventory/stock-in",
            stockOperationPayload(fixture.variant.id, fixture.warehouse.id, {
                quantity: 0,
            }),
        );

        expectStatus(response, 400);
        expect(response.body.code).toBe("INVALID_QUANTITY");
    });

    it("rejects stock-in to an inactive warehouse", async () => {
        const fixture = await createInventoryFixture({
            warehouseActive: false,
        });

        const response = await api(permittedAdmin).post(
            "/api/inventory/stock-in",
            stockOperationPayload(fixture.variant.id, fixture.warehouse.id),
        );

        expectStatus(response, 409);
        expect(response.body.code).toBe("WAREHOUSE_INACTIVE");
    });

    // -------------------------------------------------------------------------
    // Stock out
    // -------------------------------------------------------------------------

    it("records stock-out with a negative movement delta", async () => {
        const fixture = await createInventoryFixture({
            quantityOnHand: 12,
            quantityReserved: 2,
        });

        const response = await api(permittedAdmin).post(
            "/api/inventory/stock-out",
            stockOperationPayload(fixture.variant.id, fixture.warehouse.id, {
                quantity: 4,
            }),
        );

        expectStatus(response, 201);
        expect(response.body.data.inventory).toMatchObject({
            quantityOnHand: 8,
            quantityReserved: 2,
            quantityAvailable: 6,
        });
        expect(response.body.data.movement).toMatchObject({
            movementType: MovementType.STOCKOUT,
            quantityDelta: -4,
            createdBy: permittedAdmin.adminId,
        });
    });

    it("prevents stock-out beyond available quantity", async () => {
        const fixture = await createInventoryFixture({
            quantityOnHand: 10,
            quantityReserved: 4,
        });

        const response = await api(permittedAdmin).post(
            "/api/inventory/stock-out",
            stockOperationPayload(fixture.variant.id, fixture.warehouse.id, {
                quantity: 7,
            }),
        );

        expectStatus(response, 409);
        expect(response.body.code).toBe("INSUFFICIENT_STOCK");

        const stored = await prisma.inventory.findUnique({
            where: { id: fixture.inventory.id },
        });
        expect(stored?.quantityOnHand).toBe(10);
    });

    it("rejects stock-out for an inactive variant", async () => {
        const fixture = await createInventoryFixture({
            variantActive: false,
        });

        const response = await api(permittedAdmin).post(
            "/api/inventory/stock-out",
            stockOperationPayload(fixture.variant.id, fixture.warehouse.id),
        );

        expectStatus(response, 409);
        expect(response.body.code).toBe("VARIANT_INACTIVE");
    });

    it("returns 404 when stock-out has no inventory record", async () => {
        const warehouse = await createWarehouse();
        const { variant } = await createVariant();

        const response = await api(permittedAdmin).post(
            "/api/inventory/stock-out",
            stockOperationPayload(variant.id, warehouse.id),
        );

        expectStatus(response, 404);
        expect(response.body.code).toBe("INVENTORY_NOT_FOUND");
    });

    // -------------------------------------------------------------------------
    // Adjustment
    // -------------------------------------------------------------------------

    it("supports positive and negative inventory adjustments", async () => {
        const fixture = await createInventoryFixture({
            quantityOnHand: 10,
            quantityReserved: 2,
        });

        const increase = await api(permittedAdmin).post(
            "/api/inventory/adjustment",
            {
                variantId: fixture.variant.id,
                warehouseId: fixture.warehouse.id,
                quantityDelta: 5,
                note: "Positive stock correction",
            },
        );

        expectStatus(increase, 201);
        expect(increase.body.data.inventory.quantityOnHand).toBe(15);
        expect(increase.body.data.movement).toMatchObject({
            movementType: MovementType.ADJUSTMENT,
            quantityDelta: 5,
            createdBy: permittedAdmin.adminId,
        });

        const decrease = await api(permittedAdmin).post(
            "/api/inventory/adjustment",
            {
                variantId: fixture.variant.id,
                warehouseId: fixture.warehouse.id,
                quantityDelta: -3,
                note: "Negative stock correction",
            },
        );

        expectStatus(decrease, 201);
        expect(decrease.body.data.inventory.quantityOnHand).toBe(12);
        expect(decrease.body.data.movement.quantityDelta).toBe(-3);
    });

    it("prevents an adjustment from reducing stock below reserved quantity", async () => {
        const fixture = await createInventoryFixture({
            quantityOnHand: 10,
            quantityReserved: 4,
        });

        const response = await api(permittedAdmin).post(
            "/api/inventory/adjustment",
            {
                variantId: fixture.variant.id,
                warehouseId: fixture.warehouse.id,
                quantityDelta: -7,
                note: "Invalid stock correction",
            },
        );

        expectStatus(response, 409);
        expect(response.body.code).toBe("ADJUSTMENT_BELOW_RESERVED_STOCK");
    });

    it("rejects a zero adjustment delta", async () => {
        const fixture = await createInventoryFixture();

        const response = await api(permittedAdmin).post(
            "/api/inventory/adjustment",
            {
                variantId: fixture.variant.id,
                warehouseId: fixture.warehouse.id,
                quantityDelta: 0,
                note: "Zero adjustment",
            },
        );

        expectStatus(response, 400);
        expect(response.body.code).toBe("INVALID_QUANTITY_DELTA");
    });

    // -------------------------------------------------------------------------
    // Returns
    // -------------------------------------------------------------------------

    it("records returned stock and creates an inventory record when needed", async () => {
        const warehouse = await createWarehouse();
        const { variant } = await createVariant();

        const response = await api(permittedAdmin).post(
            "/api/inventory/return",
            stockOperationPayload(variant.id, warehouse.id, {
                quantity: 2,
            }),
        );

        expectStatus(response, 201);
        expect(response.body.data.inventory).toMatchObject({
            quantityOnHand: 2,
            quantityReserved: 0,
            quantityAvailable: 2,
        });
        expect(response.body.data.movement).toMatchObject({
            movementType: MovementType.RETURN,
            quantityDelta: 2,
            referenceType: "RETURN",
            createdBy: permittedAdmin.adminId,
        });
    });

    // -------------------------------------------------------------------------
    // Reservations
    // -------------------------------------------------------------------------

    it("reserves stock without changing quantity on hand", async () => {
        const fixture = await createInventoryFixture({
            quantityOnHand: 10,
            quantityReserved: 2,
        });

        const response = await api(permittedAdmin).post(
            "/api/inventory/reserve",
            stockOperationPayload(fixture.variant.id, fixture.warehouse.id, {
                quantity: 3,
            }),
        );

        expectStatus(response, 201);
        expect(response.body.data.inventory).toMatchObject({
            quantityOnHand: 10,
            quantityReserved: 5,
            quantityAvailable: 5,
        });
        expect(response.body.data.movement).toMatchObject({
            movementType: MovementType.RESERVATION,
            quantityDelta: 3,
            createdBy: permittedAdmin.adminId,
        });
    });

    it("prevents reserving more than available stock", async () => {
        const fixture = await createInventoryFixture({
            quantityOnHand: 10,
            quantityReserved: 7,
        });

        const response = await api(permittedAdmin).post(
            "/api/inventory/reserve",
            stockOperationPayload(fixture.variant.id, fixture.warehouse.id, {
                quantity: 4,
            }),
        );

        expectStatus(response, 409);
        expect(response.body.code).toBe("INSUFFICIENT_STOCK");
    });

    it("rejects reservation for an inactive variant", async () => {
        const fixture = await createInventoryFixture({
            variantActive: false,
        });

        const response = await api(permittedAdmin).post(
            "/api/inventory/reserve",
            stockOperationPayload(fixture.variant.id, fixture.warehouse.id),
        );

        expectStatus(response, 409);
        expect(response.body.code).toBe("VARIANT_INACTIVE");
    });

    it("releases reserved stock without changing quantity on hand", async () => {
        const fixture = await createInventoryFixture({
            quantityOnHand: 10,
            quantityReserved: 5,
        });

        const response = await api(permittedAdmin).post(
            "/api/inventory/release",
            stockOperationPayload(fixture.variant.id, fixture.warehouse.id, {
                quantity: 2,
            }),
        );

        expectStatus(response, 200);
        expect(response.body.data.inventory).toMatchObject({
            quantityOnHand: 10,
            quantityReserved: 3,
            quantityAvailable: 7,
        });
        expect(response.body.data.movement).toMatchObject({
            movementType: MovementType.RESERVATION_RELEASE,
            quantityDelta: -2,
            createdBy: permittedAdmin.adminId,
        });
    });

    it("prevents releasing more than the reserved quantity", async () => {
        const fixture = await createInventoryFixture({
            quantityOnHand: 10,
            quantityReserved: 2,
        });

        const response = await api(permittedAdmin).post(
            "/api/inventory/release",
            stockOperationPayload(fixture.variant.id, fixture.warehouse.id, {
                quantity: 3,
            }),
        );

        expectStatus(response, 409);
        expect(response.body.code).toBe("INSUFFICIENT_RESERVED_STOCK");
    });

    // -------------------------------------------------------------------------
    // Transfers
    // -------------------------------------------------------------------------

    it("transfers stock atomically and creates two linked movement records", async () => {
        const source = await createWarehouse();
        const destination = await createWarehouse();
        const { variant } = await createVariant();

        const sourceInventory = await prisma.inventory.create({
            data: {
                variantId: variant.id,
                warehouseId: source.id,
                quantityOnHand: 12,
                quantityReserved: 2,
                reorderLevel: 3,
            },
        });

        const response = await api(permittedAdmin).post(
            "/api/inventory/transfer",
            {
                variantId: variant.id,
                sourceWarehouseId: source.id,
                destinationWarehouseId: destination.id,
                quantity: 5,
                note: "Transfer between test warehouses",
            },
        );

        expectStatus(response, 201);

        const referenceId = response.body.data.referenceId;
        expect(referenceId).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        );

        expect(response.body.data.source.inventory).toMatchObject({
            id: sourceInventory.id,
            quantityOnHand: 7,
            quantityReserved: 2,
            quantityAvailable: 5,
        });
        expect(response.body.data.destination.inventory).toMatchObject({
            variantId: variant.id,
            warehouseId: destination.id,
            quantityOnHand: 5,
            quantityReserved: 0,
            quantityAvailable: 5,
        });

        const movements = await prisma.inventoryMovement.findMany({
            where: {
                referenceType: "TRANSFER",
                referenceId,
            },
            orderBy: { quantityDelta: "asc" },
        });

        expect(movements).toHaveLength(2);
        expect(movements.map((movement) => movement.quantityDelta)).toEqual([
            -5,
            5,
        ]);
        expect(movements.every(
            (movement) => movement.createdBy === permittedAdmin.adminId,
        )).toBe(true);
        expect(movements.every(
            (movement) => movement.variantId === variant.id,
        )).toBe(true);
    });

    it("rejects a transfer between the same warehouse", async () => {
        const fixture = await createInventoryFixture();

        const response = await api(permittedAdmin).post(
            "/api/inventory/transfer",
            {
                variantId: fixture.variant.id,
                sourceWarehouseId: fixture.warehouse.id,
                destinationWarehouseId: fixture.warehouse.id,
                quantity: 1,
            },
        );

        expectStatus(response, 400);
        expect(response.body.code).toBe("INVALID_TRANSFER_WAREHOUSES");
    });

    it("prevents a transfer beyond available stock", async () => {
        const source = await createWarehouse();
        const destination = await createWarehouse();
        const { variant } = await createVariant();

        await prisma.inventory.create({
            data: {
                variantId: variant.id,
                warehouseId: source.id,
                quantityOnHand: 8,
                quantityReserved: 3,
                reorderLevel: 2,
            },
        });

        const response = await api(permittedAdmin).post(
            "/api/inventory/transfer",
            {
                variantId: variant.id,
                sourceWarehouseId: source.id,
                destinationWarehouseId: destination.id,
                quantity: 6,
            },
        );

        expectStatus(response, 409);
        expect(response.body.code).toBe("INSUFFICIENT_STOCK");

        const destinationInventory = await prisma.inventory.findUnique({
            where: {
                variantId_warehouseId: {
                    variantId: variant.id,
                    warehouseId: destination.id,
                },
            },
        });
        expect(destinationInventory).toBeNull();
    });

    it("rejects a transfer into an inactive destination warehouse", async () => {
        const source = await createWarehouse();
        const destination = await createWarehouse({ isActive: false });
        const { variant } = await createVariant();

        await prisma.inventory.create({
            data: {
                variantId: variant.id,
                warehouseId: source.id,
                quantityOnHand: 8,
                quantityReserved: 0,
                reorderLevel: 2,
            },
        });

        const response = await api(permittedAdmin).post(
            "/api/inventory/transfer",
            {
                variantId: variant.id,
                sourceWarehouseId: source.id,
                destinationWarehouseId: destination.id,
                quantity: 2,
            },
        );

        expectStatus(response, 409);
        expect(response.body.code).toBe("WAREHOUSE_INACTIVE");
    });

    // -------------------------------------------------------------------------
    // Inventory movement history
    // -------------------------------------------------------------------------

    it("lists movements and filters them by type, variant, warehouse and admin", async () => {
        const fixture = await createInventoryFixture();

        const stockInResponse = await api(permittedAdmin).post(
            "/api/inventory/stock-in",
            stockOperationPayload(fixture.variant.id, fixture.warehouse.id, {
                quantity: 6,
            }),
        );
        expectStatus(stockInResponse, 201);

        const response = await api(permittedAdmin).get(
            `/api/inventory/movements?movementType=STOCKIN&variantId=${fixture.variant.id}&warehouseId=${fixture.warehouse.id}&createdBy=${permittedAdmin.adminId}&page=1&limit=10`,
        );

        expectStatus(response, 200);
        expect(response.body.data).toHaveLength(1);
        expect(response.body.data[0]).toMatchObject({
            id: stockInResponse.body.data.movement.id,
            movementType: MovementType.STOCKIN,
            variantId: fixture.variant.id,
            warehouseId: fixture.warehouse.id,
            createdBy: permittedAdmin.adminId,
        });
        expect(response.body.data[0].adminUsers).toMatchObject({
            id: permittedAdmin.adminId,
        });
        expect(response.body.pagination).toMatchObject({
            page: 1,
            limit: 10,
            total: 1,
        });
    });

    it("gets an inventory movement by ID with related admin information", async () => {
        const fixture = await createInventoryFixture();

        const created = await api(permittedAdmin).post(
            "/api/inventory/stock-in",
            stockOperationPayload(fixture.variant.id, fixture.warehouse.id),
        );
        expectStatus(created, 201);

        const movementId = created.body.data.movement.id;
        const response = await api(permittedAdmin).get(
            `/api/inventory/movements/${movementId}`,
        );

        expectStatus(response, 200);
        expect(response.body.data).toMatchObject({
            id: movementId,
            createdBy: permittedAdmin.adminId,
            adminUsers: {
                id: permittedAdmin.adminId,
            },
        });
    });

    it("returns 404 for a movement that does not exist", async () => {
        const response = await api(permittedAdmin).get(
            `/api/inventory/movements/${randomUUID()}`,
        );

        expectStatus(response, 404);
        expect(response.body.code).toBe("INVENTORY_MOVEMENT_NOT_FOUND");
    });

    it("rejects an unsupported movement type filter", async () => {
        const response = await api(permittedAdmin).get(
            "/api/inventory/movements?movementType=UNKNOWN",
        );

        expectStatus(response, 400);
        expect(response.body.code).toBe("INVALID_MOVEMENT_TYPE");
    });

    it("rejects an invalid movement date range", async () => {
        const response = await api(permittedAdmin).get(
            "/api/inventory/movements?from=2026-11-20T12:00:00.000Z&to=2026-11-19T12:00:00.000Z",
        );

        expectStatus(response, 400);
        expect(response.body.code).toBe("INVALID_DATE_RANGE");
    });

    it("rejects an invalid createdBy filter UUID", async () => {
        const response = await api(permittedAdmin).get(
            "/api/inventory/movements?createdBy=not-a-uuid",
        );

        expectStatus(response, 400);
        expect(response.body.code).toBe("INVALID_CREATED_BY");
    });
});
