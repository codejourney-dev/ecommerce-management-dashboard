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
// Safety guard: this suite must only use the dedicated migration-test database.
// -----------------------------------------------------------------------------

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

const databaseName = new URL(databaseUrl).pathname.replace(/^\/+/, "");

if (databaseName !== "ecommerce_dashboard_migration_test") {
  throw new Error(
    `Unsafe integration-test database: "${databaseName}". ` +
      "Warehouse API tests may run only against ecommerce_dashboard_migration_test.",
  );
}

// Import database-dependent modules only after the database safety guard.
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

// Keep these in sync with warehouse.routes.ts and seed-permissions.ts.
// Warehouse access is intentionally grouped under inventory permissions.
const WAREHOUSE_PERMISSIONS = [
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
const createdInventoryIds: string[] = [];
const createdMovementIds: string[] = [];
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
      email: `warehouse-test-${suffix}@example.test`,
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
      userAgent: "vitest-warehouse-management",
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
  const withAuth = (method: "get" | "post" | "patch" | "delete", path: string) => {
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
    delete(path: string) {
      return withAuth("delete", path);
    },
  };
}

async function assignPermissionSetToAdmin(adminId: string) {
  const suffix = randomUUID();

  const role = await prisma.role.create({
    data: {
      name: `wh-test-${suffix.slice(0, 8)}`,
      description: "Temporary role for warehouse integration tests",
    },
  });

  createdRoleIds.push(role.id);

  const permissions = await Promise.all(
    WAREHOUSE_PERMISSIONS.map((name) =>
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

function warehousePayload(
  overrides: Record<string, unknown> = {},
) {
  const suffix = randomUUID();

  return {
    name: `Warehouse ${suffix}`,
    code: `WH-${suffix}`,
    address: `Warehouse integration test address ${suffix}`,
    ...overrides,
  };
}

async function createWarehouseThroughApi(
  overrides: Record<string, unknown> = {},
) {
  const payload = warehousePayload(overrides);
  const response = await api(permittedAdmin).post(
    "/api/warehouses",
    payload,
  );

  expectStatus(response, 201);

  const warehouseId = response.body.data?.id;
  if (typeof warehouseId !== "string") {
    throw new Error("Warehouse creation response did not contain data.id.");
  }

  createdWarehouseIds.push(warehouseId);
  return { warehouse: response.body.data, payload, response };
}

/**
 * Creates only the minimum catalog records needed to satisfy Inventory and
 * InventoryMovement foreign keys. These fixtures are intentionally inserted
 * directly through Prisma because warehouse tests are not product/variant tests.
 */
async function createVariantFixture() {
  const suffix = randomUUID();

  const product = await prisma.product.create({
    data: {
      name: `Warehouse fixture product ${suffix}`,
      slug: `warehouse-fixture-product-${suffix}`,
      description: "Created by warehouse-management.integration.test.ts",
    },
  });

  createdProductIds.push(product.id);

  const variant = await prisma.productVariant.create({
    data: {
      productId: product.id,
      sku: `WH-FIXTURE-${suffix}`,
      title: `Warehouse fixture variant ${suffix}`,
      priceRial: 1250000n,
    },
  });

  createdVariantIds.push(variant.id);
  return { product, variant };
}

async function createInventoryFixture(warehouseId: string) {
  const { variant } = await createVariantFixture();

  const inventory = await prisma.inventory.create({
    data: {
      variantId: variant.id,
      warehouseId,
      quantityOnHand: 12,
      quantityReserved: 2,
      reorderLevel: 3,
    },
  });

  createdInventoryIds.push(inventory.id);
  return { inventory, variant };
}

async function createMovementFixture(warehouseId: string) {
  const { variant } = await createVariantFixture();

  const movement = await prisma.inventoryMovement.create({
    data: {
      variantId: variant.id,
      warehouseId,
      movementType: MovementType.STOCKIN,
      quantityDelta: 12,
      referenceType: "INTEGRATION_TEST",
      note: "Warehouse dependency integration fixture",
    },
  });

  createdMovementIds.push(movement.id);
  return { movement, variant };
}

// -----------------------------------------------------------------------------
// Setup
// -----------------------------------------------------------------------------

beforeAll(async () => {
  const admin = await createAdmin("Warehouse Integration Admin");
  await assignPermissionSetToAdmin(admin.id);
  permittedAdmin = await createAuthContext(admin.id);

  const noPermissionAdmin = await createAdmin(
    "Warehouse Restricted Integration Admin",
  );
  restrictedAdmin = await createAuthContext(noPermissionAdmin.id);
});

// -----------------------------------------------------------------------------
// Cleanup
// -----------------------------------------------------------------------------

afterEach(async () => {
  // Remove warehouse dependencies before their referenced variants.
  if (createdInventoryIds.length) {
    await prisma.inventory.deleteMany({
      where: { id: { in: createdInventoryIds.splice(0) } },
    });
  }

  if (createdMovementIds.length) {
    await prisma.inventoryMovement.deleteMany({
      where: { id: { in: createdMovementIds.splice(0) } },
    });
  }

  if (createdWarehouseIds.length) {
    await prisma.warehouse.deleteMany({
      where: { id: { in: createdWarehouseIds.splice(0) } },
    });
  }

  if (createdVariantIds.length) {
    await prisma.productVariant.deleteMany({
      where: { id: { in: createdVariantIds.splice(0) } },
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
// Warehouse Management API
// -----------------------------------------------------------------------------

describe("Warehouse Management API", () => {
  // ---------------------------------------------------------------------------
  // Authentication, authorization and CSRF
  // ---------------------------------------------------------------------------

  it("rejects requests without an access token", async () => {
    const response = await request(app).get("/api/warehouses");
    expectStatus(response, 401);
  });

  it("rejects an authenticated admin without inventory.view permission", async () => {
    const response = await api(restrictedAdmin).get("/api/warehouses");
    expectStatus(response, 403);
  });

  it("rejects an authenticated admin without inventory.manage permission", async () => {
    const response = await api(restrictedAdmin).post(
      "/api/warehouses",
      warehousePayload(),
    );

    expectStatus(response, 403);
  });

  it("rejects a mutation without a valid CSRF token", async () => {
    const response = await request(app)
      .post("/api/warehouses")
      .set("Authorization", `Bearer ${permittedAdmin.accessToken}`)
      .set("Origin", permittedAdmin.allowedOrigin)
      .send(warehousePayload());

    expectStatus(response, 403);
  });

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------

  it("creates a warehouse and defaults isActive to true", async () => {
    const { warehouse, payload } = await createWarehouseThroughApi();

    expect(warehouse).toMatchObject({
      name: payload.name,
      code: payload.code,
      address: payload.address,
      isActive: true,
      _count: {
        inventory: 0,
        inventoryMovements: 0,
      },
    });

    const stored = await prisma.warehouse.findUnique({
      where: { id: warehouse.id },
    });

    expect(stored?.isActive).toBe(true);
  });

  it("creates an inactive warehouse when isActive is false", async () => {
    const { warehouse } = await createWarehouseThroughApi({
      isActive: false,
    });

    expect(warehouse.isActive).toBe(false);
  });

  it("trims whitespace from required text fields", async () => {
    const suffix = randomUUID();
    const response = await api(permittedAdmin).post("/api/warehouses", {
      name: `  Warehouse ${suffix}  `,
      code: `  WH-${suffix}  `,
      address: `  Test address ${suffix}  `,
    });

    expectStatus(response, 201);

    const warehouseId = response.body.data?.id;
    if (typeof warehouseId !== "string") {
      throw new Error("Warehouse creation response did not contain data.id.");
    }

    createdWarehouseIds.push(warehouseId);

    expect(response.body.data.name).toBe(`Warehouse ${suffix}`);
    expect(response.body.data.code).toBe(`WH-${suffix}`);
    expect(response.body.data.address).toBe(`Test address ${suffix}`);
  });

  it("rejects missing required fields", async () => {
    const response = await api(permittedAdmin).post("/api/warehouses", {
      name: "Incomplete warehouse",
    });

    expectStatus(response, 400);
  });

  it("rejects empty required text fields", async () => {
    const response = await api(permittedAdmin).post("/api/warehouses", {
      name: "   ",
      code: "WH-EMPTY",
      address: "Test address",
    });

    expectStatus(response, 400);
    expect(response.body.code).toBe("INVALID_WAREHOUSE_NAME");
  });

  it("rejects a name longer than 150 characters", async () => {
    const response = await api(permittedAdmin).post(
      "/api/warehouses",
      warehousePayload({ name: "N".repeat(151) }),
    );

    expectStatus(response, 400);
    expect(response.body.code).toBe("INVALID_WAREHOUSE_NAME");
  });

  it("rejects a code longer than 50 characters", async () => {
    const response = await api(permittedAdmin).post(
      "/api/warehouses",
      warehousePayload({ code: "C".repeat(51) }),
    );

    expectStatus(response, 400);
    expect(response.body.code).toBe("INVALID_WAREHOUSE_CODE");
  });

  it("rejects a non-boolean isActive value", async () => {
    const response = await api(permittedAdmin).post(
      "/api/warehouses",
      warehousePayload({ isActive: "true" }),
    );

    expectStatus(response, 400);
    expect(response.body.code).toBe("INVALID_WAREHOUSE_ISACTIVE");
  });

  it("rejects a duplicate warehouse code", async () => {
    const { payload } = await createWarehouseThroughApi();

    const response = await api(permittedAdmin).post(
      "/api/warehouses",
      warehousePayload({ code: payload.code }),
    );

    expectStatus(response, 409);
    expect(response.body.code).toBe("WAREHOUSE_CODE_EXISTS");
  });

  // ---------------------------------------------------------------------------
  // List, search, filters and pagination
  // ---------------------------------------------------------------------------

  it("lists warehouses with pagination metadata", async () => {
    await createWarehouseThroughApi();
    await createWarehouseThroughApi();

    const response = await api(permittedAdmin).get(
      "/api/warehouses?page=1&limit=1",
    );

    expectStatus(response, 200);
    expect(response.body.data.warehouses).toHaveLength(1);
    expect(response.body.data.pagination).toMatchObject({
      page: 1,
      limit: 1,
    });
    expect(response.body.data.pagination.total).toBeGreaterThanOrEqual(2);
  });

  it("searches warehouses by name, code or address", async () => {
    const suffix = randomUUID();
    const { warehouse } = await createWarehouseThroughApi({
      name: `Searchable ${suffix}`,
      code: `SEARCH-${suffix}`,
      address: `Unique address ${suffix}`,
    });

    const byName = await api(permittedAdmin).get(
      `/api/warehouses?search=${encodeURIComponent(`Searchable ${suffix}`)}`,
    );
    const byCode = await api(permittedAdmin).get(
      `/api/warehouses?search=${encodeURIComponent(`SEARCH-${suffix}`)}`,
    );
    const byAddress = await api(permittedAdmin).get(
      `/api/warehouses?search=${encodeURIComponent(`Unique address ${suffix}`)}`,
    );

    expectStatus(byName, 200);
    expectStatus(byCode, 200);
    expectStatus(byAddress, 200);

    expect(byName.body.data.warehouses.map((item: { id: string }) => item.id))
      .toContain(warehouse.id);
    expect(byCode.body.data.warehouses.map((item: { id: string }) => item.id))
      .toContain(warehouse.id);
    expect(
      byAddress.body.data.warehouses.map((item: { id: string }) => item.id),
    ).toContain(warehouse.id);
  });

  it("filters warehouses by active status", async () => {
    const active = await createWarehouseThroughApi({ isActive: true });
    const inactive = await createWarehouseThroughApi({ isActive: false });

    const response = await api(permittedAdmin).get(
      "/api/warehouses?isActive=false",
    );

    expectStatus(response, 200);
    const ids = response.body.data.warehouses.map(
      (item: { id: string }) => item.id,
    );

    expect(ids).toContain(inactive.warehouse.id);
    expect(ids).not.toContain(active.warehouse.id);
  });

  it("rejects an invalid isActive query value", async () => {
    const response = await api(permittedAdmin).get(
      "/api/warehouses?isActive=not-a-boolean",
    );

    expectStatus(response, 400);
  });

  it("rejects invalid pagination query values", async () => {
    const response = await api(permittedAdmin).get(
      "/api/warehouses?page=0&limit=abc",
    );

    expectStatus(response, 400);
  });

  // ---------------------------------------------------------------------------
  // Get details
  // ---------------------------------------------------------------------------

  it("returns warehouse details including inventory counts", async () => {
    const { warehouse } = await createWarehouseThroughApi();

    const response = await api(permittedAdmin).get(
      `/api/warehouses/${warehouse.id}`,
    );

    expectStatus(response, 200);
    expect(response.body.data).toMatchObject({
      id: warehouse.id,
      name: warehouse.name,
      code: warehouse.code,
      _count: {
        inventory: 0,
        inventoryMovements: 0,
      },
    });
  });

  it("returns 404 for a warehouse that does not exist", async () => {
    const response = await api(permittedAdmin).get(
      `/api/warehouses/${randomUUID()}`,
    );

    expectStatus(response, 404);
    expect(response.body.code).toBe("WAREHOUSE_NOT_FOUND");
  });

  it("rejects an invalid warehouse ID", async () => {
    const response = await api(permittedAdmin).get(
      "/api/warehouses/not-a-uuid",
    );

    expectStatus(response, 400);
  });

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  it("updates warehouse name, code and address", async () => {
    const { warehouse } = await createWarehouseThroughApi();
    const suffix = randomUUID();

    const response = await api(permittedAdmin).patch(
      `/api/warehouses/${warehouse.id}`,
      {
        name: `Updated warehouse ${suffix}`,
        code: `UPDATED-${suffix}`,
        address: `Updated address ${suffix}`,
      },
    );

    expectStatus(response, 200);
    expect(response.body.data).toMatchObject({
      id: warehouse.id,
      name: `Updated warehouse ${suffix}`,
      code: `UPDATED-${suffix}`,
      address: `Updated address ${suffix}`,
    });

    const stored = await prisma.warehouse.findUnique({
      where: { id: warehouse.id },
    });

    expect(stored?.name).toBe(`Updated warehouse ${suffix}`);
  });

  it("rejects an empty warehouse update", async () => {
    const { warehouse } = await createWarehouseThroughApi();

    const response = await api(permittedAdmin).patch(
      `/api/warehouses/${warehouse.id}`,
      {},
    );

    expectStatus(response, 400);
    expect(response.body.code).toBe("WAREHOUSE_EMPTY_UPDATE");
  });

  it("rejects an update with an empty field", async () => {
    const { warehouse } = await createWarehouseThroughApi();

    const response = await api(permittedAdmin).patch(
      `/api/warehouses/${warehouse.id}`,
      { name: "   " },
    );

    expectStatus(response, 400);
    expect(response.body.code).toBe("INVALID_WAREHOUSE_NAME");
  });

  it("rejects an update that uses another warehouse's code", async () => {
    const first = await createWarehouseThroughApi();
    const second = await createWarehouseThroughApi();

    const response = await api(permittedAdmin).patch(
      `/api/warehouses/${second.warehouse.id}`,
      { code: first.payload.code },
    );

    expectStatus(response, 409);
    expect(response.body.code).toBe("WAREHOUSE_CODE_EXISTS");
  });

  it("returns 404 when updating a missing warehouse", async () => {
    const response = await api(permittedAdmin).patch(
      `/api/warehouses/${randomUUID()}`,
      { name: "Updated name" },
    );

    expectStatus(response, 404);
    expect(response.body.code).toBe("WAREHOUSE_NOT_FOUND");
  });

  // ---------------------------------------------------------------------------
  // Active status
  // ---------------------------------------------------------------------------

  it("activates and deactivates a warehouse", async () => {
    const { warehouse } = await createWarehouseThroughApi({
      isActive: true,
    });

    const deactivate = await api(permittedAdmin).patch(
      `/api/warehouses/${warehouse.id}/status`,
      { isActive: false },
    );

    expectStatus(deactivate, 200);
    expect(deactivate.body.data.isActive).toBe(false);

    const activate = await api(permittedAdmin).patch(
      `/api/warehouses/${warehouse.id}/status`,
      { isActive: true },
    );

    expectStatus(activate, 200);
    expect(activate.body.data.isActive).toBe(true);
  });

  it("rejects an invalid warehouse status", async () => {
    const { warehouse } = await createWarehouseThroughApi();

    const response = await api(permittedAdmin).patch(
      `/api/warehouses/${warehouse.id}/status`,
      { isActive: "false" },
    );

    expectStatus(response, 400);
    expect(response.body.code).toBe("INVALID_WAREHOUSE_STATUS");
  });

  it("returns 404 when changing the status of a missing warehouse", async () => {
    const response = await api(permittedAdmin).patch(
      `/api/warehouses/${randomUUID()}/status`,
      { isActive: false },
    );

    expectStatus(response, 404);
    expect(response.body.code).toBe("WAREHOUSE_NOT_FOUND");
  });

  // ---------------------------------------------------------------------------
  // Delete and dependency protection
  // ---------------------------------------------------------------------------

  it("permanently deletes a warehouse with no dependencies", async () => {
    const { warehouse } = await createWarehouseThroughApi();

    const response = await api(permittedAdmin).delete(
      `/api/warehouses/${warehouse.id}`,
    );

    expectStatus(response, 200);
    expect(response.body.data).toMatchObject({
      id: warehouse.id,
      name: warehouse.name,
      code: warehouse.code,
    });

    const stored = await prisma.warehouse.findUnique({
      where: { id: warehouse.id },
    });

    expect(stored).toBeNull();

    // The API already removed this record; do not attempt cleanup again.
    const index = createdWarehouseIds.indexOf(warehouse.id);
    if (index >= 0) {
      createdWarehouseIds.splice(index, 1);
    }
  });

  it("prevents deleting a warehouse that has inventory records", async () => {
    const { warehouse } = await createWarehouseThroughApi();
    await createInventoryFixture(warehouse.id);

    const response = await api(permittedAdmin).delete(
      `/api/warehouses/${warehouse.id}`,
    );

    expectStatus(response, 409);
    expect(response.body.code).toBe("WAREHOUSE_HAS_DEPENDENCIES");

    const stored = await prisma.warehouse.findUnique({
      where: { id: warehouse.id },
    });

    expect(stored).not.toBeNull();
    expect(stored?.isActive).toBe(true);
  });

  it("prevents deleting a warehouse that has inventory movement history", async () => {
    const { warehouse } = await createWarehouseThroughApi();
    await createMovementFixture(warehouse.id);

    const response = await api(permittedAdmin).delete(
      `/api/warehouses/${warehouse.id}`,
    );

    expectStatus(response, 409);
    expect(response.body.code).toBe("WAREHOUSE_HAS_DEPENDENCIES");

    const stored = await prisma.warehouse.findUnique({
      where: { id: warehouse.id },
    });

    expect(stored).not.toBeNull();
  });

  it("returns 404 when deleting a missing warehouse", async () => {
    const response = await api(permittedAdmin).delete(
      `/api/warehouses/${randomUUID()}`,
    );

    expectStatus(response, 404);
    expect(response.body.code).toBe("WAREHOUSE_NOT_FOUND");
  });
});
