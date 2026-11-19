
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
      "Category Attribute API tests may run only against ecommerce_dashboard_migration_test.",
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

// -----------------------------------------------------------------------------
// Constants and types
// -----------------------------------------------------------------------------

const CATEGORY_ATTRIBUTE_PERMISSIONS = [
  "categories.attributes.create",
] as const;

type AuthContext = {
  adminId: string;
  accessToken: string;
  csrfToken: string;
  allowedOrigin: string;
};

// -----------------------------------------------------------------------------
// Test data tracking
// -----------------------------------------------------------------------------

const createdAttributeIds: string[] = [];
const createdCategoryIds: string[] = [];
const createdCategoryAttributeIds: string[] = [];

const createdAdminIds: string[] = [];
const createdRoleIds: string[] = [];
const createdSessionIds: string[] = [];

let permittedAdmin: AuthContext;
let restrictedAdmin: AuthContext;

// -----------------------------------------------------------------------------
// Helpers
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
      email: `category-attribute-test-${suffix}@example.test`,
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
      userAgent: "vitest-category-attribute-management",
    },
  });

  createdSessionIds.push(session.id);

  const csrf = createSessionCsrfToken(
    session.id,
    session.expiresAt,
  );

  await prisma.adminSession.update({
    where: { id: session.id },
    data: { csrfTokenHash: csrf.tokenHash },
  });

  const accessToken = await createAccessToken(
    adminId,
    session.id,
  );

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

