import {config} from "dotenv";
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
      "Inventory regression tests may run only against ecommerce_dashboard_migration_test.",
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

async function createAdmin() {
  const suffix = randomUUID();

  const admin = await prisma.adminUser.create({
    data: {
      name: "Inventory Regression Integration Admin",
      email: `inventory-regression-${suffix}@example.test`,
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
      userAgent: "vitest-inventory-regression",
    },
  });

  createdSessionIds.push(session.id);

  const csrf = createSessionCsrfToken(session.id, session.expiresAt);

  await prisma.adminSession.update({
    where: { id: session.id },
    data: { csrfTokenHash: csrf.tokenHash },
  });

  return {
    adminId,
    accessToken: await createAccessToken(adminId, session.id),
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
      name: `inv-regression-${suffix.slice(0, 8)}`,
      description: "Temporary role for inventory regression integration tests",
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

function expectStatus(response: { status: number }, status: number) {
  expect(response.status).toBe(status);
}

// -----------------------------------------------------------------------------
// Database fixtures
// -----------------------------------------------------------------------------

async function createWarehouse() {
  const suffix = randomUUID();

  const warehouse = await prisma.warehouse.create({
    data: {
      name: `Inventory regression warehouse ${suffix}`,
      code: `IR-WH-${suffix}`,
      address: `Inventory regression test address ${suffix}`,
      isActive: true,
    },
  });

  createdWarehouseIds.push(warehouse.id);
  return warehouse;
}

async function createVariant() {
  const suffix = randomUUID();

  const product = await prisma.product.create({
    data: {
      name: `Inventory regression product ${suffix}`,
      slug: `inventory-regression-product-${suffix}`,
      description: "Created by inventory-regression.integration.test.ts",
    },
  });

  createdProductIds.push(product.id);

  const variant = await prisma.productVariant.create({
    data: {
      productId: product.id,
      sku: `IR-FIXTURE-${suffix}`,
      title: `Inventory regression variant ${suffix}`,
      priceRial: 1250000n,
      isActive: true,
    },
  });

  createdVariantIds.push(variant.id);
  return { product, variant };
}

function operationPayload(
  variantId: string,
  warehouseId: string,
  quantity: number,
) {
  return {
    variantId,
    warehouseId,
    quantity,
    note: "Inventory regression lifecycle test",
  };
}

// -----------------------------------------------------------------------------
// Setup and cleanup
// -----------------------------------------------------------------------------

beforeAll(async () => {
  const admin = await createAdmin();
  await assignInventoryPermissions(admin.id);
  permittedAdmin = await createAuthContext(admin.id);
});

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
    if (createdSessionIds.length) {
      await prisma.adminSession.deleteMany({
        where: { id: { in: createdSessionIds.splice(0) } },
      });
    }

    if (createdAdminIds.length) {
      await prisma.adminUserRole.deleteMany({
        where: { adminUserId: { in: createdAdminIds } },
      });
      await prisma.adminUser.deleteMany({
        where: { id: { in: createdAdminIds.splice(0) } },
      });
    }

    if (createdRoleIds.length) {
      await prisma.rolePermission.deleteMany({
        where: { roleId: { in: createdRoleIds } },
      });
      await prisma.role.deleteMany({
        where: { id: { in: createdRoleIds.splice(0) } },
      });
    }
  } finally {
    await prisma.$disconnect();
  }
});

// -----------------------------------------------------------------------------
// Cross-module regression checks
// -----------------------------------------------------------------------------

