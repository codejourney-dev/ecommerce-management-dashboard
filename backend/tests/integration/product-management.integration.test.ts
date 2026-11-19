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
      "Product API tests may run only against ecommerce_dashboard_migration_test.",
  );
}

// Import database-dependent modules only after the database safety guard.
const { prisma } = await import("../../src/config/prisma.js");
const { AdminStatus, ProductStatus } = await import(
  "../../generated/prisma/client.js"
);
const { createAccessToken, hashRefreshToken } = await import(
  "../../src/services/token.service.js"
);
const { createSessionCsrfToken } = await import(
  "../../src/services/csrf.service.js"
);
const { default: app } = await import("../../src/app.js");

// Keep these in sync with product.routes.ts and seed-permissions.ts.
const PRODUCT_PERMISSIONS = [
  "products.view",
  "products.create",
  "products.update",
  "products.delete",
] as const;

type AuthContext = {
  adminId: string;
  accessToken: string;
  csrfToken: string;
  allowedOrigin: string;
};

type AttributeInputType =
  | "TEXT"
  | "NUMBER"
  | "BOOLEAN"
  | "DATE"
  | "SELECT"
  | "MULTI_SELECT";

const createdProductIds: string[] = [];
const createdCategoryIds: string[] = [];
const createdBrandIds: string[] = [];
const createdAttributeIds: string[] = [];
const createdCategoryAttributeIds: string[] = [];
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
      email: `product-test-${suffix}@example.test`,
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
      userAgent: "vitest-product-management",
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

