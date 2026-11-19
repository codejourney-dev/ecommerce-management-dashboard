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
      "Variant API tests may run only against ecommerce_dashboard_migration_test.",
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

// Keep these in sync with variant.routes.ts and seed-permissions.ts.
// Variant endpoints reuse the existing product permissions.
const VARIANT_PERMISSIONS = [
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

const createdVariantIds: string[] = [];
const createdProductIds: string[] = [];
const createdCategoryIds: string[] = [];
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
      email: `variant-test-${suffix}@example.test`,
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
      userAgent: "vitest-variant-management",
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
  const suffix = randomUUID();

  const role = await prisma.role.create({
    data: {
      // Keep the role name under the schema's VARCHAR limit.
      name: `variant-test-${suffix.slice(0, 8)}`,
      description: "Temporary role for variant integration tests",
    },
  });

  createdRoleIds.push(role.id);

  const permissions = await Promise.all(
    VARIANT_PERMISSIONS.map((name) =>
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
      name: input.name ?? `Variant test category ${suffix}`,
      slug: input.slug ?? `variant-test-category-${suffix}`,
      parentId: input.parentId ?? null,
      isActive: input.isActive ?? true,
    },
  });

  createdCategoryIds.push(category.id);
  return category;
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
      name: `Variant test attribute ${suffix}`,
      slug: `variant-test-attribute-${suffix}`,
      inputType,
      isActive: input.isActive ?? true,
    },
  });

  createdAttributeIds.push(attribute.id);

  const assignment = await prisma.categoryAttribute.create({
    data: {
      categoryId,
      attributeId: attribute.id,
      scope: input.scope ?? "VARIANT",
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
    name: `Variant test product ${suffix}`,
    slug: `variant-test-product-${suffix}`,
    description: "Created by variant-management.integration.test.ts",
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

// Used only to exercise the service's defensive check for legacy or manually
// inserted products that have no category links. The public Product API rejects
// this state, so the fixture is created directly in the test database.
async function createProductWithoutCategory() {
  const suffix = randomUUID();
  const product = await prisma.product.create({
    data: {
      name: `Category-less variant test ${suffix}`,
      slug: `category-less-variant-test-${suffix}`,
      description: "Test fixture without ProductCategory rows",
    },
  });

  createdProductIds.push(product.id);
  return product;
}

function variantPath(productId: string, variantId?: string) {
  const base = `/api/products/${productId}/variants`;
  return variantId ? `${base}/${variantId}` : base;
}

function variantPayload(overrides: Record<string, unknown> = {}) {
  const suffix = randomUUID();

  return {
    sku: `VAR-${suffix}`,
    title: `Variant ${suffix}`,
    priceRial: "1250000",
    compareAtPriceRial: "1500000",
    costPriceRial: "800000",
    barcode: `BC-${suffix}`,
    ...overrides,
  };
}

async function createVariantThroughApi(
  productId: string,
  overrides: Record<string, unknown> = {},
) {
  const payload = variantPayload(overrides);
  const response = await api(permittedAdmin).post(
    variantPath(productId),
    payload,
  );

  expectStatus(response, 201);

  const variantId = response.body.data?.id;
  if (typeof variantId !== "string") {
    throw new Error("Variant creation response did not contain data.id.");
  }

  createdVariantIds.push(variantId);
  return { variant: response.body.data, payload, response };
}

// -----------------------------------------------------------------------------
// Setup
// -----------------------------------------------------------------------------

beforeAll(async () => {
  const admin = await createAdmin("Variant Integration Admin");
  await assignPermissionSetToAdmin(admin.id);
  permittedAdmin = await createAuthContext(admin.id);

  const noPermissionAdmin = await createAdmin("Variant Restricted Admin");
  restrictedAdmin = await createAuthContext(noPermissionAdmin.id);
});

// -----------------------------------------------------------------------------
// Cleanup
// -----------------------------------------------------------------------------

afterEach(async () => {
  // ProductVariant has no soft-delete column. Delete test variants before products.
  // The productId fallback also cleans up a variant if an API response failed
  // after the database insert (for example, during JSON serialization).
  const productIds = createdProductIds.splice(0);

  if (createdVariantIds.length) {
    await prisma.productVariant.deleteMany({
      where: { id: { in: createdVariantIds.splice(0) } },
    });
  }

  if (productIds.length) {
    await prisma.productVariant.deleteMany({
      where: { productId: { in: productIds } },
    });

    await prisma.product.deleteMany({
      where: { id: { in: productIds } },
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
// Variant Management API
// -----------------------------------------------------------------------------

describe("Variant Management API", () => {
  // ---------------------------------------------------------------------------
  // Authentication and authorization
  // ---------------------------------------------------------------------------

  it("rejects requests without an access token", async () => {
    const response = await request(app).get(
      `/api/products/${randomUUID()}/variants`,
    );
    expectStatus(response, 401);
  });

  it("rejects an authenticated admin without products.view permission", async () => {
    const response = await api(restrictedAdmin).get(
      `/api/products/${randomUUID()}/variants`,
    );
    expectStatus(response, 403);
  });

  it("rejects a mutation without a valid CSRF token", async () => {
    const category = await createCategory();
    const { product } = await createProductThroughApi([category.id]);

    const response = await request(app)
      .post(variantPath(product.id))
      .set("Authorization", `Bearer ${permittedAdmin.accessToken}`)
      .set("Origin", permittedAdmin.allowedOrigin)
      .send(variantPayload());

    expectStatus(response, 403);
  });

  // ---------------------------------------------------------------------------
  // Create variant
  // ---------------------------------------------------------------------------

  it("creates a variant with Rial prices and default active status", async () => {
    const category = await createCategory();
    const { product } = await createProductThroughApi([category.id]);
    const { variant, payload } = await createVariantThroughApi(product.id);

    expect(variant.productId).toBe(product.id);
    expect(variant.sku).toBe(payload.sku);
    expect(variant.title).toBe(payload.title);
    expect(String(variant.priceRial)).toBe(payload.priceRial);
    expect(String(variant.compareAtPriceRial)).toBe(payload.compareAtPriceRial);
    expect(String(variant.costPriceRial)).toBe(payload.costPriceRial);
    expect(variant.isActive).toBe(true);

    const stored = await prisma.productVariant.findUnique({
      where: { id: variant.id },
    });

    expect(stored).not.toBeNull();
    expect(stored?.priceRial).toBe(1250000n);
    expect(stored?.compareAtPriceRial).toBe(1500000n);
    expect(stored?.costPriceRial).toBe(800000n);
  });

  it("creates a variant with nullable comparison price, cost price, and barcode", async () => {
    const category = await createCategory();
    const { product } = await createProductThroughApi([category.id]);

    const { variant } = await createVariantThroughApi(product.id, {
      compareAtPriceRial: null,
      costPriceRial: null,
      barcode: null,
    });

    expect(variant.compareAtPriceRial).toBeNull();
    expect(variant.costPriceRial).toBeNull();
    expect(variant.barcode).toBeNull();
  });

  it("rejects a legacy product that has no category links", async () => {
    const product = await createProductWithoutCategory();

    const response = await api(permittedAdmin).post(
      variantPath(product.id),
      variantPayload(),
    );

    expectStatus(response, 409);
    expect(response.body.code).toBe("VARIANT_PRODUCT_CATEGORY_REQUIRED");
  });

  it("rejects a zero or invalid variant price", async () => {
    const category = await createCategory();
    const { product } = await createProductThroughApi([category.id]);

    const zero = await api(permittedAdmin).post(
      variantPath(product.id),
      variantPayload({ priceRial: "0" }),
    );
    expectStatus(zero, 400);
    expect(zero.body.code).toBe("INVALID_VARIANT_PRICERIAL");

    const decimal = await api(permittedAdmin).post(
      variantPath(product.id),
      variantPayload({ priceRial: "1250.50" }),
    );
    expectStatus(decimal, 400);
    expect(decimal.body.code).toBe("INVALID_VARIANT_PRICERIAL");
  });

  it("rejects duplicate SKU and barcode values", async () => {
    const category = await createCategory();
    const { product } = await createProductThroughApi([category.id]);
    const { payload } = await createVariantThroughApi(product.id);

    const duplicateSku = await api(permittedAdmin).post(
      variantPath(product.id),
      variantPayload({ sku: payload.sku }),
    );
    expectStatus(duplicateSku, 409);
    expect(duplicateSku.body.code).toBe(
      "VARIANT_DUPLICATE_SKU_OR_BARCODE",
    );

    const duplicateBarcode = await api(permittedAdmin).post(
      variantPath(product.id),
      variantPayload({ barcode: payload.barcode }),
    );
    expectStatus(duplicateBarcode, 409);
    expect(duplicateBarcode.body.code).toBe(
      "VARIANT_DUPLICATE_SKU_OR_BARCODE",
    );
  });

  it("rejects creation for an unknown product", async () => {
    const response = await api(permittedAdmin).post(
      variantPath(randomUUID()),
      variantPayload(),
    );

    expectStatus(response, 404);
    expect(response.body.code).toBe("VARIANT_PRODUCT_NOT_FOUND");
  });

  // ---------------------------------------------------------------------------
  // Variant attributes
  // ---------------------------------------------------------------------------

  it("requires active VARIANT-scoped required attributes", async () => {
    const category = await createCategory();
    const { assignment } = await createAttributeAssignment(category.id, {
      inputType: "TEXT",
      isRequired: true,
      scope: "VARIANT",
    });
    const { product } = await createProductThroughApi([category.id]);

    const response = await api(permittedAdmin).post(
      variantPath(product.id),
      variantPayload(),
    );

    expectStatus(response, 409);
    expect(response.body.code).toBe("VARIANT_REQUIRED_ATTRIBUTE_MISSING");
    expect(assignment.id).toBeTruthy();
  });

  it("inherits required VARIANT attributes from parent categories", async () => {
    const parent = await createCategory();
    const child = await createCategory({ parentId: parent.id });
    const { assignment } = await createAttributeAssignment(parent.id, {
      inputType: "TEXT",
      isRequired: true,
    });
    const { product } = await createProductThroughApi([child.id]);

    const { variant } = await createVariantThroughApi(product.id, {
      attributeValues: [
        {
          categoryAttributeId: assignment.id,
          textValue: "Premium cotton",
        },
      ],
    });

    const storedValue = await prisma.variantAttributeValue.findFirst({
      where: {
        variantId: variant.id,
        categoryAttributeId: assignment.id,
      },
    });

    expect(storedValue?.textValue).toBe("Premium cotton");
  });

  it("persists all six supported variant attribute value types", async () => {
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
    const { product } = await createProductThroughApi([category.id]);
    if (selectOptions.length === 0) {
        throw new Error("Select attribute options were not created.");
    }
    const { variant } = await createVariantThroughApi(product.id, {
      attributeValues: [
        {
          categoryAttributeId: text.assignment.id,
          textValue: "  Navy blue  ",
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

    const storedValues = await prisma.variantAttributeValue.findMany({
      where: { variantId: variant.id },
      include: { selectedOptions: true },
    });

    expect(storedValues).toHaveLength(6);
    expect(
      storedValues.find(
        (item) => item.categoryAttributeId === text.assignment.id,
      )?.textValue,
    ).toBe("Navy blue");
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
        (item) => item.categoryAttributeId === date.assignment.id,
      )?.dateValue,
    ).toEqual(new Date("2026-11-19T00:00:00.000Z"));
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

  it("rejects values for attributes outside the product's VARIANT scope", async () => {
    const category = await createCategory();
    const unrelatedCategory = await createCategory();
    const { assignment } = await createAttributeAssignment(
      unrelatedCategory.id,
      { inputType: "TEXT" },
    );
    const { product } = await createProductThroughApi([category.id]);

    const response = await api(permittedAdmin).post(
      variantPath(product.id),
      variantPayload({
        attributeValues: [
          {
            categoryAttributeId: assignment.id,
            textValue: "Not allowed",
          },
        ],
      }),
    );

    expectStatus(response, 409);
    expect(response.body.code).toBe("VARIANT_ATTRIBUTE_NOT_ASSIGNED");
  });

  it("does not accept PRODUCT-scoped attributes as variant attributes", async () => {
    const category = await createCategory();
    const { assignment } = await createAttributeAssignment(category.id, {
      inputType: "TEXT",
      scope: "PRODUCT",
    });
    const { product } = await createProductThroughApi([category.id]);

    const response = await api(permittedAdmin).post(
      variantPath(product.id),
      variantPayload({
        attributeValues: [
          {
            categoryAttributeId: assignment.id,
            textValue: "Wrong scope",
          },
        ],
      }),
    );

    expectStatus(response, 409);
    expect(response.body.code).toBe("VARIANT_ATTRIBUTE_NOT_ASSIGNED");
  });

  it("rejects duplicate attribute values and duplicate multi-select options", async () => {
    const category = await createCategory();
    const text = await createAttributeAssignment(category.id, {
      inputType: "TEXT",
    });
    const multi = await createAttributeAssignment(category.id, {
      inputType: "MULTI_SELECT",
    });
    const options = await createAttributeOptions(multi.attribute.id);
    const [firstMultiOption] = options;

    if (!firstMultiOption) {
      throw new Error("Expected at least one MULTI_SELECT option fixture.");
    }

    const { product } = await createProductThroughApi([category.id]);

    const duplicateValue = await api(permittedAdmin).post(
      variantPath(product.id),
      variantPayload({
        attributeValues: [
          {
            categoryAttributeId: text.assignment.id,
            textValue: "First",
          },
          {
            categoryAttributeId: text.assignment.id,
            textValue: "Second",
          },
        ],
      }),
    );
    expectStatus(duplicateValue, 400);
    expect(duplicateValue.body.code).toBe("VARIANT_DUPLICATE_ATTRIBUTE_VALUE");

    const duplicateOptions = await api(permittedAdmin).post(
      variantPath(product.id),
      variantPayload({
        attributeValues: [
          {
            categoryAttributeId: multi.assignment.id,
            optionIds: [firstMultiOption.id, firstMultiOption.id],
          },
        ],
      }),
    );
    expectStatus(duplicateOptions, 400);
    expect(duplicateOptions.body.code).toBe(
      "VARIANT_ATTRIBUTE_DUPLICATE_OPTIONS",
    );
  });

  it("rejects inactive attribute options", async () => {
    const category = await createCategory();
    const { attribute, assignment } = await createAttributeAssignment(
      category.id,
      { inputType: "SELECT" },
    );
    const options = await createAttributeOptions(attribute.id);
    const [firstOption] = options;

    if (!firstOption) {
      throw new Error("Expected at least one SELECT option fixture.");
    }

    await prisma.attributeOption.update({
      where: { id: firstOption.id },
      data: { isActive: false },
    });
    const { product } = await createProductThroughApi([category.id]);

    const response = await api(permittedAdmin).post(
      variantPath(product.id),
      variantPayload({
        attributeValues: [
          {
            categoryAttributeId: assignment.id,
            optionId: firstOption.id,
          },
        ],
      }),
    );

    expectStatus(response, 400);
    expect(response.body.code).toBe("VARIANT_ATTRIBUTE_OPTION_INVALID");
  });

  // ---------------------------------------------------------------------------
  // List variants
  // ---------------------------------------------------------------------------

  it("lists variants with search and pagination", async () => {
    const category = await createCategory();
    const { product } = await createProductThroughApi([category.id]);
    const searchTerm = `unique-variant-search-${randomUUID()}`;

    const first = await createVariantThroughApi(product.id, {
      sku: `${searchTerm}-SKU-1`,
      title: `${searchTerm} first`,
    });
    await createVariantThroughApi(product.id, {
      sku: `${searchTerm}-SKU-2`,
      title: `${searchTerm} second`,
    });

    const response = await api(permittedAdmin).get(
      `${variantPath(product.id)}?search=${encodeURIComponent(searchTerm)}&page=1&limit=1`,
    );

    expectStatus(response, 200);
    expect(response.body.data.variants).toHaveLength(1);
    expect(response.body.data.pagination).toMatchObject({
      page: 1,
      limit: 1,
      total: 2,
      totalPages: 2,
    });
    expect(response.body.data.variants[0].id).toBeTruthy();
    expect(first.variant.id).toBeTruthy();
  });

  it("filters active and inactive variants and can include both", async () => {
    const category = await createCategory();
    const { product } = await createProductThroughApi([category.id]);
    const { variant: active } = await createVariantThroughApi(product.id);
    const { variant: inactive } = await createVariantThroughApi(product.id);

    await api(permittedAdmin).patch(
      `${variantPath(product.id, inactive.id)}/status`,
      { isActive: false },
    );

    const activeOnly = await api(permittedAdmin).get(variantPath(product.id));
    expectStatus(activeOnly, 200);
    expect(
      activeOnly.body.data.variants.map((item: { id: string }) => item.id),
    ).toContain(active.id);
    expect(
      activeOnly.body.data.variants.map((item: { id: string }) => item.id),
    ).not.toContain(inactive.id);

    const inactiveOnly = await api(permittedAdmin).get(
      `${variantPath(product.id)}?isActive=false`,
    );
    expectStatus(inactiveOnly, 200);
    expect(
      inactiveOnly.body.data.variants.map((item: { id: string }) => item.id),
    ).toContain(inactive.id);

    const all = await api(permittedAdmin).get(
      `${variantPath(product.id)}?includeInactive=true`,
    );
    expectStatus(all, 200);
    const allIds = all.body.data.variants.map(
      (item: { id: string }) => item.id,
    );
    expect(allIds).toContain(active.id);
    expect(allIds).toContain(inactive.id);
  });

  it("rejects invalid list query parameters", async () => {
    const category = await createCategory();
    const { product } = await createProductThroughApi([category.id]);

    const invalidPage = await api(permittedAdmin).get(
      `${variantPath(product.id)}?page=0`,
    );
    expectStatus(invalidPage, 400);

    const invalidBoolean = await api(permittedAdmin).get(
      `${variantPath(product.id)}?includeInactive=maybe`,
    );
    expectStatus(invalidBoolean, 400);
  });

  it("returns 404 when listing variants for an unknown product", async () => {
    const response = await api(permittedAdmin).get(
      variantPath(randomUUID()),
    );

    expectStatus(response, 404);
    expect(response.body.code).toBe("VARIANT_PRODUCT_NOT_FOUND");
  });

  // ---------------------------------------------------------------------------
  // Get variant
  // ---------------------------------------------------------------------------

  it("gets a variant by ID", async () => {
    const category = await createCategory();
    const { product } = await createProductThroughApi([category.id]);
    const { variant } = await createVariantThroughApi(product.id);

    const response = await api(permittedAdmin).get(
      variantPath(product.id, variant.id),
    );

    expectStatus(response, 200);
    expect(response.body.data.id).toBe(variant.id);
    expect(response.body.data.product.id).toBe(product.id);
  });

  it("returns 400 for an invalid variant ID and 404 for an unknown variant", async () => {
    const category = await createCategory();
    const { product } = await createProductThroughApi([category.id]);

    const invalid = await api(permittedAdmin).get(
      variantPath(product.id, "not-a-uuid"),
    );
    expectStatus(invalid, 400);
    expect(invalid.body.code).toBe("INVALID_VARIANT_ID");

    const missing = await api(permittedAdmin).get(
      variantPath(product.id, randomUUID()),
    );
    expectStatus(missing, 404);
    expect(missing.body.code).toBe("VARIANT_NOT_FOUND");
  });

  // ---------------------------------------------------------------------------
  // Update variant
  // ---------------------------------------------------------------------------

  it("updates variant fields", async () => {
    const category = await createCategory();
    const { product } = await createProductThroughApi([category.id]);
    const { variant } = await createVariantThroughApi(product.id);
    const newTitle = `Updated variant ${randomUUID()}`;

    const response = await api(permittedAdmin).patch(
      variantPath(product.id, variant.id),
      {
        title: newTitle,
        priceRial: "2250000",
        compareAtPriceRial: null,
      },
    );

    expectStatus(response, 200);

    const stored = await prisma.productVariant.findUnique({
      where: { id: variant.id },
    });
    expect(stored?.title).toBe(newTitle);
    expect(stored?.priceRial).toBe(2250000n);
    expect(stored?.compareAtPriceRial).toBeNull();
  });

  it("retains existing attribute values when updating unrelated variant fields", async () => {
    const category = await createCategory();
    const { assignment } = await createAttributeAssignment(category.id, {
      inputType: "TEXT",
      isRequired: true,
    });
    const { product } = await createProductThroughApi([category.id]);
    const { variant } = await createVariantThroughApi(product.id, {
      attributeValues: [
        {
          categoryAttributeId: assignment.id,
          textValue: "Original value",
        },
      ],
    });

    const response = await api(permittedAdmin).patch(
      variantPath(product.id, variant.id),
      { title: `Renamed ${randomUUID()}` },
    );

    expectStatus(response, 200);

    const storedValue = await prisma.variantAttributeValue.findFirst({
      where: {
        variantId: variant.id,
        categoryAttributeId: assignment.id,
      },
    });
    expect(storedValue?.textValue).toBe("Original value");
  });

  it("replaces attribute values when attributeValues is supplied", async () => {
    const category = await createCategory();
    const first = await createAttributeAssignment(category.id, {
      inputType: "TEXT",
    });
    const second = await createAttributeAssignment(category.id, {
      inputType: "TEXT",
    });
    const { product } = await createProductThroughApi([category.id]);
    const { variant } = await createVariantThroughApi(product.id, {
      attributeValues: [
        {
          categoryAttributeId: first.assignment.id,
          textValue: "First value",
        },
      ],
    });

    const response = await api(permittedAdmin).patch(
      variantPath(product.id, variant.id),
      {
        attributeValues: [
          {
            categoryAttributeId: second.assignment.id,
            textValue: "Second value",
          },
        ],
      },
    );

    expectStatus(response, 200);

    const storedValues = await prisma.variantAttributeValue.findMany({
      where: { variantId: variant.id },
    });
    expect(storedValues).toHaveLength(1);

    const storedValue = storedValues[0];

    if (!storedValue) {
      throw new Error("Expected the updated variant attribute value to exist.");
    }

    expect(storedValue.categoryAttributeId).toBe(second.assignment.id);
    expect(storedValue.textValue).toBe("Second value");
  });

  it("rejects an update that removes a required attribute value", async () => {
    const category = await createCategory();
    const { assignment } = await createAttributeAssignment(category.id, {
      inputType: "TEXT",
      isRequired: true,
    });
    const { product } = await createProductThroughApi([category.id]);
    const { variant } = await createVariantThroughApi(product.id, {
      attributeValues: [
        {
          categoryAttributeId: assignment.id,
          textValue: "Required value",
        },
      ],
    });

    const response = await api(permittedAdmin).patch(
      variantPath(product.id, variant.id),
      { attributeValues: [] },
    );

    expectStatus(response, 409);
    expect(response.body.code).toBe("VARIANT_REQUIRED_ATTRIBUTE_MISSING");
  });

  it("rejects an update with no supported fields", async () => {
    const category = await createCategory();
    const { product } = await createProductThroughApi([category.id]);
    const { variant } = await createVariantThroughApi(product.id);

    const response = await api(permittedAdmin).patch(
      variantPath(product.id, variant.id),
      {},
    );

    expectStatus(response, 400);
  });

  // ---------------------------------------------------------------------------
  // Variant status and deactivation
  // ---------------------------------------------------------------------------

  it("updates variant active status", async () => {
    const category = await createCategory();
    const { product } = await createProductThroughApi([category.id]);
    const { variant } = await createVariantThroughApi(product.id);

    const response = await api(permittedAdmin).patch(
      `${variantPath(product.id, variant.id)}/status`,
      { isActive: false },
    );

    expectStatus(response, 200);

    const stored = await prisma.productVariant.findUnique({
      where: { id: variant.id },
    });
    expect(stored?.isActive).toBe(false);
  });

  it("rejects an invalid variant status", async () => {
    const category = await createCategory();
    const { product } = await createProductThroughApi([category.id]);
    const { variant } = await createVariantThroughApi(product.id);

    const response = await api(permittedAdmin).patch(
      `${variantPath(product.id, variant.id)}/status`,
      { isActive: "false" },
    );

    expectStatus(response, 400);
    expect(response.body.code).toBe("INVALID_VARIANT_STATUS");
  });

  it("deactivates a variant instead of hard-deleting it", async () => {
    const category = await createCategory();
    const { product } = await createProductThroughApi([category.id]);
    const { variant } = await createVariantThroughApi(product.id);

    const response = await api(permittedAdmin).delete(
      variantPath(product.id, variant.id),
    );

    expectStatus(response, 200);
    expect(response.body.message).toBe("Variant deactivated successfully.");

    const stored = await prisma.productVariant.findUnique({
      where: { id: variant.id },
    });
    expect(stored).not.toBeNull();
    expect(stored?.isActive).toBe(false);
  });

  it("returns 404 when deactivating an unknown variant", async () => {
    const category = await createCategory();
    const { product } = await createProductThroughApi([category.id]);

    const response = await api(permittedAdmin).delete(
      variantPath(product.id, randomUUID()),
    );

    expectStatus(response, 404);
    expect(response.body.code).toBe("VARIANT_NOT_FOUND");
  });
});
