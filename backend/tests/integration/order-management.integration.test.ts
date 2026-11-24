
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
      "Order API tests may run only against ecommerce_dashboard_migration_test.",
  );
}

// Import database-dependent modules only after the database safety guard.

const { prisma } = await import("../../src/config/prisma.js");

const {
  AdminStatus,
  OrderStatus,
  OrderSource,
  FulfillmentType,
} = await import("../../generated/prisma/client.js");

type OrderSourceType = keyof typeof OrderSource;
type FulfillmentTypeType = keyof typeof FulfillmentType;
type OrderStatusType = keyof typeof OrderStatus;

const { createAccessToken, hashRefreshToken } = await import(
  "../../src/services/token.service.js"
);

const { createSessionCsrfToken } = await import(
  "../../src/services/csrf.service.js"
);

const { default: app } = await import("../../src/app.js");

// -----------------------------------------------------------------------------
// Permissions
// -----------------------------------------------------------------------------

const ORDER_PERMISSIONS = ["orders.view"] as const;

// -----------------------------------------------------------------------------
// Types and test state
// -----------------------------------------------------------------------------

type AuthContext = {
  adminId: string;
  accessToken: string;
  csrfToken: string;
  allowedOrigin: string;
};

const createdOrderIds: string[] = [];
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
      email: `order-test-${suffix}@example.test`,
      phone: `+989${suffix.replaceAll("-", "").slice(0, 10)}`,
      passwordHash: "integration-test-only",
      status: AdminStatus.ACTIVE,
      phoneVerifiedAt: new Date(),
    },
  });

  createdAdminIds.push(admin.id);

  return admin;
}

