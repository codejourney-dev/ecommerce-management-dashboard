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
      "Inventory workflow tests may run only against ecommerce_dashboard_migration_test.",
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

// Keep these permissions aligned with product.routes.ts, variant.routes.ts,
// warehouse.routes.ts, inventory.routes.ts and inventory-movement.routes.ts.
const WORKFLOW_PERMISSIONS = [
  "products.view",
  "products.create",
  "products.update",
  "products.delete",
  "inventory.view",
  "inventory.manage",
] as const;

type AuthContext = {
  adminId: string;
  accessToken: string;
  csrfToken: string;
  allowedOrigin: string;
};

const createdCategoryIds: string[] = [];
const createdProductIds: string[] = [];
const createdVariantIds: string[] = [];
const createdWarehouseIds: string[] = [];
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
      email: `inventory-workflow-${suffix}@example.test`,
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
      userAgent: "vitest-inventory-workflow",
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
  function withAuth(
    method: "get" | "post",
    path: string,
  ) {
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
  }

  return {
    get(path: string) {
      return withAuth("get", path);
    },
    post(path: string, body?: unknown) {
      return withAuth("post", path).send(body ?? {});
    },
  };
}

async function assignWorkflowPermissions(adminId: string) {
  const suffix = randomUUID();

  const role = await prisma.role.create({
    data: {
      name: `workflow-${suffix.slice(0, 8)}`,
      description: "Temporary role for cross-module inventory workflow tests",
    },
  });

  createdRoleIds.push(role.id);

  const permissions = await Promise.all(
    WORKFLOW_PERMISSIONS.map((name) =>
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
// Minimal prerequisite fixture
// -----------------------------------------------------------------------------

async function createCategory() {
  const suffix = randomUUID();

  const category = await prisma.category.create({
    data: {
      name: `Workflow category ${suffix}`,
      slug: `workflow-category-${suffix}`,
      isActive: true,
    },
  });

  createdCategoryIds.push(category.id);
  return category;
}

async function createProductThroughApi(categoryId: string) {
  const suffix = randomUUID();

  const response = await api(permittedAdmin).post("/api/products", {
    name: `Workflow product ${suffix}`,
    slug: `workflow-product-${suffix}`,
    description: "Created by inventory-workflow.integration.test.ts",
    categoryIds: [categoryId],
  });

  expectStatus(response, 201);

  const productId = response.body.data?.id;
  if (typeof productId !== "string") {
    throw new Error("Product creation response did not contain data.id.");
  }

  createdProductIds.push(productId);
  return response.body.data as { id: string; name: string; status: string };
}

async function createVariantThroughApi(productId: string) {
  const suffix = randomUUID();

  const response = await api(permittedAdmin).post(
    `/api/products/${productId}/variants`,
    {
      sku: `WORKFLOW-${suffix}`,
      title: `Workflow variant ${suffix}`,
      priceRial: "1250000",
    },
  );

  expectStatus(response, 201);

  const variantId = response.body.data?.id;
  if (typeof variantId !== "string") {
    throw new Error("Variant creation response did not contain data.id.");
  }

  createdVariantIds.push(variantId);
  return response.body.data as {
    id: string;
    productId: string;
    sku: string;
  };
}

async function createWarehouseThroughApi() {
  const suffix = randomUUID();

  const response = await api(permittedAdmin).post("/api/warehouses", {
    name: `Workflow warehouse ${suffix}`,
    code: `WF-${suffix}`,
    address: `Workflow test address ${suffix}`,
  });

  expectStatus(response, 201);

  const warehouseId = response.body.data?.id;
  if (typeof warehouseId !== "string") {
    throw new Error("Warehouse creation response did not contain data.id.");
  }

  createdWarehouseIds.push(warehouseId);
  return response.body.data as {
    id: string;
    name: string;
    isActive: boolean;
  };
}

function stockPayload(
  variantId: string,
  warehouseId: string,
  quantity: number,
) {
  return {
    variantId,
    warehouseId,
    quantity,
    note: "Cross-module inventory workflow test",
  };
}

// -----------------------------------------------------------------------------
// Setup
// -----------------------------------------------------------------------------

beforeAll(async () => {
  const admin = await createAdmin("Inventory Workflow Integration Admin");
  await assignWorkflowPermissions(admin.id);
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

  for (const categoryId of createdCategoryIds.splice(0).reverse()) {
    await prisma.category.deleteMany({
      where: { id: categoryId },
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
// Cross-module workflows
// -----------------------------------------------------------------------------

describe("Inventory Cross-Module Workflow", () => {
  it("creates a product and variant, receives stock, and exposes consistent inventory and movement history", async () => {
    // 1. Catalog: create a category, product and variant.
    const category = await createCategory();
    const product = await createProductThroughApi(category.id);
    const variant = await createVariantThroughApi(product.id);

    expect(product.status).toBe("DRAFT");
    expect(variant.productId).toBe(product.id);

    // 2. Warehouse: create a destination warehouse.
    const warehouse = await createWarehouseThroughApi();
    expect(warehouse.isActive).toBe(true);

    // 3. Inventory: receive stock for the newly-created variant.
    const stockInResponse = await api(permittedAdmin).post(
      "/api/inventory/stock-in",
      stockPayload(variant.id, warehouse.id, 15),
    );

    expectStatus(stockInResponse, 201);
    expect(stockInResponse.body.data.inventory).toMatchObject({
      variantId: variant.id,
      warehouseId: warehouse.id,
      quantityOnHand: 15,
      quantityReserved: 0,
      quantityAvailable: 15,
    });
    expect(stockInResponse.body.data.movement).toMatchObject({
      movementType: MovementType.STOCKIN,
      quantityDelta: 15,
      createdBy: permittedAdmin.adminId,
    });

    // 4. Read models: verify that each module can see the connected records.
    const productDetails = await api(permittedAdmin).get(
      `/api/products/${product.id}`,
    );
    const warehouseDetails = await api(permittedAdmin).get(
      `/api/warehouses/${warehouse.id}`,
    );
    const inventoryDetails = await api(permittedAdmin).get(
      `/api/inventory/variants/${variant.id}`,
    );
    const movementHistory = await api(permittedAdmin).get(
      `/api/inventory-movements?variantId=${variant.id}&warehouseId=${warehouse.id}`,
    );

    expectStatus(productDetails, 200);
    expect(productDetails.body.data.id).toBe(product.id);

    expectStatus(warehouseDetails, 200);
    expect(warehouseDetails.body.data.id).toBe(warehouse.id);
    expect(warehouseDetails.body.data._count.inventory).toBe(1);
    expect(warehouseDetails.body.data._count.inventoryMovements).toBe(1);

    expectStatus(inventoryDetails, 200);
    expect(inventoryDetails.body.data.inventory[0].variantId).toBe(variant.id);
    expect(inventoryDetails.body.data.inventory).toHaveLength(1);
    expect(inventoryDetails.body.data.totals).toEqual({
      quantityOnHand: 15,
      quantityReserved: 0,
      quantityAvailable: 15,
    });

    expectStatus(movementHistory, 200);
    expect(movementHistory.body.data).toHaveLength(1);
    expect(movementHistory.body.data[0]).toMatchObject({
      variantId: variant.id,
      warehouseId: warehouse.id,
      movementType: MovementType.STOCKIN,
      quantityDelta: 15,
      createdBy: permittedAdmin.adminId,
    });

    // 5. Verify persisted foreign-key relationships, not only response payloads.
    const storedInventory = await prisma.inventory.findUnique({
      where: {
        variantId_warehouseId: {
          variantId: variant.id,
          warehouseId: warehouse.id,
        },
      },
      include: {
        productVariants: true,
        warehouses: true,
      },
    });

    expect(storedInventory?.productVariants.productId).toBe(product.id);
    expect(storedInventory?.warehouses.id).toBe(warehouse.id);
  });

  it("transfers stock between two warehouses and exposes the paired transfer movements in audit history", async () => {
    // Build a real catalog chain through the public APIs.
    const category = await createCategory();
    const product = await createProductThroughApi(category.id);
    const variant = await createVariantThroughApi(product.id);

    const sourceWarehouse = await createWarehouseThroughApi();
    const destinationWarehouse = await createWarehouseThroughApi();

    const stockInResponse = await api(permittedAdmin).post(
      "/api/inventory/stock-in",
      stockPayload(variant.id, sourceWarehouse.id, 12),
    );
    expectStatus(stockInResponse, 201);

    // Transfer uses a single operation that must update both warehouse balances
    // and create two movement records sharing one reference ID.
    const transferResponse = await api(permittedAdmin).post(
      "/api/inventory/transfer",
      {
        variantId: variant.id,
        sourceWarehouseId: sourceWarehouse.id,
        destinationWarehouseId: destinationWarehouse.id,
        quantity: 5,
        note: "Cross-module transfer workflow test",
      },
    );

    expectStatus(transferResponse, 201);

    const referenceId = transferResponse.body.data.referenceId;
    expect(referenceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    expect(transferResponse.body.data.source.inventory).toMatchObject({
      variantId: variant.id,
      warehouseId: sourceWarehouse.id,
      quantityOnHand: 7,
      quantityAvailable: 7,
    });
    expect(transferResponse.body.data.destination.inventory).toMatchObject({
      variantId: variant.id,
      warehouseId: destinationWarehouse.id,
      quantityOnHand: 5,
      quantityAvailable: 5,
    });

    const movementsResponse = await api(permittedAdmin).get(
      `/api/inventory-movements?variantId=${variant.id}&referenceType=TRANSFER&referenceId=${referenceId}&limit=10`,
    );

    expectStatus(movementsResponse, 200);
    expect(movementsResponse.body.data).toHaveLength(2);

    const sourceMovement = movementsResponse.body.data.find(
      (movement: { warehouseId: string }) =>
        movement.warehouseId === sourceWarehouse.id,
    );
    const destinationMovement = movementsResponse.body.data.find(
      (movement: { warehouseId: string }) =>
        movement.warehouseId === destinationWarehouse.id,
    );

    expect(sourceMovement).toMatchObject({
      movementType: MovementType.STOCKOUT,
      quantityDelta: -5,
      referenceType: "TRANSFER",
      referenceId,
      createdBy: permittedAdmin.adminId,
    });
    expect(destinationMovement).toMatchObject({
      movementType: MovementType.STOCKIN,
      quantityDelta: 5,
      referenceType: "TRANSFER",
      referenceId,
      createdBy: permittedAdmin.adminId,
    });

    const sourceInventory = await prisma.inventory.findUnique({
      where: {
        variantId_warehouseId: {
          variantId: variant.id,
          warehouseId: sourceWarehouse.id,
        },
      },
    });
    const destinationInventory = await prisma.inventory.findUnique({
      where: {
        variantId_warehouseId: {
          variantId: variant.id,
          warehouseId: destinationWarehouse.id,
        },
      },
    });

    expect(sourceInventory?.quantityOnHand).toBe(7);
    expect(destinationInventory?.quantityOnHand).toBe(5);
    expect(
      (sourceInventory?.quantityOnHand ?? 0) +
        (destinationInventory?.quantityOnHand ?? 0),
    ).toBe(12);
  });
});
