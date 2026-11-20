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
      "Inventory transaction tests may run only against ecommerce_dashboard_migration_test.",
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
const { transferInventory } = await import(
  "../../src/services/inventory.service.js"
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

async function createAdmin(name: string) {
  const suffix = randomUUID();

  const admin = await prisma.adminUser.create({
    data: {
      name,
      email: `inventory-transaction-${suffix}@example.test`,
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
      userAgent: "vitest-inventory-transaction",
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
  return {
    post(path: string, body?: unknown) {
      return request(app)
        .post(path)
        .set("Authorization", `Bearer ${auth.accessToken}`)
        .set("Origin", auth.allowedOrigin)
        .set("Cookie", `csrf_token=${auth.csrfToken}`)
        .set("X-CSRF-Token", auth.csrfToken)
        .send(body ?? {});
    },
  };
}

async function assignInventoryPermissions(adminId: string) {
  const suffix = randomUUID();

  const role = await prisma.role.create({
    data: {
      name: `inv-tx-${suffix.slice(0, 8)}`,
      description: "Temporary role for inventory transaction integration tests",
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

async function createWarehouse() {
  const suffix = randomUUID();

  const warehouse = await prisma.warehouse.create({
    data: {
      name: `Transaction test warehouse ${suffix}`,
      code: `TX-WH-${suffix}`,
      address: `Transaction test address ${suffix}`,
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
      name: `Transaction fixture product ${suffix}`,
      slug: `transaction-fixture-product-${suffix}`,
      description: "Created by inventory-transaction.integration.test.ts",
    },
  });

  createdProductIds.push(product.id);

  const variant = await prisma.productVariant.create({
    data: {
      productId: product.id,
      sku: `TX-FIXTURE-${suffix}`,
      title: `Transaction fixture variant ${suffix}`,
      priceRial: 1250000n,
      isActive: true,
    },
  });

  createdVariantIds.push(variant.id);
  return { product, variant };
}

async function createInventoryFixture(input: {
  quantityOnHand?: number;
  quantityReserved?: number;
} = {}) {
  const warehouse = await createWarehouse();
  const { product, variant } = await createVariant();

  const inventory = await prisma.inventory.create({
    data: {
      variantId: variant.id,
      warehouseId: warehouse.id,
      quantityOnHand: input.quantityOnHand ?? 10,
      quantityReserved: input.quantityReserved ?? 0,
      reorderLevel: 2,
    },
  });

  return { warehouse, product, variant, inventory };
}

function stockOperationPayload(
  variantId: string,
  warehouseId: string,
  quantity: number,
) {
  return {
    variantId,
    warehouseId,
    quantity,
    note: "Concurrent inventory transaction test",
  };
}

// -----------------------------------------------------------------------------
// Setup
// -----------------------------------------------------------------------------

beforeAll(async () => {
  const admin = await createAdmin("Inventory Transaction Integration Admin");
  await assignInventoryPermissions(admin.id);
  permittedAdmin = await createAuthContext(admin.id);
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
// Inventory transaction guarantees
// -----------------------------------------------------------------------------

describe("Inventory Transaction Management", () => {
  it("rolls back both warehouse balances and movement history when a transfer movement violates a foreign key", async () => {
    const sourceWarehouse = await createWarehouse();
    const destinationWarehouse = await createWarehouse();
    const { variant } = await createVariant();

    const sourceInventory = await prisma.inventory.create({
      data: {
        variantId: variant.id,
        warehouseId: sourceWarehouse.id,
        quantityOnHand: 10,
        quantityReserved: 2,
        reorderLevel: 2,
      },
    });

    // The service validates the UUID format, then PostgreSQL rejects this
    // non-existent admin FK when the first transfer movement is inserted.
    // By then both inventory rows have been updated inside the transaction.
    await expect(
      transferInventory({
        variantId: variant.id,
        sourceWarehouseId: sourceWarehouse.id,
        destinationWarehouseId: destinationWarehouse.id,
        quantity: 4,
        note: "Force a movement foreign-key failure",
        createdBy: randomUUID(),
      }),
    ).rejects.toMatchObject({
      code: "INVENTORY_RELATION_CONFLICT",
      statusCode: 409,
    });

    const sourceAfter = await prisma.inventory.findUnique({
      where: { id: sourceInventory.id },
    });

    const destinationAfter = await prisma.inventory.findUnique({
      where: {
        variantId_warehouseId: {
          variantId: variant.id,
          warehouseId: destinationWarehouse.id,
        },
      },
    });

    const movements = await prisma.inventoryMovement.findMany({
      where: {
        variantId: variant.id,
        warehouseId: {
          in: [sourceWarehouse.id, destinationWarehouse.id],
        },
      },
    });

    expect(sourceAfter).toMatchObject({
      quantityOnHand: 10,
      quantityReserved: 2,
    });
    expect(destinationAfter).toBeNull();
    expect(movements).toHaveLength(0);
  });

  it("allows only one of two concurrent operations competing for the same available stock", async () => {
    const fixture = await createInventoryFixture({
      quantityOnHand: 10,
      quantityReserved: 0,
    });

    // Both requests attempt to consume the same 6 available units:
    // one dispatches stock, the other reserves it. Both cannot succeed.
    const [stockOutResponse, reserveResponse] = await Promise.all([
      api(permittedAdmin).post(
        "/api/inventory/stock-out",
        stockOperationPayload(fixture.variant.id, fixture.warehouse.id, 6),
      ),
      api(permittedAdmin).post(
        "/api/inventory/reserve",
        stockOperationPayload(fixture.variant.id, fixture.warehouse.id, 6),
      ),
    ]);

    const responses = [stockOutResponse, reserveResponse];
    const successful = responses.filter((response) => response.status === 201);
    const rejected = responses.filter((response) => response.status === 409);

    expect(successful).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const storedInventory = await prisma.inventory.findUnique({
      where: { id: fixture.inventory.id },
    });

    const storedMovements = await prisma.inventoryMovement.findMany({
      where: {
        variantId: fixture.variant.id,
        warehouseId: fixture.warehouse.id,
      },
    });

    expect(storedInventory).not.toBeNull();
    expect(storedInventory!.quantityOnHand).toBeGreaterThanOrEqual(
      storedInventory!.quantityReserved,
    );
    expect(
      storedInventory!.quantityReserved === 6 ||
        storedInventory!.quantityReserved === 0,
    ).toBe(true);
    expect(
      storedInventory!.quantityOnHand - storedInventory!.quantityReserved,
    ).toBe(4);
    expect(
      storedInventory!.quantityOnHand === 10 ||
        storedInventory!.quantityOnHand === 4,
    ).toBe(true);

    expect(storedMovements).toHaveLength(1);

    if (stockOutResponse.status === 201) {
      expect(storedInventory!.quantityReserved).toBe(0);
      expect(storedMovements[0]).toMatchObject({
        movementType: MovementType.STOCKOUT,
        quantityDelta: -6,
      });
    } else {
      expect(reserveResponse.status).toBe(201);
      expect(storedInventory!.quantityReserved).toBe(6);
      expect(storedMovements[0]).toMatchObject({
        movementType: MovementType.RESERVATION,
        quantityDelta: 6,
      });
    }
  });

  it("does not create duplicate or partial movement records when a concurrent operation is rejected", async () => {
    const fixture = await createInventoryFixture({
      quantityOnHand: 8,
      quantityReserved: 0,
    });

    const [first, second] = await Promise.all([
      api(permittedAdmin).post(
        "/api/inventory/stock-out",
        stockOperationPayload(fixture.variant.id, fixture.warehouse.id, 5),
      ),
      api(permittedAdmin).post(
        "/api/inventory/stock-out",
        stockOperationPayload(fixture.variant.id, fixture.warehouse.id, 5),
      ),
    ]);

    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409]);

    const storedInventory = await prisma.inventory.findUnique({
      where: { id: fixture.inventory.id },
    });
    const movements = await prisma.inventoryMovement.findMany({
      where: {
        variantId: fixture.variant.id,
        warehouseId: fixture.warehouse.id,
      },
    });

    expect(storedInventory?.quantityOnHand).toBe(3);
    expect(storedInventory?.quantityReserved).toBe(0);
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      movementType: MovementType.STOCKOUT,
      quantityDelta: -5,
      createdBy: permittedAdmin.adminId,
    });
  });
});