describe("Inventory Regression", () => {
  it("keeps inventory balances, calculated availability and movement history consistent through a complete stock lifecycle", async () => {
    const warehouse = await createWarehouse();
    const { variant } = await createVariant();

    // 1. Receive 20 units. This operation creates the inventory row.
    const stockIn = await api(permittedAdmin).post(
      "/api/inventory/stock-in",
      operationPayload(variant.id, warehouse.id, 20),
    );

    expectStatus(stockIn, 201);
    expect(stockIn.body.data.inventory).toMatchObject({
      quantityOnHand: 20,
      quantityReserved: 0,
      quantityAvailable: 20,
    });

    // 2. Reserve 6 units. On-hand quantity must remain unchanged.
    const reserve = await api(permittedAdmin).post(
      "/api/inventory/reserve",
      operationPayload(variant.id, warehouse.id, 6),
    );

    expectStatus(reserve, 201);
    expect(reserve.body.data.inventory).toMatchObject({
      quantityOnHand: 20,
      quantityReserved: 6,
      quantityAvailable: 14,
    });

    // 3. Release 2 reserved units.
    const release = await api(permittedAdmin).post(
      "/api/inventory/release",
      operationPayload(variant.id, warehouse.id, 2),
    );

    expectStatus(release, 200);
    expect(release.body.data.inventory).toMatchObject({
      quantityOnHand: 20,
      quantityReserved: 4,
      quantityAvailable: 16,
    });

    // 4. Dispatch 5 available units.
    const stockOut = await api(permittedAdmin).post(
      "/api/inventory/stock-out",
      operationPayload(variant.id, warehouse.id, 5),
    );

    expectStatus(stockOut, 201);
    expect(stockOut.body.data.inventory).toMatchObject({
      quantityOnHand: 15,
      quantityReserved: 4,
      quantityAvailable: 11,
    });

    // 5. Correct the physical count down by one unit.
    const adjustment = await api(permittedAdmin).post(
      "/api/inventory/adjustment",
      {
        variantId: variant.id,
        warehouseId: warehouse.id,
        quantityDelta: -1,
        note: "Regression test negative stock adjustment",
      },
    );

    expectStatus(adjustment, 201);
    expect(adjustment.body.data.inventory).toMatchObject({
      quantityOnHand: 14,
      quantityReserved: 4,
      quantityAvailable: 10,
    });

    // 6. Record 3 returned units.
    const returned = await api(permittedAdmin).post(
      "/api/inventory/return",
      operationPayload(variant.id, warehouse.id, 3),
    );

    expectStatus(returned, 201);
    expect(returned.body.data.inventory).toMatchObject({
      quantityOnHand: 17,
      quantityReserved: 4,
      quantityAvailable: 13,
    });

    const inventoryId = stockIn.body.data.inventory.id;

    // Reorder-level changes must not alter physical or reserved stock.
    const reorderLevel = await api(permittedAdmin).patch(
      `/api/inventory/${inventoryId}/reorder-level`,
      { reorderLevel: 18 },
    );

    expectStatus(reorderLevel, 200);
    expect(reorderLevel.body.data).toMatchObject({
      id: inventoryId,
      quantityOnHand: 17,
      quantityReserved: 4,
      quantityAvailable: 13,
      reorderLevel: 18,
      isLowStock: true,
    });

    // Verify the inventory detail read model.
    const detail = await api(permittedAdmin).get(
      `/api/inventory/${inventoryId}`,
    );

    expectStatus(detail, 200);
    expect(detail.body.data).toMatchObject({
      id: inventoryId,
      variantId: variant.id,
      warehouseId: warehouse.id,
      quantityOnHand: 17,
      quantityReserved: 4,
      quantityAvailable: 13,
      reorderLevel: 18,
      isLowStock: true,
    });

    // Verify the variant aggregate read model.
    const variantInventory = await api(permittedAdmin).get(
      `/api/inventory/variants/${variant.id}`,
    );

    expectStatus(variantInventory, 200);
    expect(variantInventory.body.data.totals).toEqual({
      quantityOnHand: 17,
      quantityReserved: 4,
      quantityAvailable: 13,
    });

    // Verify the low-stock list filter returns the same inventory row.
    const lowStockList = await api(permittedAdmin).get(
      `/api/inventory?variantId=${variant.id}&lowStock=true`,
    );

    expectStatus(lowStockList, 200);
    expect(lowStockList.body.data).toHaveLength(1);
    expect(lowStockList.body.data[0]).toMatchObject({
      id: inventoryId,
      quantityOnHand: 17,
      quantityReserved: 4,
      quantityAvailable: 13,
      isLowStock: true,
    });

    // Verify all six operations remain represented in the movement history.
    const movementHistory = await api(permittedAdmin).get(
      `/api/inventory/movements?variantId=${variant.id}&warehouseId=${warehouse.id}&page=1&limit=20`,
    );

    expectStatus(movementHistory, 200);
    expect(movementHistory.body.pagination).toMatchObject({
      page: 1,
      limit: 20,
      total: 6,
    });

    const movements = movementHistory.body.data as Array<{
      id: string;
      movementType: string;
      quantityDelta: number;
      createdBy: string | null;
      variantId: string;
      warehouseId: string;
    }>;

    expect(movements).toHaveLength(6);
    expect(movements.map((movement) => movement.movementType).sort()).toEqual(
      [
        MovementType.STOCKIN,
        MovementType.RESERVATION,
        MovementType.RESERVATION_RELEASE,
        MovementType.STOCKOUT,
        MovementType.ADJUSTMENT,
        MovementType.RETURN,
      ].sort(),
    );

    for (const movement of movements) {
      expect(movement.variantId).toBe(variant.id);
      expect(movement.warehouseId).toBe(warehouse.id);
      expect(movement.createdBy).toBe(permittedAdmin.adminId);
    }

    // Physical-stock movements reconcile to quantityOnHand:
    // 20 - 5 - 1 + 3 = 17.
    const physicalStockDelta = movements
      .filter((movement) =>
        [
          MovementType.STOCKIN,
          MovementType.STOCKOUT,
          MovementType.ADJUSTMENT,
          MovementType.RETURN,
        ].includes(movement.movementType as never),
      )
      .reduce((sum, movement) => sum + movement.quantityDelta, 0);

    // Reservation movements reconcile separately to quantityReserved:
    // 6 - 2 = 4.
    const reservedDelta = movements
      .filter((movement) =>
        [
          MovementType.RESERVATION,
          MovementType.RESERVATION_RELEASE,
        ].includes(movement.movementType as never),
      )
      .reduce((sum, movement) => sum + movement.quantityDelta, 0);

    expect(physicalStockDelta).toBe(17);
    expect(reservedDelta).toBe(4);
    expect(physicalStockDelta - reservedDelta).toBe(13);

    // Finally, verify that each operation response points to a persisted
    // movement record, rather than merely returning an unpersisted payload.
    const movementIds = [
      stockIn.body.data.movement.id,
      reserve.body.data.movement.id,
      release.body.data.movement.id,
      stockOut.body.data.movement.id,
      adjustment.body.data.movement.id,
      returned.body.data.movement.id,
    ];

    const persistedMovements = await prisma.inventoryMovement.findMany({
      where: { id: { in: movementIds } },
    });

    expect(persistedMovements).toHaveLength(6);
  });
});