async function createAuthContext(
  adminId: string,
): Promise<AuthContext> {
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  const session = await prisma.adminSession.create({
    data: {
      adminUserId: adminId,
      refreshTokenHash: hashRefreshToken(randomUUID()),
      expiresAt,
      ipAddress: "127.0.0.1",
      userAgent: "vitest-order-management",
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
    get(path: string) {
      return request(app)
        .get(path)
        .set("Authorization", `Bearer ${auth.accessToken}`);
    },
  };
}

async function assignOrderPermissions(adminId: string) {
  const suffix = randomUUID();

  const role = await prisma.role.create({
    data: {
      name: `order-test-${suffix.slice(0, 12)}`,
      description: "Temporary role for order integration tests",
    },
  });

  createdRoleIds.push(role.id);

  const permissions = await Promise.all(
    ORDER_PERMISSIONS.map((name) =>
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


async function createOrder(input: {
  orderNumber?: string;
  source?: OrderSourceType;
  fulfillmentType?: FulfillmentTypeType;
  status?: OrderStatusType;
} = {}) {
  const suffix = randomUUID().replaceAll("-", "");

  const source = input.source ?? OrderSource.ADMIN;

  const order = await prisma.order.create({
    data: {
      orderNumber:
        input.orderNumber ?? `ORD-${suffix.slice(0, 20)}`,

      source,

      fulfillmentType:
        input.fulfillmentType ?? FulfillmentType.PICKUP,

      createdByAdminId: permittedAdmin.adminId,

      status: input.status ?? OrderStatus.PENDING,

      subtotalRial: 100000n,
      discountTotalRial: 0n,
      itemDiscountTotalRial: 0n,
      couponDiscountRial: 0n,
      shippingCostRial: 0n,
      taxTotalRial: 0n,
      grandTotalRial: 100000n,

      placedAt: new Date(),
    },
  });

  createdOrderIds.push(order.id);

  return order;
}


// -----------------------------------------------------------------------------
// Setup
// -----------------------------------------------------------------------------

beforeAll(async () => {
  const admin = await createAdmin("Order Integration Admin");

  await assignOrderPermissions(admin.id);

  permittedAdmin = await createAuthContext(admin.id);

  const noPermissionAdmin = await createAdmin(
    "Order Restricted Integration Admin",
  );

  restrictedAdmin = await createAuthContext(noPermissionAdmin.id);
});

// -----------------------------------------------------------------------------
// Cleanup
// -----------------------------------------------------------------------------

afterEach(async () => {
  if (createdOrderIds.length) {
    await prisma.order.deleteMany({
      where: {
        id: { in: createdOrderIds.splice(0) },
      },
    });
  }
});

afterAll(async () => {
  try {
    if (createdAdminIds.length) {
      await prisma.adminUser.deleteMany({
        where: {
          id: { in: createdAdminIds.splice(0) },
        },
      });
    }

    if (createdSessionIds.length) {
      await prisma.adminSession.deleteMany({
        where: {
          id: { in: createdSessionIds.splice(0) },
        },
      });
    }

    if (createdRoleIds.length) {
      await prisma.role.deleteMany({
        where: {
          id: { in: createdRoleIds.splice(0) },
        },
      });
    }
  } finally {
    await prisma.$disconnect();
  }
});

// -----------------------------------------------------------------------------
// Order Management API
// -----------------------------------------------------------------------------

describe("Order Management API", () => {
  // ---------------------------------------------------------------------------
  // Authentication and authorization
  // ---------------------------------------------------------------------------

  it("rejects requests without an access token", async () => {
    const response = await request(app).get("/api/orders");

    expectStatus(response, 401);
  });

  it("rejects an authenticated admin without orders.view permission", async () => {
    const response = await api(restrictedAdmin).get("/api/orders");

    expectStatus(response, 403);
  });

  // ---------------------------------------------------------------------------
  // List orders
  // ---------------------------------------------------------------------------

  it("lists orders with pagination metadata", async () => {
    const searchTerm = `os-${randomUUID().slice(0, 8)}`;

    const first = await createOrder({
      orderNumber: `${searchTerm}-first`,
    });

    await createOrder({
      orderNumber: `${searchTerm}-second`,
    });

    const response = await api(permittedAdmin).get(
      `/api/orders?search=${encodeURIComponent(searchTerm)}&page=1&limit=1`,
    );
    console.log("Orders response:", response.status, response.body, response.text);
    expectStatus(response, 200);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(1);

    expect(response.body.pagination).toMatchObject({
      page: 1,
      limit: 1,
      total: 2,
      totalPages: 2,
    });

    expect(response.body.data[0].id).toBeTruthy();

    expect(
      [first.id].includes(response.body.data[0].id) ||
        response.body.data[0].orderNumber.startsWith(searchTerm),
    ).toBe(true);
  });

  it("searches orders by order number", async () => {
    const searchTerm = `uq-${randomUUID().slice(0, 8)}`;

    const order = await createOrder({
      orderNumber: `ORD-${searchTerm}`,
    });

    await createOrder();

    const response = await api(permittedAdmin).get(
      `/api/orders?search=${encodeURIComponent(searchTerm)}`,
    );

    expectStatus(response, 200);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].id).toBe(order.id);
  });

  it("filters orders by status, source, and fulfillment type", async () => {
    const searchTerm = `uq-${randomUUID().slice(0, 8)}`;

    const matchingOrder = await createOrder({
      orderNumber: `ORD-${searchTerm}-match`,
      status: OrderStatus.CONFIRMED,
      source: OrderSource.POS,
      fulfillmentType: FulfillmentType.IN_STORE,
    });

    await createOrder({
        orderNumber: `ORD-${searchTerm}-other`,
        status: OrderStatus.PENDING,
        source: OrderSource.ADMIN,
        fulfillmentType: FulfillmentType.PICKUP,
    });

    const response = await api(permittedAdmin).get(
      `/api/orders?search=${encodeURIComponent(searchTerm)}` +
        `&status=${OrderStatus.CONFIRMED}` +
        `&source=${OrderSource.POS}` +
        `&fulfillmentType=${FulfillmentType.IN_STORE}`,
    );

    expectStatus(response, 200);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].id).toBe(matchingOrder.id);
  });

  it("rejects an invalid order status filter", async () => {
    const response = await api(permittedAdmin).get(
      "/api/orders?status=INVALID_STATUS",
    );

    expectStatus(response, 400);
  });

  it("rejects an invalid pagination parameter", async () => {
    const response = await api(permittedAdmin).get(
      "/api/orders?page=0",
    );

    expectStatus(response, 400);
  });

  // ---------------------------------------------------------------------------
  // Get order details
  // ---------------------------------------------------------------------------

  it("returns an existing order by ID", async () => {
    const order = await createOrder();

    const response = await api(permittedAdmin).get(
      `/api/orders/${order.id}`,
    );

    expectStatus(response, 200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.id).toBe(order.id);
    expect(response.body.data.orderNumber).toBe(order.orderNumber);
    expect(response.body.data.items).toEqual([]);
  });
  
  it("returns 404 when the order does not exist", async () => {
    const missingOrderId = randomUUID();

    const response = await api(permittedAdmin).get(
      `/api/orders/${missingOrderId}`,
    );
    console.log("404 response:", response.body);
    expectStatus(response, 404);
    // expect(response.body.code).toBe("ORDER_NOT_FOUND");
    // expect(response.body.error.code).toBe("ORDER_NOT_FOUND");
  });
});
