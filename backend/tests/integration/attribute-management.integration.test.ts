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
      "Attribute API tests may run only against ecommerce_dashboard_migration_test.",
  );
}

// Import database-dependent modules only after the database safety guard.
const { prisma } = await import("../../src/config/prisma.js");
const { AdminStatus } = await import("../../generated/prisma/client.js");
const { createAccessToken, hashRefreshToken } = await import(
  "../../src/services/token.service.js"
);
const { createSessionCsrfToken } = await import(
  "../../src/services/csrf.service.js"
);
const { default: app } = await import("../../src/app.js");

const ATTRIBUTE_PERMISSIONS = [
  "attributes.view",
  "attributes.create",
  "attributes.update",
  "attributes.delete",
] as const;

type AuthContext = {
  adminId: string;
  accessToken: string;
  csrfToken: string;
  allowedOrigin: string;
};

const createdAttributeIds: string[] = [];
const createdCategoryIds: string[] = [];
const createdCategoryAttributeIds: string[] = [];
const createdAdminIds: string[] = [];
const createdRoleIds: string[] = [];
const createdSessionIds: string[] = [];

let permittedAdmin: AuthContext;
let restrictedAdmin: AuthContext;

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
      email: `attribute-test-${suffix}@example.test`,
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
      userAgent: "vitest-attribute-management",
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
    post(path: string, body?: unknown) {
      return request(app)
        .post(path)
        .set("Authorization", `Bearer ${auth.accessToken}`)
        .set("Origin", auth.allowedOrigin)
        .set("Cookie", `csrf_token=${auth.csrfToken}`)
        .set("X-CSRF-Token", auth.csrfToken)
        .send(body ?? {});
    },
    patch(path: string, body?: unknown) {
      return request(app)
        .patch(path)
        .set("Authorization", `Bearer ${auth.accessToken}`)
        .set("Origin", auth.allowedOrigin)
        .set("Cookie", `csrf_token=${auth.csrfToken}`)
        .set("X-CSRF-Token", auth.csrfToken)
        .send(body ?? {});
    },
    delete(path: string) {
      return request(app)
        .delete(path)
        .set("Authorization", `Bearer ${auth.accessToken}`)
        .set("Origin", auth.allowedOrigin)
        .set("Cookie", `csrf_token=${auth.csrfToken}`)
        .set("X-CSRF-Token", auth.csrfToken);
    },
  };
}

async function createAttributeDirect(input: {
  name?: string;
  slug?: string;
  inputType?: "TEXT" | "NUMBER" | "SELECT" | "MULTI_SELECT" | "BOOLEAN" | "DATE";
  isActive?: boolean;
} = {}) {
  const suffix = randomUUID();

  const attribute = await prisma.attribute.create({
    data: {
      name: input.name ?? `Attribute test ${suffix}`,
      slug: input.slug ?? `attribute-test-${suffix}`,
      inputType: input.inputType ?? "TEXT",
      isActive: input.isActive ?? true,
    },
  });

  createdAttributeIds.push(attribute.id);
  return attribute;
}

async function createCategoryDirect() {
  const suffix = randomUUID();

  const category = await prisma.category.create({
    data: {
      name: `Attribute test category ${suffix}`,
      slug: `attribute-test-category-${suffix}`,
    },
  });

  createdCategoryIds.push(category.id);
  return category;
}