async function assignPermissionSetToAdmin(adminId: string) {
  const suffix = randomUUID();

  const role = await prisma.role.create({
    data: {
      // Role.name has a maximum length of 50 characters.
      name: `cat-attr-${suffix.slice(0, 8)}`,
      description: "Temporary role for category attribute integration tests",
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
    data: {
      adminUserId: adminId,
      roleId: role.id,
    },
  });
}

async function createCategory(input: {
  name?: string;
  slug?: string;
  parentId?: string | null;
} = {}) {
  const suffix = randomUUID();

  const category = await prisma.category.create({
    data: {
      name: input.name ?? `Category attribute test ${suffix}`,
      slug: input.slug ?? `category-attribute-test-${suffix}`,
      parentId: input.parentId ?? null,
    },
  });

  createdCategoryIds.push(category.id);

  return category;
}

async function createAttribute(input: {
  name?: string;
  slug?: string;
  inputType?:
    | "TEXT"
    | "NUMBER"
    | "SELECT"
    | "MULTI_SELECT"
    | "BOOLEAN"
    | "DATE";
  isActive?: boolean;
} = {}) {
  const suffix = randomUUID();

  const attribute = await prisma.attribute.create({
    data: {
      name: input.name ?? `Category attribute test ${suffix}`,
      slug: input.slug ?? `category-attribute-test-${suffix}`,
      inputType: input.inputType ?? "TEXT",
      isActive: input.isActive ?? true,
    },
  });

  createdAttributeIds.push(attribute.id);

  return attribute;
}

/**
 * Track assignments created through the API so afterEach can remove them.
 */
async function trackAssignment(
  categoryId: string,
  attributeId: string,
) {
  const assignment = await prisma.categoryAttribute.findUnique({
    where: {
      categoryId_attributeId: {
        categoryId,
        attributeId,
      },
    },
    select: {
      id: true,
    },
  });

  if (assignment) {
    createdCategoryAttributeIds.push(assignment.id);
  }

  return assignment;
}

// -----------------------------------------------------------------------------
// Setup
// -----------------------------------------------------------------------------

beforeAll(async () => {
  const admin = await createAdmin(
    "Category Attribute Integration Admin",
  );

  await assignPermissionSetToAdmin(admin.id);
  permittedAdmin = await createAuthContext(admin.id);

  const noPermissionAdmin = await createAdmin(
    "Category Attribute Restricted Admin",
  );

  restrictedAdmin = await createAuthContext(noPermissionAdmin.id);
});

// -----------------------------------------------------------------------------
// Cleanup
// -----------------------------------------------------------------------------

afterEach(async () => {
  // Remove category-attribute assignments before deleting their relations.
  if (createdCategoryAttributeIds.length) {
    await prisma.categoryAttribute.deleteMany({
      where: {
        id: {
          in: createdCategoryAttributeIds.splice(0),
        },
      },
    });
  }

  // Attributes may be referenced by category assignments.
  if (createdAttributeIds.length) {
    await prisma.attribute.deleteMany({
      where: {
        id: {
          in: createdAttributeIds.splice(0),
        },
      },
    });
  }

  // Delete deepest categories first to respect the self-relation.
  for (const categoryId of createdCategoryIds.splice(0).reverse()) {
    await prisma.category.deleteMany({
      where: { id: categoryId },
    });
  }
});

afterAll(async () => {
  try {
    // Admin deletion cascades sessions and admin-role assignments.
    if (createdAdminIds.length) {
      await prisma.adminUser.deleteMany({
        where: {
          id: {
            in: createdAdminIds.splice(0),
          },
        },
      });
    }

    if (createdSessionIds.length) {
      await prisma.adminSession.deleteMany({
        where: {
          id: {
            in: createdSessionIds.splice(0),
          },
        },
      });
    }

    if (createdRoleIds.length) {
      await prisma.role.deleteMany({
        where: {
          id: {
            in: createdRoleIds.splice(0),
          },
        },
      });
    }
  } finally {
    await prisma.$disconnect();
  }
});

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe("Category Attribute Management API", () => {
  const endpoint = (categoryId: string) =>
    `/api/categories/${categoryId}/attributes`;

  // ---------------------------------------------------------------------------
  // Authentication, authorization and CSRF
  // ---------------------------------------------------------------------------

  it("rejects requests without an access token", async () => {
    const category = await createCategory();

    const response = await request(app)
      .post(endpoint(category.id))
      .send({
        attributeId: randomUUID(),
        scope: "PRODUCT",
      });

    expectStatus(response, 401);
  });

  it("rejects an authenticated admin without categories.attributes.create permission", async () => {
    const category = await createCategory();
    const attribute = await createAttribute();

    const response = await api(restrictedAdmin).post(
      endpoint(category.id),
      {
        attributeId: attribute.id,
        scope: "PRODUCT",
      },
    );

    expectStatus(response, 403);
  });

  it("rejects a mutation without a valid CSRF token", async () => {
    const category = await createCategory();
    const attribute = await createAttribute();

    const response = await request(app)
      .post(endpoint(category.id))
      .set(
        "Authorization",
        `Bearer ${permittedAdmin.accessToken}`,
      )
      .set("Origin", permittedAdmin.allowedOrigin)
      .send({
        attributeId: attribute.id,
        scope: "PRODUCT",
      });

    expectStatus(response, 403);
  });

  // ---------------------------------------------------------------------------
  // Successful creation
  // ---------------------------------------------------------------------------

  it("assigns an attribute to a category and persists the assignment", async () => {
    const category = await createCategory();
    const attribute = await createAttribute();

    const response = await api(permittedAdmin).post(
      endpoint(category.id),
      {
        attributeId: attribute.id,
        scope: "PRODUCT",
      },
    );

    expectStatus(response, 201);

    const stored = await prisma.categoryAttribute.findUnique({
      where: {
        categoryId_attributeId: {
          categoryId: category.id,
          attributeId: attribute.id,
        },
      },
      include: {
        category: true,
        attribute: true,
      },
    });

    expect(stored).not.toBeNull();
    expect(stored?.categoryId).toBe(category.id);
    expect(stored?.attributeId).toBe(attribute.id);
    expect(stored?.scope).toBe("PRODUCT");

    if (stored) {
      createdCategoryAttributeIds.push(stored.id);
    }
  });

  it("uses the default values for isRequired and position", async () => {
    const category = await createCategory();
    const attribute = await createAttribute();

    const response = await api(permittedAdmin).post(
      endpoint(category.id),
      {
        attributeId: attribute.id,
        scope: "PRODUCT",
      },
    );

    expectStatus(response, 201);

    const stored = await trackAssignment(
      category.id,
      attribute.id,
    );

    expect(stored).not.toBeNull();

    const assignment = await prisma.categoryAttribute.findUnique({
      where: {
        categoryId_attributeId: {
          categoryId: category.id,
          attributeId: attribute.id,
        },
      },
    });

    expect(assignment?.isRequired).toBe(false);
    expect(assignment?.position).toBe(0);
  });

    it("rejects creating a required VARIANT attribute", async () => {
        const category = await createCategory();
        const attribute = await createAttribute();

        const response = await api(permittedAdmin).post(
            endpoint(category.id),
            {
            attributeId: attribute.id,
            scope: "VARIANT",
            isRequired: true,
            position: 5,
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

  // ---------------------------------------------------------------------------
  // Request validation
  // ---------------------------------------------------------------------------

  it("rejects an invalid category ID", async () => {
    const response = await api(permittedAdmin).post(
      endpoint("not-a-valid-uuid"),
      {
        attributeId: randomUUID(),
        scope: "PRODUCT",
      },
    );

    expectStatus(response, 400);
  });

  it("rejects a missing attributeId", async () => {
    const category = await createCategory();

    const response = await api(permittedAdmin).post(
      endpoint(category.id),
      {
        scope: "PRODUCT",
      },
    );

    expectStatus(response, 400);
  });

  it("rejects an invalid attributeId format", async () => {
    const category = await createCategory();

    const response = await api(permittedAdmin).post(
      endpoint(category.id),
      {
        attributeId: "not-a-valid-uuid",
        scope: "PRODUCT",
      },
    );

    expectStatus(response, 400);
  });

  it("rejects an unsupported scope", async () => {
    const category = await createCategory();
    const attribute = await createAttribute();

    const response = await api(permittedAdmin).post(
      endpoint(category.id),
      {
        attributeId: attribute.id,
        scope: "INVALID_SCOPE",
      },
    );

    expectStatus(response, 400);
  });

  it("rejects a non-boolean isRequired value", async () => {
    const category = await createCategory();
    const attribute = await createAttribute();

    const response = await api(permittedAdmin).post(
      endpoint(category.id),
      {
        attributeId: attribute.id,
        scope: "PRODUCT",
        isRequired: "true",
      },
    );

    expectStatus(response, 400);
  });

  it("rejects a negative position", async () => {
    const category = await createCategory();
    const attribute = await createAttribute();

    const response = await api(permittedAdmin).post(
      endpoint(category.id),
      {
        attributeId: attribute.id,
        scope: "PRODUCT",
        position: -1,
      },
    );

    expectStatus(response, 400);
  });

  it("rejects a non-integer position", async () => {
    const category = await createCategory();
    const attribute = await createAttribute();

    const response = await api(permittedAdmin).post(
      endpoint(category.id),
      {
        attributeId: attribute.id,
        scope: "PRODUCT",
        position: 1.5,
      },
    );

    expectStatus(response, 400);
  });

  // ---------------------------------------------------------------------------
  // Entity validation
  // ---------------------------------------------------------------------------

  it("returns 404 when the category does not exist", async () => {
    const attribute = await createAttribute();

    const response = await api(permittedAdmin).post(
      endpoint(randomUUID()),
      {
        attributeId: attribute.id,
        scope: "PRODUCT",
      },
    );

    expectStatus(response, 404);
  });

  it("returns 404 when the attribute does not exist", async () => {
    const category = await createCategory();

    const response = await api(permittedAdmin).post(
      endpoint(category.id),
      {
        attributeId: randomUUID(),
        scope: "PRODUCT",
      },
    );

    expectStatus(response, 404);
  });

  it("rejects assigning an inactive attribute", async () => {
    const category = await createCategory();
    const attribute = await createAttribute({
      isActive: false,
    });

    const response = await api(permittedAdmin).post(
      endpoint(category.id),
      {
        attributeId: attribute.id,
        scope: "PRODUCT",
      },
    );

    expectStatus(response, 409);

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

  // ---------------------------------------------------------------------------
  // Category hierarchy and duplicate assignments
  // ---------------------------------------------------------------------------

  it("rejects assigning the same attribute twice to the same category", async () => {
    const category = await createCategory();
    const attribute = await createAttribute();

    const firstResponse = await api(permittedAdmin).post(
      endpoint(category.id),
      {
        attributeId: attribute.id,
        scope: "PRODUCT",
      },
    );

    expectStatus(firstResponse, 201);

    await trackAssignment(category.id, attribute.id);

    const secondResponse = await api(permittedAdmin).post(
      endpoint(category.id),
      {
        attributeId: attribute.id,
        scope: "PRODUCT",
      },
    );

    expectStatus(secondResponse, 409);
  });

  it("rejects assigning an attribute already assigned to an ancestor category", async () => {
    const parent = await createCategory();
    const child = await createCategory({
      parentId: parent.id,
    });
    const attribute = await createAttribute();

    const parentResponse = await api(permittedAdmin).post(
      endpoint(parent.id),
      {
        attributeId: attribute.id,
        scope: "PRODUCT",
      },
    );

    expectStatus(parentResponse, 201);

    await trackAssignment(parent.id, attribute.id);

    const childResponse = await api(permittedAdmin).post(
      endpoint(child.id),
      {
        attributeId: attribute.id,
        scope: "PRODUCT",
      },
    );

    expectStatus(childResponse, 409);
  });

  it("rejects assigning an attribute already assigned to a descendant category", async () => {
    const parent = await createCategory();
    const child = await createCategory({
      parentId: parent.id,
    });
    const attribute = await createAttribute();

    const childResponse = await api(permittedAdmin).post(
      endpoint(child.id),
      {
        attributeId: attribute.id,
        scope: "PRODUCT",
      },
    );

    expectStatus(childResponse, 201);

    await trackAssignment(child.id, attribute.id);

    const parentResponse = await api(permittedAdmin).post(
      endpoint(parent.id),
      {
        attributeId: attribute.id,
        scope: "PRODUCT",
      },
    );

    expectStatus(parentResponse, 409);
  });
});
