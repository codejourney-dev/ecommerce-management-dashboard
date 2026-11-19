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
// Safety guard: this suite may run only against the dedicated test database.
// -----------------------------------------------------------------------------

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

const databaseName = new URL(databaseUrl).pathname.replace(/^\/+/, "");

if (databaseName !== "ecommerce_dashboard_migration_test") {
  throw new Error(
    `Unsafe integration-test database: "${databaseName}". ` +
      "Required database: ecommerce_dashboard_migration_test.",
  );
}

// Import DB-dependent modules only after the safety guard.
const { prisma } = await import("../../src/config/prisma.js");
const { AdminStatus } = await import("../../generated/prisma/client.js");
const { createAccessToken, hashRefreshToken } = await import(
  "../../src/services/token.service.js"
);
const { createSessionCsrfToken } = await import(
  "../../src/services/csrf.service.js"
);
const { default: app } = await import("../../src/app.js");

// -----------------------------------------------------------------------------
// Types and constants
// -----------------------------------------------------------------------------

type AuthContext = {
  adminId: string;
  accessToken: string;
  csrfToken: string;
  allowedOrigin: string;
};

type InputType =
  | "TEXT"
  | "NUMBER"
  | "SELECT"
  | "MULTI_SELECT"
  | "BOOLEAN"
  | "DATE";

type Scope = "PRODUCT" | "VARIANT";

const REQUIRED_ENDPOINT = (
  categoryId: string,
  categoryAttributeId: string,
) =>
  `/api/categories/${categoryId}/attributes/${categoryAttributeId}/required`;

const CATEGORY_ATTRIBUTE_PERMISSIONS = [
  "categories.attributes.create",
  "categories.attributes.update",
] as const;

// -----------------------------------------------------------------------------
// Test data tracking
// -----------------------------------------------------------------------------

const createdAdminIds: string[] = [];
const createdSessionIds: string[] = [];
const createdRoleIds: string[] = [];

const createdCategoryIds: string[] = [];
const createdAttributeIds: string[] = [];
const createdCategoryAttributeIds: string[] = [];
const createdProductIds: string[] = [];
const createdVariantIds: string[] = [];

let permittedAdmin: AuthContext;
let restrictedAdmin: AuthContext;

// -----------------------------------------------------------------------------
// Authentication helpers
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

function expectStatus(
  response: { status: number; body: unknown },
  status: number,
) {
  expect(
    response.status,
    `Response body:\n${JSON.stringify(response.body, null, 2)}`,
  ).toBe(status);
}