async function assignPermissionSetToAdmin(adminId: string) {
  const suffix = randomUUID();

  const role = await prisma.role.create({
    data: {
      name: `attr-test-${suffix.slice(0, 8)}`,
      description: "Temporary role for attribute integration tests",
    },
  });

  createdRoleIds.push(role.id);

  const permissions = await Promise.all(
    ATTRIBUTE_PERMISSIONS.map((name) =>
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

beforeAll(async () => {
  const admin = await createAdmin("Attribute Integration Admin");
  await assignPermissionSetToAdmin(admin.id);
  permittedAdmin = await createAuthContext(admin.id);

  const noPermissionAdmin = await createAdmin("Attribute Restricted Admin");
  restrictedAdmin = await createAuthContext(noPermissionAdmin.id);
});

afterEach(async () => {
  // Remove category-attribute joins before deleting their attributes/categories.
  if (createdCategoryAttributeIds.length) {
    await prisma.categoryAttribute.deleteMany({
      where: { id: { in: createdCategoryAttributeIds.splice(0) } },
    });
  }

  if (createdAttributeIds.length) {
    await prisma.attribute.deleteMany({
      where: { id: { in: createdAttributeIds.splice(0) } },
    });
  }

  if (createdCategoryIds.length) {
    await prisma.category.deleteMany({
      where: { id: { in: createdCategoryIds.splice(0) } },
    });
  }
});

afterAll(async () => {
  try {
    // Admin deletion cascades its sessions and role assignments.
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

describe("Attribute Management API", () => {
  it("rejects requests without an access token", async () => {
    const response = await request(app).get("/api/attributes");
    expectStatus(response, 401);
  });

  it("rejects an authenticated admin without attributes.view permission", async () => {
    const response = await api(restrictedAdmin).get("/api/attributes");
    expectStatus(response, 403);
  });

  it("rejects a mutation without a valid CSRF token", async () => {
    const response = await request(app)
      .post("/api/attributes")
      .set("Authorization", `Bearer ${permittedAdmin.accessToken}`)
      .set("Origin", permittedAdmin.allowedOrigin)
      .send({
        name: "CSRF blocked attribute",
        slug: `csrf-blocked-${randomUUID()}`,
        inputType: "TEXT",
      });

    expectStatus(response, 403);
  });

  it("creates an attribute and persists it", async () => {
    const suffix = randomUUID();
    const name = `Created attribute ${suffix}`;
    const slug = `created-attribute-${suffix}`;

    const response = await api(permittedAdmin).post("/api/attributes", {
      name,
      slug,
      inputType: "TEXT",
      isActive: true,
    });

    expectStatus(response, 201);

    const stored = await prisma.attribute.findUnique({ where: { slug } });
    expect(stored).not.toBeNull();
    expect(stored?.name).toBe(name);
    expect(stored?.inputType).toBe("TEXT");
    expect(stored?.isActive).toBe(true);

    if (stored) createdAttributeIds.push(stored.id);
  });

  it("rejects creating an attribute with a duplicate slug", async () => {
    const existing = await createAttributeDirect();

    const response = await api(permittedAdmin).post("/api/attributes", {
      name: "Duplicate slug attribute",
      slug: existing.slug,
      inputType: "TEXT",
    });

    expectStatus(response, 409);
  });

  it("rejects an unsupported inputType", async () => {
    const response = await api(permittedAdmin).post("/api/attributes", {
      name: "Invalid input type",
      slug: `invalid-input-${randomUUID()}`,
      inputType: "UNSUPPORTED",
    });

    expectStatus(response, 400);
  });

  it("lists attributes with search and pagination", async () => {
    const attribute = await createAttributeDirect({
      name: `Searchable attribute ${randomUUID()}`,
    });

    const response = await api(permittedAdmin).get(
      `/api/attributes?search=${encodeURIComponent(attribute.name)}&page=1&limit=5`,
    );

    expectStatus(response, 200);
    expect(JSON.stringify(response.body)).toContain(attribute.id);
    expect(response.body.data.pagination.page).toBe(1);
    expect(response.body.data.pagination.limit).toBe(5);
  });

  it("filters attributes by inputType and active status", async () => {
    const activeNumber = await createAttributeDirect({
      inputType: "NUMBER",
      isActive: true,
    });
    const inactiveNumber = await createAttributeDirect({
      inputType: "NUMBER",
      isActive: false,
    });

    const response = await api(permittedAdmin).get(
      "/api/attributes?inputType=NUMBER&isActive=false",
    );

    expectStatus(response, 200);
    const returned = JSON.stringify(response.body);
    expect(returned).toContain(inactiveNumber.id);
    expect(returned).not.toContain(activeNumber.id);
  });

  it("gets an attribute by ID and returns 404 for an unknown ID", async () => {
    const attribute = await createAttributeDirect();

    const found = await api(permittedAdmin).get(
      `/api/attributes/${attribute.id}`,
    );
    expectStatus(found, 200);
    expect(JSON.stringify(found.body)).toContain(attribute.id);

    const missing = await api(permittedAdmin).get(
      `/api/attributes/${randomUUID()}`,
    );
    expectStatus(missing, 404);
  });

  it("updates an attribute name and slug", async () => {
    const attribute = await createAttributeDirect();
    const newName = `Updated attribute ${randomUUID()}`;
    const newSlug = `updated-attribute-${randomUUID()}`;

    const response = await api(permittedAdmin).patch(
      `/api/attributes/${attribute.id}`,
      {
        name: newName,
        slug: newSlug,
      },
    );

    expectStatus(response, 200);

    const stored = await prisma.attribute.findUnique({
      where: { id: attribute.id },
    });
    expect(stored?.name).toBe(newName);
    expect(stored?.slug).toBe(newSlug);
  });

  it("rejects updating an attribute to another attribute's slug", async () => {
    const first = await createAttributeDirect();
    const second = await createAttributeDirect();

    const response = await api(permittedAdmin).patch(
      `/api/attributes/${first.id}`,
      { slug: second.slug },
    );

    expectStatus(response, 409);
  });

  it("allows changing inputType before category assignment", async () => {
    const attribute = await createAttributeDirect({ inputType: "TEXT" });

    const response = await api(permittedAdmin).patch(
      `/api/attributes/${attribute.id}`,
      { inputType: "NUMBER" },
    );

    expectStatus(response, 200);

    const stored = await prisma.attribute.findUnique({
      where: { id: attribute.id },
    });
    expect(stored?.inputType).toBe("NUMBER");
  });

  it("blocks changing inputType after category assignment", async () => {
    const attribute = await createAttributeDirect({ inputType: "TEXT" });
    const category = await createCategoryDirect();

    const assignment = await prisma.categoryAttribute.create({
      data: {
        categoryId: category.id,
        attributeId: attribute.id,
        scope: "PRODUCT",
        isRequired: false,
      },
    });

    createdCategoryAttributeIds.push(assignment.id);

    const response = await api(permittedAdmin).patch(
      `/api/attributes/${attribute.id}`,
      { inputType: "NUMBER" },
    );

    expectStatus(response, 409);

    const stored = await prisma.attribute.findUnique({
      where: { id: attribute.id },
    });
    expect(stored?.inputType).toBe("TEXT");
  });

  it("deactivates and reactivates an attribute", async () => {
    const attribute = await createAttributeDirect({ isActive: true });

    const deactivate = await api(permittedAdmin).patch(
      `/api/attributes/${attribute.id}/status`,
      { isActive: false },
    );
    expectStatus(deactivate, 200);

    let stored = await prisma.attribute.findUnique({
      where: { id: attribute.id },
    });
    expect(stored?.isActive).toBe(false);

    const activate = await api(permittedAdmin).patch(
      `/api/attributes/${attribute.id}/status`,
      { isActive: true },
    );
    expectStatus(activate, 200);

    stored = await prisma.attribute.findUnique({
      where: { id: attribute.id },
    });
    expect(stored?.isActive).toBe(true);
  });

  it("blocks deleting an attribute assigned to a category", async () => {
    const attribute = await createAttributeDirect();
    const category = await createCategoryDirect();

    const assignment = await prisma.categoryAttribute.create({
      data: {
        categoryId: category.id,
        attributeId: attribute.id,
        scope: "PRODUCT",
        isRequired: false,
      },
    });

    createdCategoryAttributeIds.push(assignment.id);

    const response = await api(permittedAdmin).delete(
      `/api/attributes/${attribute.id}`,
    );

    expectStatus(response, 409);

    const stillExists = await prisma.attribute.findUnique({
      where: { id: attribute.id },
    });
    expect(stillExists).not.toBeNull();
  });

  it("deletes an attribute that has no category assignments", async () => {
    const attribute = await createAttributeDirect();

    const response = await api(permittedAdmin).delete(
      `/api/attributes/${attribute.id}`,
    );

    expectStatus(response, 200);

    const stored = await prisma.attribute.findUnique({
      where: { id: attribute.id },
    });
    expect(stored).toBeNull();

    const index = createdAttributeIds.indexOf(attribute.id);
    if (index >= 0) createdAttributeIds.splice(index, 1);
  });

  it("returns 404 when updating the status of an unknown attribute", async () => {
    const response = await api(permittedAdmin).patch(
      `/api/attributes/${randomUUID()}/status`,
      { isActive: false },
    );

    expectStatus(response, 404);
  });
});