async function assignPermissionSetToAdmin(adminId: string) {
  const suffix = randomUUID().slice(0, 8);

  const role = await prisma.role.create({
    data: {
      name: `product-test-role-${suffix}`,
      description: "Temporary role for product integration tests",
    },
  });

  createdRoleIds.push(role.id);

  const permissions = await Promise.all(
    PRODUCT_PERMISSIONS.map((name) =>
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

async function createCategory(input: {
  name?: string;
  slug?: string;
  parentId?: string | null;
  isActive?: boolean;
} = {}) {
  const suffix = randomUUID();

  const category = await prisma.category.create({
    data: {
      name: input.name ?? `Product test category ${suffix}`,
      slug: input.slug ?? `product-test-category-${suffix}`,
      parentId: input.parentId ?? null,
      isActive: input.isActive ?? true,
    },
  });

  createdCategoryIds.push(category.id);
  return category;
}

async function createBrand(input: {
  name?: string;
  slug?: string;
  isActive?: boolean;
} = {}) {
  const suffix = randomUUID();

  const brand = await prisma.brand.create({
    data: {
      name: input.name ?? `Product test brand ${suffix}`,
      slug: input.slug ?? `product-test-brand-${suffix}`,
      isActive: input.isActive ?? true,
    },
  });

  createdBrandIds.push(brand.id);
  return brand;
}

async function createAttributeAssignment(
  categoryId: string,
  input: {
    inputType?: AttributeInputType;
    isRequired?: boolean;
    scope?: "PRODUCT" | "VARIANT";
    isActive?: boolean;
  } = {},
) {
  const suffix = randomUUID();
  const inputType = input.inputType ?? "TEXT";

  const attribute = await prisma.attribute.create({
    data: {
      name: `Product test attribute ${suffix}`,
      slug: `product-test-attribute-${suffix}`,
      inputType,
      isActive: input.isActive ?? true,
    },
  });

  createdAttributeIds.push(attribute.id);

  const assignment = await prisma.categoryAttribute.create({
    data: {
      categoryId,
      attributeId: attribute.id,
      scope: input.scope ?? "PRODUCT",
      isRequired: input.isRequired ?? false,
    },
  });

  createdCategoryAttributeIds.push(assignment.id);

  return { attribute, assignment };
}

async function createAttributeOptions(attributeId: string) {
  const suffix = randomUUID();

  return Promise.all(
    ["first", "second"].map((value, index) =>
      prisma.attributeOption.create({
        data: {
          attributeId,
          label: `Option ${index + 1}`,
          value: `${value}-${suffix}`,
          position: index,
        },
      }),
    ),
  );
}

function productPayload(
  categoryIds: string[],
  overrides: Record<string, unknown> = {},
) {
  const suffix = randomUUID();

  return {
    name: `Product integration ${suffix}`,
    slug: `product-integration-${suffix}`,
    description: "Created by product-management.integration.test.ts",
    categoryIds,
    ...overrides,
  };
}

async function createProductThroughApi(
  categoryIds: string[],
  overrides: Record<string, unknown> = {},
) {
  const payload = productPayload(categoryIds, overrides);
  const response = await api(permittedAdmin).post("/api/products", payload);

  expectStatus(response, 201);

  const productId = response.body.data?.id;
  if (typeof productId !== "string") {
    throw new Error("Product creation response did not contain data.id.");
  }

  createdProductIds.push(productId);
  return { product: response.body.data, payload, response };
}

// -----------------------------------------------------------------------------
// Setup
// -----------------------------------------------------------------------------

beforeAll(async () => {
  const admin = await createAdmin("Product Integration Admin");
  await assignPermissionSetToAdmin(admin.id);
  permittedAdmin = await createAuthContext(admin.id);

  const noPermissionAdmin = await createAdmin("Product Restricted Admin");
  restrictedAdmin = await createAuthContext(noPermissionAdmin.id);
});

// -----------------------------------------------------------------------------
// Cleanup
// -----------------------------------------------------------------------------

afterEach(async () => {
  // Hard-delete test products, including products soft-deleted by API tests.
  // Product deletion cascades product-category and product-attribute rows.
  if (createdProductIds.length) {
    await prisma.product.deleteMany({
      where: { id: { in: createdProductIds.splice(0) } },
    });
  }

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

  if (createdBrandIds.length) {
    await prisma.brand.deleteMany({
      where: { id: { in: createdBrandIds.splice(0) } },
    });
  }

  // Children are created after parents, so reverse order respects the hierarchy.
  for (const categoryId of createdCategoryIds.splice(0).reverse()) {
    await prisma.category.deleteMany({ where: { id: categoryId } });
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
// Product Management API
// -----------------------------------------------------------------------------

describe("Product Management API", () => {
  // ---------------------------------------------------------------------------
  // Authentication and authorization
  // ---------------------------------------------------------------------------

  it("rejects requests without an access token", async () => {
    const response = await request(app).get("/api/products");
    expectStatus(response, 401);
  });

  it("rejects an authenticated admin without products.view permission", async () => {
    const response = await api(restrictedAdmin).get("/api/products");
    expectStatus(response, 403);
  });

  it("rejects a mutation without a valid CSRF token", async () => {
    const category = await createCategory();

    const response = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${permittedAdmin.accessToken}`)
      .set("Origin", permittedAdmin.allowedOrigin)
      .send(productPayload([category.id]));

    expectStatus(response, 403);
  });

  // ---------------------------------------------------------------------------
  // Create product
  // ---------------------------------------------------------------------------

  it("creates a product, assigns its categories, and defaults its status to DRAFT", async () => {
    const category = await createCategory();
    const { product, payload } = await createProductThroughApi([category.id]);

    expect(product.name).toBe(payload.name);
    expect(product.slug).toBe(payload.slug);
    expect(product.status).toBe(ProductStatus.DRAFT);

    const stored = await prisma.product.findUnique({
      where: { id: product.id },
      include: { categories: true },
    });

    expect(stored).not.toBeNull();
    expect(stored?.categories.map((item) => item.categoryId)).toContain(
      category.id,
    );
  });

  it("creates a product with an active brand", async () => {
    const category = await createCategory();
    const brand = await createBrand();

    const { product } = await createProductThroughApi([category.id], {
      brandId: brand.id,
    });

    expect(product.brandId).toBe(brand.id);
  });

  it("rejects a product without at least one category", async () => {
    const response = await api(permittedAdmin).post(
      "/api/products",
      productPayload([]),
    );

    expectStatus(response, 400);
    expect(response.body.code).toBe("PRODUCT_CATEGORY_REQUIRED");
  });

  it("rejects duplicate category IDs", async () => {
    const category = await createCategory();

    const response = await api(permittedAdmin).post(
      "/api/products",
      productPayload([category.id, category.id]),
    );

    expectStatus(response, 400);
    expect(response.body.code).toBe("PRODUCT_DUPLICATE_CATEGORIES");
  });

  it("rejects an inactive category", async () => {
    const category = await createCategory({ isActive: false });

    const response = await api(permittedAdmin).post(
      "/api/products",
      productPayload([category.id]),
    );

    expectStatus(response, 409);
    expect(response.body.code).toBe("PRODUCT_CATEGORY_INACTIVE");
  });

  it("rejects an inactive brand", async () => {
    const category = await createCategory();
    const brand = await createBrand({ isActive: false });

    const response = await api(permittedAdmin).post(
      "/api/products",
      productPayload([category.id], { brandId: brand.id }),
    );

    expectStatus(response, 409);
    expect(response.body.code).toBe("PRODUCT_BRAND_INACTIVE");
  });

  it("rejects a duplicate product slug", async () => {
    const category = await createCategory();
    const { payload } = await createProductThroughApi([category.id]);

    const response = await api(permittedAdmin).post(
      "/api/products",
      productPayload([category.id], { slug: payload.slug }),
    );

    expectStatus(response, 409);
    expect(response.body.code).toBe("PRODUCT_SLUG_EXISTS");
  });

  it("requires active PRODUCT-scoped required attributes", async () => {
    const category = await createCategory();
    const { assignment } = await createAttributeAssignment(category.id, {
      inputType: "TEXT",
      isRequired: true,
      scope: "PRODUCT",
    });

    const response = await api(permittedAdmin).post(
      "/api/products",
      productPayload([category.id]),
    );

    expectStatus(response, 409);
    expect(response.body.code).toBe("PRODUCT_REQUIRED_ATTRIBUTE_MISSING");

    // Keep the assignment referenced only by its fixture and ensure the ID is valid.
    expect(assignment.id).toBeTruthy();
  });

  it("does not require VARIANT-scoped attributes during product creation", async () => {
    const category = await createCategory();
    await createAttributeAssignment(category.id, {
      inputType: "TEXT",
      isRequired: true,
      scope: "VARIANT",
    });

    const { product } = await createProductThroughApi([category.id]);
    expect(product.id).toBeTruthy();
  });

  it("inherits PRODUCT-scoped required attributes from parent categories", async () => {
    const parent = await createCategory();
    const child = await createCategory({ parentId: parent.id });
    const { assignment } = await createAttributeAssignment(parent.id, {
      inputType: "TEXT",
      isRequired: true,
    });

    const { product } = await createProductThroughApi([child.id], {
      attributeValues: [
        {
          categoryAttributeId: assignment.id,
          textValue: "Cotton",
        },
      ],
    });

    const storedValue = await prisma.productAttributeValue.findFirst({
      where: {
        productId: product.id,
        categoryAttributeId: assignment.id,
      },
    });

    expect(storedValue?.textValue).toBe("Cotton");
  });

  it("persists all supported product attribute value types", async () => {
    const category = await createCategory();

    const text = await createAttributeAssignment(category.id, {
      inputType: "TEXT",
    });
    const number = await createAttributeAssignment(category.id, {
      inputType: "NUMBER",
    });
    const boolean = await createAttributeAssignment(category.id, {
      inputType: "BOOLEAN",
    });
    const date = await createAttributeAssignment(category.id, {
      inputType: "DATE",
    });
    const select = await createAttributeAssignment(category.id, {
      inputType: "SELECT",
    });
    const multiSelect = await createAttributeAssignment(category.id, {
      inputType: "MULTI_SELECT",
    });

    const selectOptions = await createAttributeOptions(select.attribute.id);
    const multiSelectOptions = await createAttributeOptions(
      multiSelect.attribute.id,
    );
    if (selectOptions.length === 0) {
        throw new Error("Select attribute options were not created.");
    }
    const { product } = await createProductThroughApi([category.id], {
      attributeValues: [
        {
          categoryAttributeId: text.assignment.id,
          textValue: "Premium cotton",
        },
        {
          categoryAttributeId: number.assignment.id,
          numberValue: "42.5",
        },
        {
          categoryAttributeId: boolean.assignment.id,
          booleanValue: false,
        },
        {
          categoryAttributeId: date.assignment.id,
          dateValue: "2026-11-19",
        },
        {
          categoryAttributeId: select.assignment.id,
          optionId: selectOptions[0]!.id,
        },
        {
          categoryAttributeId: multiSelect.assignment.id,
          optionIds: multiSelectOptions.map((option) => option.id),
        },
      ],
    });

    const storedValues = await prisma.productAttributeValue.findMany({
      where: { productId: product.id },
      include: { selectedOptions: true },
    });

    expect(storedValues).toHaveLength(6);
    expect(
      storedValues.find(
        (item) => item.categoryAttributeId === text.assignment.id,
      )?.textValue,
    ).toBe("Premium cotton");
    expect(
      Number(
        storedValues.find(
          (item) => item.categoryAttributeId === number.assignment.id,
        )?.numberValue,
      ),
    ).toBe(42.5);
    expect(
      storedValues.find(
        (item) => item.categoryAttributeId === boolean.assignment.id,
      )?.booleanValue,
    ).toBe(false);
    expect(
      storedValues.find(
        (item) => item.categoryAttributeId === select.assignment.id,
      )?.optionId,
    ).toBe(selectOptions[0]!.id);
    expect(
      storedValues.find(
        (item) => item.categoryAttributeId === multiSelect.assignment.id,
      )?.selectedOptions,
    ).toHaveLength(2);
  });

  it("rejects a value for an attribute outside the product category scope", async () => {
    const category = await createCategory();
    const unrelatedCategory = await createCategory();
    const { assignment } = await createAttributeAssignment(
      unrelatedCategory.id,
    );

    const response = await api(permittedAdmin).post(
      "/api/products",
      productPayload([category.id], {
        attributeValues: [
          {
            categoryAttributeId: assignment.id,
            textValue: "Not allowed",
          },
        ],
      }),
    );

    expectStatus(response, 409);
    expect(response.body.code).toBe("PRODUCT_ATTRIBUTE_NOT_ASSIGNED");
  });

  // ---------------------------------------------------------------------------
  // List products
  // ---------------------------------------------------------------------------

  it("lists products with search and pagination", async () => {
    const category = await createCategory();
    const searchTerm = `unique-product-search-${randomUUID()}`;

    const first = await createProductThroughApi([category.id], {
      name: `${searchTerm} first`,
    });
    await createProductThroughApi([category.id], {
      name: `${searchTerm} second`,
    });

    const response = await api(permittedAdmin).get(
      `/api/products?search=${encodeURIComponent(searchTerm)}&page=1&limit=1`,
    );

    expectStatus(response, 200);
    expect(response.body.data.products).toHaveLength(1);
    expect(response.body.data.pagination).toMatchObject({
      page: 1,
      limit: 1,
      total: 2,
      totalPages: 2,
    });
    expect(response.body.data.products[0].id).toBeTruthy();
    expect(first.product.id).toBeTruthy();
  });

  it("filters products by category, brand, and status", async () => {
    const category = await createCategory();
    const otherCategory = await createCategory();
    const brand = await createBrand();

    const { product } = await createProductThroughApi([category.id], {
      brandId: brand.id,
      status: ProductStatus.ACTIVE,
    });
    await createProductThroughApi([otherCategory.id]);

    const response = await api(permittedAdmin).get(
      `/api/products?categoryId=${category.id}&brandId=${brand.id}&status=${ProductStatus.ACTIVE}`,
    );

    expectStatus(response, 200);
    const ids = response.body.data.products.map(
      (item: { id: string }) => item.id,
    );
    expect(ids).toContain(product.id);
    expect(ids).toHaveLength(1);
  });

  it("rejects invalid list query parameters", async () => {
    const response = await api(permittedAdmin).get(
      "/api/products?page=0&limit=abc",
    );

    expectStatus(response, 400);
  });

  // ---------------------------------------------------------------------------
  // Get product
  // ---------------------------------------------------------------------------

  it("gets a product by ID", async () => {
    const category = await createCategory();
    const { product } = await createProductThroughApi([category.id]);

    const response = await api(permittedAdmin).get(
      `/api/products/${product.id}`,
    );

    expectStatus(response, 200);
    expect(response.body.data.id).toBe(product.id);
  });

  it("returns 400 for an invalid product ID and 404 for an unknown product", async () => {
    const invalid = await api(permittedAdmin).get("/api/products/not-a-uuid");
    expectStatus(invalid, 400);
    expect(invalid.body.code).toBe("INVALID_PRODUCT_ID");

    const missing = await api(permittedAdmin).get(
      `/api/products/${randomUUID()}`,
    );
    expectStatus(missing, 404);
    expect(missing.body.code).toBe("PRODUCT_NOT_FOUND");
  });

  // ---------------------------------------------------------------------------
  // Update product
  // ---------------------------------------------------------------------------

  it("updates product fields", async () => {
    const category = await createCategory();
    const { product } = await createProductThroughApi([category.id]);
    const newName = `Updated product ${randomUUID()}`;

    const response = await api(permittedAdmin).patch(
      `/api/products/${product.id}`,
      { name: newName },
    );

    expectStatus(response, 200);

    const stored = await prisma.product.findUnique({
      where: { id: product.id },
    });
    expect(stored?.name).toBe(newName);
  });

  it("retains existing attribute values when updating unrelated product fields", async () => {
    const category = await createCategory();
    const { assignment } = await createAttributeAssignment(category.id, {
      inputType: "TEXT",
      isRequired: true,
    });
    const { product } = await createProductThroughApi([category.id], {
      attributeValues: [
        {
          categoryAttributeId: assignment.id,
          textValue: "Original value",
        },
      ],
    });

    const response = await api(permittedAdmin).patch(
      `/api/products/${product.id}`,
      { name: `Renamed ${randomUUID()}` },
    );

    expectStatus(response, 200);

    const storedValue = await prisma.productAttributeValue.findFirst({
      where: {
        productId: product.id,
        categoryAttributeId: assignment.id,
      },
    });
    expect(storedValue?.textValue).toBe("Original value");
  });

  it("rejects an update that removes a required attribute value", async () => {
    const category = await createCategory();
    const { assignment } = await createAttributeAssignment(category.id, {
      inputType: "TEXT",
      isRequired: true,
    });
    const { product } = await createProductThroughApi([category.id], {
      attributeValues: [
        {
          categoryAttributeId: assignment.id,
          textValue: "Required value",
        },
      ],
    });

    const response = await api(permittedAdmin).patch(
      `/api/products/${product.id}`,
      { attributeValues: [] },
    );

    expectStatus(response, 409);
    expect(response.body.code).toBe("PRODUCT_REQUIRED_ATTRIBUTE_MISSING");
  });

  it("rejects an update with no supported fields", async () => {
    const category = await createCategory();
    const { product } = await createProductThroughApi([category.id]);

    const response = await api(permittedAdmin).patch(
      `/api/products/${product.id}`,
      {},
    );

    expectStatus(response, 400);
  });

  // ---------------------------------------------------------------------------
  // Product status
  // ---------------------------------------------------------------------------

  it("updates product status", async () => {
    const category = await createCategory();
    const { product } = await createProductThroughApi([category.id]);

    const response = await api(permittedAdmin).patch(
      `/api/products/${product.id}/status`,
      { status: ProductStatus.ACTIVE },
    );

    expectStatus(response, 200);

    const stored = await prisma.product.findUnique({
      where: { id: product.id },
    });
    expect(stored?.status).toBe(ProductStatus.ACTIVE);
  });

  it("rejects an invalid product status", async () => {
    const category = await createCategory();
    const { product } = await createProductThroughApi([category.id]);

    const response = await api(permittedAdmin).patch(
      `/api/products/${product.id}/status`,
      { status: "PUBLISHED" },
    );

    expectStatus(response, 400);
    expect(response.body.code).toBe("INVALID_PRODUCT_STATUS");
  });

  // ---------------------------------------------------------------------------
  // Soft delete
  // ---------------------------------------------------------------------------

  it("soft-deletes a product and excludes it from normal reads", async () => {
    const category = await createCategory();
    const { product } = await createProductThroughApi([category.id]);

    const response = await api(permittedAdmin).delete(
      `/api/products/${product.id}`,
    );

    expectStatus(response, 200);

    const stored = await prisma.product.findUnique({
      where: { id: product.id },
    });
    expect(stored?.deletedAt).not.toBeNull();

    const getDeleted = await api(permittedAdmin).get(
      `/api/products/${product.id}`,
    );
    expectStatus(getDeleted, 404);

    const normalList = await api(permittedAdmin).get(
      `/api/products?search=${encodeURIComponent(product.slug)}`,
    );
    expectStatus(normalList, 200);
    expect(normalList.body.data.products).toHaveLength(0);

    const includingDeleted = await api(permittedAdmin).get(
      `/api/products?search=${encodeURIComponent(product.slug)}&includeDeleted=true`,
    );
    expectStatus(includingDeleted, 200);
    expect(includingDeleted.body.data.products).toHaveLength(1);
  });

  it("returns 404 when deleting an unknown product", async () => {
    const response = await api(permittedAdmin).delete(
      `/api/products/${randomUUID()}`,
    );

    expectStatus(response, 404);
    expect(response.body.code).toBe("PRODUCT_NOT_FOUND");
  });
});