async function createAdmin(name: string) {
  const suffix = randomUUID();

  const admin = await prisma.adminUser.create({
    data: {
      name,
      email: `category-attribute-required-${suffix}@example.test`,
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
  const session = await prisma.adminSession.create({
    data: {
      adminUserId: adminId,
      refreshTokenHash: hashRefreshToken(randomUUID()),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      ipAddress: "127.0.0.1",
      userAgent: "vitest-category-attribute-required",
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

async function assignPermissionSetToAdmin(adminId: string) {
  const role = await prisma.role.create({
    data: {
      name: `cat-req-${randomUUID().slice(0, 8)}`,
      description: "Temporary role for required category attribute tests",
    },
  });

  createdRoleIds.push(role.id);

  const permissions = await Promise.all(
    CATEGORY_ATTRIBUTE_PERMISSIONS.map((name) =>
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
    data: { adminUserId: adminId, roleId: role.id },
  });
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
    patch(path: string, body?: unknown) {
      return request(app)
        .patch(path)
        .set("Authorization", `Bearer ${auth.accessToken}`)
        .set("Origin", auth.allowedOrigin)
        .set("Cookie", `csrf_token=${auth.csrfToken}`)
        .set("X-CSRF-Token", auth.csrfToken)
        .send(body ?? {});
    },
  };
}

// -----------------------------------------------------------------------------
// Domain fixture helpers
// -----------------------------------------------------------------------------

async function createCategory(parentId?: string) {
  const suffix = randomUUID();

  const category = await prisma.category.create({
    data: {
      name: `Required attribute category ${suffix}`,
      slug: `required-attribute-category-${suffix}`,
      ...(parentId ? { parentId } : {}),
    },
  });

  createdCategoryIds.push(category.id);
  return category;
}

async function createAttribute(inputType: InputType, isActive = true) {
  const suffix = randomUUID();

  const attribute = await prisma.attribute.create({
    data: {
      name: `Required attribute ${suffix}`,
      slug: `required-attribute-${suffix}`,
      inputType,
      isActive,
    },
  });

  createdAttributeIds.push(attribute.id);
  return attribute;
}

async function createAssignment(
  categoryId: string,
  inputType: InputType,
  scope: Scope = "PRODUCT",
  isActive = true,
) {
  const attribute = await createAttribute(inputType, isActive);

  const assignment = await prisma.categoryAttribute.create({
    data: {
      categoryId,
      attributeId: attribute.id,
      scope,
      isRequired: false,
    },
  });

  createdCategoryAttributeIds.push(assignment.id);

  return { attribute, assignment };
}

async function createProduct(
  categoryIds: string[],
  input: {
    status?: "DRAFT" | "ACTIVE" | "INACTIVE" | "ARCHIVED";
    deletedAt?: Date | null;
    withVariant?: boolean;
    variantActive?: boolean;
  } = {},
) {
  const suffix = randomUUID();

  const product = await prisma.product.create({
    data: {
      name: `Required attribute product ${suffix}`,
      slug: `required-attribute-product-${suffix}`,
      description: "Created by required category attribute integration tests.",
      status: input.status ?? "DRAFT",
      deletedAt: input.deletedAt ?? null,
    },
  });

  createdProductIds.push(product.id);

  await prisma.productCategory.createMany({
    data: [...new Set(categoryIds)].map((categoryId) => ({
      productId: product.id,
      categoryId,
    })),
    skipDuplicates: true,
  });

  let variant: { id: string } | null = null;

  if (input.withVariant) {
    const createdVariant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        sku: `REQ-${suffix}`,
        title: "Required attribute test variant",
        priceRial: 100000n,
        isActive: input.variantActive ?? true,
      },
      select: { id: true },
    });

    createdVariantIds.push(createdVariant.id);
    variant = createdVariant;
  }

  return { product, variant };
}

async function createProductValue(
  productId: string,
  assignmentId: string,
  attributeId: string,
  data: {
    textValue?: string | null;
    numberValue?: number | null;
    booleanValue?: boolean | null;
    dateValue?: Date | null;
    optionId?: string | null;
  } = {},
) {
  return prisma.productAttributeValue.create({
    data: {
      productId,
      categoryAttributeId: assignmentId,
      attributeId,
      ...data,
    },
  });
}

async function createVariantValue(
  variantId: string,
  assignmentId: string,
  attributeId: string,
  data: {
    textValue?: string | null;
    numberValue?: number | null;
    booleanValue?: boolean | null;
    dateValue?: Date | null;
    optionId?: string | null;
  } = {},
) {
  return prisma.variantAttributeValue.create({
    data: {
      variantId,
      categoryAttributeId: assignmentId,
      attributeId,
      ...data,
    },
  });
}

async function createOption(
  attributeId: string,
  input: { isActive?: boolean; value?: string } = {},
) {
  const suffix = randomUUID();

  return prisma.attributeOption.create({
    data: {
      attributeId,
      label: `Option ${suffix.slice(0, 8)}`,
      value: input.value ?? `option-${suffix}`,
      isActive: input.isActive ?? true,
    },
  });
}

async function enableRequired(
  categoryId: string,
  categoryAttributeId: string,
) {
  return api(permittedAdmin).patch(
    REQUIRED_ENDPOINT(categoryId, categoryAttributeId),
    { isRequired: true },
  );
}

// -----------------------------------------------------------------------------
// Setup and cleanup
// -----------------------------------------------------------------------------

beforeAll(async () => {
  const admin = await createAdmin("Category Attribute Required Admin");
  await assignPermissionSetToAdmin(admin.id);
  permittedAdmin = await createAuthContext(admin.id);

  const noPermissionAdmin = await createAdmin(
    "Category Attribute Required Restricted Admin",
  );
  restrictedAdmin = await createAuthContext(noPermissionAdmin.id);
});

afterEach(async () => {
  // Values and variants must be removed before their parent product records.
  if (createdVariantIds.length) {
    await prisma.variantAttributeValue.deleteMany({
      where: { variantId: { in: createdVariantIds } },
    });
    await prisma.productVariant.deleteMany({
      where: { id: { in: createdVariantIds.splice(0) } },
    });
  }

  if (createdProductIds.length) {
    await prisma.productAttributeValue.deleteMany({
      where: { productId: { in: createdProductIds } },
    });
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

  // Children were created after parents; reverse order respects the self-FK.
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
// Integration tests
// -----------------------------------------------------------------------------

describe("Category Attribute Required Status API", () => {
  // ---------------------------------------------------------------------------
  // Authentication, authorization and CSRF
  // ---------------------------------------------------------------------------

  it("rejects a request without an access token", async () => {
    const category = await createCategory();
    const { assignment } = await createAssignment(category.id, "TEXT");

    const response = await request(app)
      .patch(REQUIRED_ENDPOINT(category.id, assignment.id))
      .send({ isRequired: true });

    expectStatus(response, 401);
  });

  it("rejects an authenticated admin without categories.attributes.update", async () => {
    const category = await createCategory();
    const { assignment } = await createAssignment(category.id, "TEXT");

    const response = await api(restrictedAdmin).patch(
      REQUIRED_ENDPOINT(category.id, assignment.id),
      { isRequired: true },
    );

    expectStatus(response, 403);
  });

  it("rejects a mutation without a valid CSRF token", async () => {
    const category = await createCategory();
    const { assignment } = await createAssignment(category.id, "TEXT");

    const response = await request(app)
      .patch(REQUIRED_ENDPOINT(category.id, assignment.id))
      .set("Authorization", `Bearer ${permittedAdmin.accessToken}`)
      .set("Origin", permittedAdmin.allowedOrigin)
      .send({ isRequired: true });

    expectStatus(response, 403);
  });

  // ---------------------------------------------------------------------------
  // Route and request validation
  // ---------------------------------------------------------------------------

  it("rejects an invalid category UUID", async () => {
    const response = await api(permittedAdmin).patch(
      REQUIRED_ENDPOINT("not-a-uuid", randomUUID()),
      { isRequired: true },
    );

    expectStatus(response, 400);
  });

  it("rejects an invalid category-attribute UUID", async () => {
    const category = await createCategory();

    const response = await api(permittedAdmin).patch(
      REQUIRED_ENDPOINT(category.id, "not-a-uuid"),
      { isRequired: true },
    );

    expectStatus(response, 400);
  });

  it("requires an explicit isRequired value", async () => {
    const category = await createCategory();
    const { assignment } = await createAssignment(category.id, "TEXT");

    const response = await api(permittedAdmin).patch(
      REQUIRED_ENDPOINT(category.id, assignment.id),
      {},
    );

    expectStatus(response, 400);
    expect(response.body.code).toBe("INVALID_REQUIRED_VALUE");
  });

  it.each(["true", 1, null, [], {}])(
    "rejects a non-boolean isRequired value: %s",
    async (isRequired) => {
      const category = await createCategory();
      const { assignment } = await createAssignment(category.id, "TEXT");

      const response = await api(permittedAdmin).patch(
        REQUIRED_ENDPOINT(category.id, assignment.id),
        { isRequired },
      );

      expectStatus(response, 400);
      expect(response.body.code).toBe("INVALID_REQUIRED_VALUE");
    },
  );

  it("returns 404 when the category does not exist", async () => {
    const category = await createCategory();
    const { assignment } = await createAssignment(category.id, "TEXT");

    const response = await api(permittedAdmin).patch(
      REQUIRED_ENDPOINT(randomUUID(), assignment.id),
      { isRequired: true },
    );

    expectStatus(response, 404);
  });

  it("returns 404 when the assignment does not exist", async () => {
    const category = await createCategory();

    const response = await api(permittedAdmin).patch(
      REQUIRED_ENDPOINT(category.id, randomUUID()),
      { isRequired: true },
    );

    expectStatus(response, 404);
    expect(response.body.code).toBe("CATEGORY_ATTRIBUTE_NOT_FOUND");
  });

  it("returns 404 when the assignment belongs to another category", async () => {
    const firstCategory = await createCategory();
    const secondCategory = await createCategory();
    const { assignment } = await createAssignment(
      firstCategory.id,
      "TEXT",
    );

    const response = await api(permittedAdmin).patch(
      REQUIRED_ENDPOINT(secondCategory.id, assignment.id),
      { isRequired: true },
    );

    expectStatus(response, 404);
    expect(response.body.code).toBe("CATEGORY_ATTRIBUTE_NOT_FOUND");
  });

  // ---------------------------------------------------------------------------
  // Required activation and deactivation
  // ---------------------------------------------------------------------------

  it("rejects creating a CategoryAttribute with isRequired=true", async () => {
    const category = await createCategory();
    const attribute = await createAttribute("TEXT");

    const response = await api(permittedAdmin).post(
      `/api/categories/${category.id}/attributes`,
      {
        attributeId: attribute.id,
        scope: "PRODUCT",
        isRequired: true,
      },
    );

    expectStatus(response, 409);
    expect(response.body.code).toBe(
      "REQUIRED_ATTRIBUTE_MUST_BE_ENABLED_AFTER_CREATION",
    );

    const stored = await prisma.categoryAttribute.findUnique({
      where: {
        categoryId_attributeId: {
          categoryId: category.id,
          attributeId: attribute.id,
        },
      },
    });

    expect(stored).toBeNull();
  });

  it("allows making an assignment optional without existing values", async () => {
    const category = await createCategory();
    const { assignment } = await createAssignment(category.id, "TEXT");

    const response = await api(permittedAdmin).patch(
      REQUIRED_ENDPOINT(category.id, assignment.id),
      { isRequired: false },
    );

    expectStatus(response, 200);

    const stored = await prisma.categoryAttribute.findUnique({
      where: { id: assignment.id },
    });

    expect(stored?.isRequired).toBe(false);
  });

  it("is idempotent when an already-optional assignment is set to optional", async () => {
    const category = await createCategory();
    const { assignment } = await createAssignment(category.id, "TEXT");

    const first = await api(permittedAdmin).patch(
      REQUIRED_ENDPOINT(category.id, assignment.id),
      { isRequired: false },
    );
    const second = await api(permittedAdmin).patch(
      REQUIRED_ENDPOINT(category.id, assignment.id),
      { isRequired: false },
    );

    expectStatus(first, 200);
    expectStatus(second, 200);
  });

  it("is idempotent when an already-required assignment is set to required", async () => {
    const category = await createCategory();
    const { attribute, assignment } = await createAssignment(
      category.id,
      "TEXT",
    );
    const { product } = await createProduct([category.id]);

    await createProductValue(
      product.id,
      assignment.id,
      attribute.id,
      { textValue: "Cotton" },
    );

    const first = await enableRequired(category.id, assignment.id);
    const second = await enableRequired(category.id, assignment.id);

    expectStatus(first, 200);
    expectStatus(second, 200);
  });

  it("returns 409 and preserves optional status when any product value is missing", async () => {
    const category = await createCategory();
    const { assignment } = await createAssignment(category.id, "TEXT");
    await createProduct([category.id]);

    const response = await enableRequired(category.id, assignment.id);

    expectStatus(response, 409);
    expect(response.body.code).toBe("REQUIRED_ATTRIBUTE_VALUES_INCOMPLETE");
    expect(response.body.message).toContain("1 of 1");

    const stored = await prisma.categoryAttribute.findUnique({
      where: { id: assignment.id },
    });
    expect(stored?.isRequired).toBe(false);
  });

  it("reports the number of incomplete products", async () => {
    const category = await createCategory();
    const { attribute, assignment } = await createAssignment(
      category.id,
      "TEXT",
    );

    const first = await createProduct([category.id]);
    const second = await createProduct([category.id]);

    await createProductValue(
      first.product.id,
      assignment.id,
      attribute.id,
      { textValue: "Cotton" },
    );

    const response = await enableRequired(category.id, assignment.id);

    expectStatus(response, 409);
    expect(response.body.code).toBe("REQUIRED_ATTRIBUTE_VALUES_INCOMPLETE");
    expect(response.body.message).toContain("1 of 2");

    const secondValue = await prisma.productAttributeValue.findFirst({
      where: { productId: second.product.id },
    });
    expect(secondValue).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Product scope: input type validation
  // ---------------------------------------------------------------------------

  it("allows TEXT values containing non-whitespace characters", async () => {
    const category = await createCategory();
    const { attribute, assignment } = await createAssignment(
      category.id,
      "TEXT",
    );
    const { product } = await createProduct([category.id]);

    await createProductValue(
      product.id,
      assignment.id,
      attribute.id,
      { textValue: "  Cotton  " },
    );

    const response = await enableRequired(category.id, assignment.id);
    expectStatus(response, 200);
  });

  it("rejects a whitespace-only TEXT value", async () => {
    const category = await createCategory();
    const { attribute, assignment } = await createAssignment(
      category.id,
      "TEXT",
    );
    const { product } = await createProduct([category.id]);

    await createProductValue(
      product.id,
      assignment.id,
      attribute.id,
      { textValue: "   \n\t " },
    );

    const response = await enableRequired(category.id, assignment.id);

    expectStatus(response, 409);
    expect(response.body.code).toBe("REQUIRED_ATTRIBUTE_VALUES_INCOMPLETE");
  });

  it("accepts a non-null NUMBER value", async () => {
    const category = await createCategory();
    const { attribute, assignment } = await createAssignment(
      category.id,
      "NUMBER",
    );
    const { product } = await createProduct([category.id]);

    await createProductValue(
      product.id,
      assignment.id,
      attribute.id,
      { numberValue: 0 },
    );

    const response = await enableRequired(category.id, assignment.id);
    expectStatus(response, 200);
  });

  it("accepts BOOLEAN false as a valid value", async () => {
    const category = await createCategory();
    const { attribute, assignment } = await createAssignment(
      category.id,
      "BOOLEAN",
    );
    const { product } = await createProduct([category.id]);

    await createProductValue(
      product.id,
      assignment.id,
      attribute.id,
      { booleanValue: false },
    );

    const response = await enableRequired(category.id, assignment.id);
    expectStatus(response, 200);
  });

  it("accepts a non-null DATE value", async () => {
    const category = await createCategory();
    const { attribute, assignment } = await createAssignment(
      category.id,
      "DATE",
    );
    const { product } = await createProduct([category.id]);

    await createProductValue(
      product.id,
      assignment.id,
      attribute.id,
      { dateValue: new Date("2025-01-15T00:00:00.000Z") },
    );

    const response = await enableRequired(category.id, assignment.id);
    expectStatus(response, 200);
  });

  it("accepts a SELECT value whose option is active", async () => {
    const category = await createCategory();
    const { attribute, assignment } = await createAssignment(
      category.id,
      "SELECT",
    );
    const { product } = await createProduct([category.id]);
    const option = await createOption(attribute.id);

    await createProductValue(
      product.id,
      assignment.id,
      attribute.id,
      { optionId: option.id },
    );

    const response = await enableRequired(category.id, assignment.id);
    expectStatus(response, 200);
  });

  it("rejects a SELECT value after its selected option becomes inactive", async () => {
    const category = await createCategory();
    const { attribute, assignment } = await createAssignment(
      category.id,
      "SELECT",
    );
    const { product } = await createProduct([category.id]);
    const option = await createOption(attribute.id);

    await createProductValue(
      product.id,
      assignment.id,
      attribute.id,
      { optionId: option.id },
    );

    await prisma.attributeOption.update({
      where: { id: option.id },
      data: { isActive: false },
    });

    const response = await enableRequired(category.id, assignment.id);

    expectStatus(response, 409);
    expect(response.body.code).toBe("REQUIRED_ATTRIBUTE_VALUES_INCOMPLETE");
  });

  it("accepts a MULTI_SELECT value with at least one active selected option", async () => {
    const category = await createCategory();
    const { attribute, assignment } = await createAssignment(
      category.id,
      "MULTI_SELECT",
    );
    const { product } = await createProduct([category.id]);
    const option = await createOption(attribute.id);

    await prisma.$transaction(async (tx) => {
      const value = await tx.productAttributeValue.create({
        data: {
          productId: product.id,
          categoryAttributeId: assignment.id,
          attributeId: attribute.id,
        },
      });

      await tx.productAttributeValueOption.create({
        data: {
          productAttributeValueId: value.id,
          optionId: option.id,
        },
      });
    });

    const response = await enableRequired(category.id, assignment.id);
    expectStatus(response, 200);
  });

  it("rejects a MULTI_SELECT value when all selected options are inactive", async () => {
    const category = await createCategory();
    const { attribute, assignment } = await createAssignment(
      category.id,
      "MULTI_SELECT",
    );
    const { product } = await createProduct([category.id]);
    const option = await createOption(attribute.id);

    const value = await prisma.$transaction(async (tx) => {
      const parent = await tx.productAttributeValue.create({
        data: {
          productId: product.id,
          categoryAttributeId: assignment.id,
          attributeId: attribute.id,
        },
      });

      await tx.productAttributeValueOption.create({
        data: {
          productAttributeValueId: parent.id,
          optionId: option.id,
        },
      });

      return parent;
    });

    expect(value.id).toBeTruthy();

    await prisma.attributeOption.update({
      where: { id: option.id },
      data: { isActive: false },
    });

    const response = await enableRequired(category.id, assignment.id);

    expectStatus(response, 409);
    expect(response.body.code).toBe("REQUIRED_ATTRIBUTE_VALUES_INCOMPLETE");
  });

  // ---------------------------------------------------------------------------
  // Variant scope
  // ---------------------------------------------------------------------------

  it("checks variant values instead of product values for VARIANT scope", async () => {
    const category = await createCategory();
    const { attribute, assignment } = await createAssignment(
      category.id,
      "TEXT",
      "VARIANT",
    );
    const { product, variant } = await createProduct(
      [category.id],
      { withVariant: true },
    );

    if (!variant) throw new Error("Expected a variant fixture.");

    // A ProductAttributeValue must not satisfy a VARIANT-scoped assignment.
    // The database integrity trigger rejects this scope mismatch, so create
    // only the valid variant value and verify it is the one used.
    await createVariantValue(
      variant.id,
      assignment.id,
      attribute.id,
      { textValue: "Large" },
    );

    const response = await enableRequired(category.id, assignment.id);
    expectStatus(response, 200);

    // The product-level table must remain empty for this assignment.
    const productValues = await prisma.productAttributeValue.count({
      where: {
        productId: product.id,
        categoryAttributeId: assignment.id,
      },
    });
    expect(productValues).toBe(0);
  });

  it("rejects VARIANT scope when even one variant is missing a valid value", async () => {
    const category = await createCategory();
    const { attribute, assignment } = await createAssignment(
      category.id,
      "TEXT",
      "VARIANT",
    );

    const first = await createProduct([category.id], { withVariant: true });
    const second = await createProduct(
      [category.id],
      { withVariant: true, variantActive: false },
    );

    if (!first.variant || !second.variant) {
      throw new Error("Expected both variant fixtures.");
    }

    await createVariantValue(
      first.variant.id,
      assignment.id,
      attribute.id,
      { textValue: "Valid" },
    );

    const response = await enableRequired(category.id, assignment.id);

    expectStatus(response, 409);
    expect(response.body.code).toBe("REQUIRED_ATTRIBUTE_VALUES_INCOMPLETE");
    expect(response.body.message).toContain("1 of 2 variant(s)");
  });

  it("checks inactive variants too", async () => {
    const category = await createCategory();
    const { attribute, assignment } = await createAssignment(
      category.id,
      "BOOLEAN",
      "VARIANT",
    );
    const { variant } = await createProduct(
      [category.id],
      { withVariant: true, variantActive: false },
    );

    if (!variant) throw new Error("Expected an inactive variant.");

    await createVariantValue(
      variant.id,
      assignment.id,
      attribute.id,
      { booleanValue: false },
    );

    const response = await enableRequired(category.id, assignment.id);
    expectStatus(response, 200);
  });

  // ---------------------------------------------------------------------------
  // Category hierarchy, duplicate associations, product status and deletion
  // ---------------------------------------------------------------------------

  it("includes products assigned to descendant categories", async () => {
    const parent = await createCategory();
    const child = await createCategory(parent.id);
    const { assignment } = await createAssignment(parent.id, "TEXT");

    await createProduct([child.id]);

    const response = await enableRequired(parent.id, assignment.id);

    expectStatus(response, 409);
    expect(response.body.code).toBe("REQUIRED_ATTRIBUTE_VALUES_INCOMPLETE");
  });

  it("counts a product only once when it is linked to multiple categories in the subtree", async () => {
    const parent = await createCategory();
    const child = await createCategory(parent.id);
    const { assignment } = await createAssignment(parent.id, "TEXT");

    await createProduct([parent.id, child.id]);

    const response = await enableRequired(parent.id, assignment.id);

    expectStatus(response, 409);
    expect(response.body.message).toContain("1 of 1 product(s)");
  });

  it("does not require values for soft-deleted products", async () => {
    const category = await createCategory();
    const { assignment } = await createAssignment(category.id, "TEXT");

    await createProduct([category.id], {
      deletedAt: new Date(),
    });

    const response = await enableRequired(category.id, assignment.id);
    expectStatus(response, 200);
  });

  it.each(["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"] as const)(
    "includes products with %s status in the completeness check",
    async (status) => {
      const category = await createCategory();
      const { assignment } = await createAssignment(category.id, "TEXT");

      await createProduct([category.id], { status });

      const response = await enableRequired(category.id, assignment.id);

      expectStatus(response, 409);
      expect(response.body.code).toBe(
        "REQUIRED_ATTRIBUTE_VALUES_INCOMPLETE",
      );
    },
  );

  it("allows enabling required when no non-deleted products or variants are in scope", async () => {
    const category = await createCategory();
    const { assignment } = await createAssignment(category.id, "TEXT");

    const response = await enableRequired(category.id, assignment.id);
    expectStatus(response, 200);

    const stored = await prisma.categoryAttribute.findUnique({
      where: { id: assignment.id },
    });
    expect(stored?.isRequired).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Attribute state and final persistence
  // ---------------------------------------------------------------------------

  it("rejects making an inactive attribute required", async () => {
    const category = await createCategory();
    const { assignment } = await createAssignment(
      category.id,
      "TEXT",
      "PRODUCT",
      false,
    );

    const response = await enableRequired(category.id, assignment.id);

    expectStatus(response, 409);
    expect(response.body.code).toBe("ATTRIBUTE_INACTIVE");

    const stored = await prisma.categoryAttribute.findUnique({
      where: { id: assignment.id },
    });
    expect(stored?.isRequired).toBe(false);
  });

  it("persists isRequired=true after every applicable product has a valid value", async () => {
    const category = await createCategory();
    const { attribute, assignment } = await createAssignment(
      category.id,
      "NUMBER",
    );

    const first = await createProduct([category.id], { status: "DRAFT" });
    const second = await createProduct([category.id], { status: "ARCHIVED" });

    await createProductValue(
      first.product.id,
      assignment.id,
      attribute.id,
      { numberValue: 12 },
    );
    await createProductValue(
      second.product.id,
      assignment.id,
      attribute.id,
      { numberValue: 0 },
    );

    const response = await enableRequired(category.id, assignment.id);
    expectStatus(response, 200);

    const stored = await prisma.categoryAttribute.findUnique({
      where: { id: assignment.id },
    });
    expect(stored?.isRequired).toBe(true);
  });
});
