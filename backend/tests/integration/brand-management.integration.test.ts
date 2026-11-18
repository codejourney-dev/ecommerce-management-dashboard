import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

// -----------------------------------------------------------------------------
// Safety guard: this suite must never connect to the real application database.
// -----------------------------------------------------------------------------
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

const databaseName = new URL(databaseUrl).pathname.replace(/^\/+/, "");

if (databaseName !== "ecommerce_dashboard_migration_test") {
  throw new Error(
    `Unsafe integration-test database: "${databaseName}". ` +
      "These tests may run only against ecommerce_dashboard_migration_test.",
  );
}

// Import database-dependent modules only after the database guard.
const { prisma } = await import("../../src/config/prisma.js");
const { AdminStatus } = await import("../../generated/prisma/client.js");
const { createAccessToken, hashRefreshToken } = await import(
  "../../src/services/token.service.js"
);
const { createSessionCsrfToken } = await import(
  "../../src/services/csrf.service.js"
);
const { default: app } = await import("../../src/app.js");

const BRAND_PERMISSIONS = [
  "brands.view",
  "brands.create",
  "brands.update",
  "brands.delete",
] as const;

type AuthContext = {
  adminId: string;
  accessToken: string;
  csrfToken: string;
  allowedOrigin: string;
};

const createdBrandIds: string[] = [];
const createdCategoryIds: string[] = [];
const createdProductIds: string[] = [];
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
      email: `brand-test-${suffix}@example.test`,
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
      userAgent: "vitest-brand-management",
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
    put(path: string, body?: unknown) {
      return request(app)
        .put(path)
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

async function createCategory(input: {
  name?: string;
  slug?: string;
  parentId?: string | null;
} = {}) {
  const suffix = randomUUID();
  const category = await prisma.category.create({
    data: {
      name: input.name ?? `Brand test category ${suffix}`,
      slug: input.slug ?? `brand-test-category-${suffix}`,
      parentId: input.parentId ?? null,
    },
  });

  createdCategoryIds.push(category.id);
  return category;
}

async function createBrandDirect(input: {
  name?: string;
  slug?: string;
  isActive?: boolean;
} = {}) {
  const suffix = randomUUID();
  const brand = await prisma.brand.create({
    data: {
      name: input.name ?? `Brand test ${suffix}`,
      slug: input.slug ?? `brand-test-${suffix}`,
      isActive: input.isActive ?? true,
    },
  });

  createdBrandIds.push(brand.id);
  return brand;
}

async function createProductWithBrand(input: {
  brandId: string;
  categoryId: string;
}) {
  const suffix = randomUUID();

  const product = await prisma.product.create({
    data: {
      name: `Brand test product ${suffix}`,
      slug: `brand-test-product-${suffix}`,
      description: "Created by brand-management.integration.test.ts",
      brandId: input.brandId,
      categories: {
        create: {
          categoryId: input.categoryId,
        },
      },
    },
  });

  createdProductIds.push(product.id);
  return product;
}

async function assignPermissionSetToAdmin(adminId: string) {
  const suffix = randomUUID();

  const role = await prisma.role.create({
    data: {
        name: `brand-${suffix.slice(0, 8)}`,
        description: "Temporary role for brand integration tests",
    },
  });

  createdRoleIds.push(role.id);

  const permissions = await Promise.all(
    BRAND_PERMISSIONS.map((name) =>
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
  const admin = await createAdmin("Brand Integration Admin");
  await assignPermissionSetToAdmin(admin.id);
  permittedAdmin = await createAuthContext(admin.id);

  const noPermissionAdmin = await createAdmin("Brand Restricted Admin");
  restrictedAdmin = await createAuthContext(noPermissionAdmin.id);
});

afterEach(async () => {
  // Products must be removed before brands because Product.brandId is RESTRICT.
  if (createdProductIds.length) {
    await prisma.product.deleteMany({
      where: { id: { in: createdProductIds.splice(0) } },
    });
  }

  // Remove brand-category join rows before brands/categories.
  if (createdBrandIds.length) {
    await prisma.categoryBrand.deleteMany({
      where: { brandId: { in: createdBrandIds } },
    });
    await prisma.brand.deleteMany({
      where: { id: { in: createdBrandIds.splice(0) } },
    });
  }

  // Delete deepest categories first to respect the self-relation RESTRICT.
  for (const categoryId of createdCategoryIds.splice(0).reverse()) {
    await prisma.category.deleteMany({ where: { id: categoryId } });
  }
});

afterAll(async () => {
  try {
    // Admin deletion cascades sessions and admin-role joins.
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

describe("Brand Management API", () => {
  it("rejects requests without an access token", async () => {
    const response = await request(app).get("/api/brands");
    expectStatus(response, 401);
  });

  it("rejects an authenticated admin without brands.view permission", async () => {
    const response = await api(restrictedAdmin).get("/api/brands");
    expectStatus(response, 403);
  });

  it("rejects a mutation without a valid CSRF token", async () => {
    const response = await request(app)
      .post("/api/brands")
      .set("Authorization", `Bearer ${permittedAdmin.accessToken}`)
      .set("Origin", permittedAdmin.allowedOrigin)
      .send({ name: "CSRF blocked", slug: `csrf-${randomUUID()}` });

    expectStatus(response, 403);
  });

  it("creates a brand and persists it", async () => {
    const suffix = randomUUID();
    const name = `Created brand ${suffix}`;
    const slug = `created-brand-${suffix}`;

    const response = await api(permittedAdmin)
      .post("/api/brands", { name, slug });

    expectStatus(response, 201);

    const stored = await prisma.brand.findUnique({ where: { slug } });
    expect(stored).not.toBeNull();
    expect(stored?.name).toBe(name);

    if (stored) createdBrandIds.push(stored.id);
  });

  it("rejects a duplicate brand slug with 409", async () => {
    const brand = await createBrandDirect();

    const response = await api(permittedAdmin).post("/api/brands", {
      name: "Duplicate slug brand",
      slug: brand.slug,
    });

    expectStatus(response, 409);
  });

  it("lists brands with search and pagination", async () => {
    const brand = await createBrandDirect({
      name: `Searchable ${randomUUID()}`,
    });

    const response = await api(permittedAdmin).get(
      `/api/brands?search=${encodeURIComponent(brand.name)}&page=1&limit=5`,
    );

    expectStatus(response, 200);
    expect(JSON.stringify(response.body)).toContain(brand.id);
  });

  it("gets a brand by ID and returns 404 for an unknown ID", async () => {
    const brand = await createBrandDirect();

    const found = await api(permittedAdmin).get(`/api/brands/${brand.id}`);
    expectStatus(found, 200);
    expect(JSON.stringify(found.body)).toContain(brand.id);

    const missing = await api(permittedAdmin).get(`/api/brands/${randomUUID()}`);
    expectStatus(missing, 404);
  });

  it("updates brand name and slug", async () => {
    const brand = await createBrandDirect();
    const newName = `Updated ${randomUUID()}`;
    const newSlug = `updated-${randomUUID()}`;

    const response = await api(permittedAdmin).patch(`/api/brands/${brand.id}`, {
      name: newName,
      slug: newSlug,
    });

    expectStatus(response, 200);

    const stored = await prisma.brand.findUnique({ where: { id: brand.id } });
    expect(stored?.name).toBe(newName);
    expect(stored?.slug).toBe(newSlug);
  });

  it("rejects updating a brand to another brand's slug", async () => {
    const first = await createBrandDirect();
    const second = await createBrandDirect();

    const response = await api(permittedAdmin).patch(`/api/brands/${first.id}`, {
      slug: second.slug,
    });

    expectStatus(response, 409);
  });

  it("deactivates and reactivates a brand", async () => {
    const brand = await createBrandDirect();

    const deactivate = await api(permittedAdmin).patch(
      `/api/brands/${brand.id}/status`,
      { isActive: false },
    );
    expectStatus(deactivate, 200);

    let stored = await prisma.brand.findUnique({ where: { id: brand.id } });
    expect(stored?.isActive).toBe(false);

    const activate = await api(permittedAdmin).patch(
      `/api/brands/${brand.id}/status`,
      { isActive: true },
    );
    expectStatus(activate, 200);

    stored = await prisma.brand.findUnique({ where: { id: brand.id } });
    expect(stored?.isActive).toBe(true);
  });

  it("assigns a brand to a leaf category", async () => {
    const category = await createCategory();
    const brand = await createBrandDirect();

    const response = await api(permittedAdmin).put(
      `/api/brands/${brand.id}/categories`,
      { categoryIds: [category.id] },
    );

    expectStatus(response, 200);

    const assignment = await prisma.categoryBrand.findUnique({
      where: {
        categoryId_brandId: {
          categoryId: category.id,
          brandId: brand.id,
        },
      },
    });

    expect(assignment).not.toBeNull();
  });

  it("rejects assigning a brand to a parent category", async () => {
    const parent = await createCategory();
    await createCategory({ parentId: parent.id });
    const brand = await createBrandDirect();

    const response = await api(permittedAdmin).put(
      `/api/brands/${brand.id}/categories`,
      { categoryIds: [parent.id] },
    );

    expectStatus(response, 400);
  });

  it("aggregates descendant leaf-category brands for a parent category", async () => {
    const parent = await createCategory();
    const firstLeaf = await createCategory({ parentId: parent.id });
    const secondLeaf = await createCategory({ parentId: parent.id });
    const firstBrand = await createBrandDirect();
    const secondBrand = await createBrandDirect();

    await prisma.categoryBrand.createMany({
      data: [
        { categoryId: firstLeaf.id, brandId: firstBrand.id },
        { categoryId: secondLeaf.id, brandId: secondBrand.id },
      ],
    });

    const response = await api(permittedAdmin).get(
      `/api/brands/available?categoryId=${parent.id}`,
    );

    expectStatus(response, 200);
    const body = JSON.stringify(response.body);
    expect(body).toContain(firstBrand.id);
    expect(body).toContain(secondBrand.id);
  });

  it("does not return inactive brands from available brands", async () => {
    const category = await createCategory();
    const inactiveBrand = await createBrandDirect({ isActive: false });

    await prisma.categoryBrand.create({
      data: {
        categoryId: category.id,
        brandId: inactiveBrand.id,
      },
    });

    const response = await api(permittedAdmin).get(
      `/api/brands/available?categoryId=${category.id}`,
    );

    expectStatus(response, 200);
    expect(JSON.stringify(response.body)).not.toContain(inactiveBrand.id);
  });

  it("blocks deleting a brand that is used by a product", async () => {
    const category = await createCategory();
    const brand = await createBrandDirect();
    await createProductWithBrand({
      brandId: brand.id,
      categoryId: category.id,
    });

    const response = await api(permittedAdmin).delete(`/api/brands/${brand.id}`);
    expectStatus(response, 409);

    const stillExists = await prisma.brand.findUnique({
      where: { id: brand.id },
    });
    expect(stillExists).not.toBeNull();
  });

  it("deletes a brand that has no products", async () => {
    const brand = await createBrandDirect();

    const response = await api(permittedAdmin).delete(`/api/brands/${brand.id}`);
    expectStatus(response, 200);

    const stored = await prisma.brand.findUnique({
      where: { id: brand.id },
    });
    expect(stored).toBeNull();

    const index = createdBrandIds.indexOf(brand.id);
    if (index >= 0) createdBrandIds.splice(index, 1);
  });

  it("rejects category reassignment if it would orphan an existing product-brand pairing", async () => {
    const allowedCategory = await createCategory();
    const replacementCategory = await createCategory();
    const brand = await createBrandDirect();

    await prisma.categoryBrand.create({
      data: {
        categoryId: allowedCategory.id,
        brandId: brand.id,
      },
    });

    await createProductWithBrand({
      brandId: brand.id,
      categoryId: allowedCategory.id,
    });

    const response = await api(permittedAdmin).put(
      `/api/brands/${brand.id}/categories`,
      { categoryIds: [replacementCategory.id] },
    );

    expectStatus(response, 409);

    const assignment = await prisma.categoryBrand.findUnique({
      where: {
        categoryId_brandId: {
          categoryId: allowedCategory.id,
          brandId: brand.id,
        },
      },
    });
    expect(assignment).not.toBeNull();

    const replacementAssignment = await prisma.categoryBrand.findUnique({
      where: {
        categoryId_brandId: {
          categoryId: replacementCategory.id,
          brandId: brand.id,
        },
      },
    });
    expect(replacementAssignment).toBeNull();
  });

  it("rejects an invalid categoryId query", async () => {
    const response = await api(permittedAdmin).get(
      "/api/brands/available?categoryId=not-a-uuid",
    );

    expect([400, 404]).toContain(response.status);
  });
});
