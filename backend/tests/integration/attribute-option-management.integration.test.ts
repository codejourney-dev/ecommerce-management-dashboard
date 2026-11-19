
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
      "Attribute Option API tests may run only against ecommerce_dashboard_migration_test.",
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

const OPTION_PERMISSIONS = [
  "attributes.options.view",
  "attributes.options.create",
  "attributes.options.update",
  "attributes.options.delete",
] as const;

type AuthContext = {
  adminId: string;
  accessToken: string;
  csrfToken: string;
  allowedOrigin: string;
};

const createdAttributeIds: string[] = [];
const createdOptionIds: string[] = [];
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
      email: `attribute-option-test-${suffix}@example.test`,
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
      userAgent: "vitest-attribute-option-management",
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

async function createAttributeDirect(
  input: {
    name?: string;
    slug?: string;
    inputType?: "TEXT" | "NUMBER" | "SELECT" | "MULTI_SELECT" | "BOOLEAN" | "DATE";
    isActive?: boolean;
  } = {},
) {
  const suffix = randomUUID();

  const attribute = await prisma.attribute.create({
    data: {
      name: input.name ?? `Option test attribute ${suffix}`,
      slug: input.slug ?? `option-test-attribute-${suffix}`,
      inputType: input.inputType ?? "SELECT",
      isActive: input.isActive ?? true,
    },
  });

  createdAttributeIds.push(attribute.id);
  return attribute;
}

async function createOptionDirect(
  attributeId: string,
  input: {
    label?: string;
    value?: string;
    position?: number;
    isActive?: boolean;
  } = {},
) {
  const suffix = randomUUID();

  const option = await prisma.attributeOption.create({
    data: {
      attributeId,
      label: input.label ?? `Option ${suffix}`,
      value: input.value ?? `option-${suffix}`,
      position: input.position ?? 0,
      isActive: input.isActive ?? true,
    },
  });

  createdOptionIds.push(option.id);
  return option;
}

async function assignPermissionSetToAdmin(adminId: string) {
  const suffix = randomUUID();

  const role = await prisma.role.create({
    data: {
      name: `attr-option-test-${suffix.slice(0, 8)}`,
      description: "Temporary role for attribute option integration tests",
    },
  });

  createdRoleIds.push(role.id);

  const permissions = await Promise.all(
    OPTION_PERMISSIONS.map((name) =>
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

function optionsPath(attributeId: string) {
  return `/api/attributes/${attributeId}/options`;
}

beforeAll(async () => {
  const admin = await createAdmin("Attribute Option Integration Admin");
  await assignPermissionSetToAdmin(admin.id);
  permittedAdmin = await createAuthContext(admin.id);

  const noPermissionAdmin = await createAdmin(
    "Attribute Option Restricted Admin",
  );
  restrictedAdmin = await createAuthContext(noPermissionAdmin.id);
});

afterEach(async () => {
  if (createdOptionIds.length) {
    await prisma.attributeOption.deleteMany({
      where: { id: { in: createdOptionIds.splice(0) } },
    });
  }

  if (createdAttributeIds.length) {
    await prisma.attribute.deleteMany({
      where: { id: { in: createdAttributeIds.splice(0) } },
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

describe("Attribute Option Management API", () => {
  it("rejects requests without an access token", async () => {
    const attribute = await createAttributeDirect();

    const response = await request(app).get(
      optionsPath(attribute.id),
    );

    expectStatus(response, 401);
  });

  it("rejects an authenticated admin without attributes.options.view permission", async () => {
    const attribute = await createAttributeDirect();

    const response = await api(restrictedAdmin).get(
      optionsPath(attribute.id),
    );

    expectStatus(response, 403);
  });

  it("rejects a mutation without a valid CSRF token", async () => {
    const attribute = await createAttributeDirect();

    const response = await request(app)
      .post(optionsPath(attribute.id))
      .set("Authorization", `Bearer ${permittedAdmin.accessToken}`)
      .set("Origin", permittedAdmin.allowedOrigin)
      .send({
        label: "CSRF blocked option",
        value: `csrf-blocked-${randomUUID()}`,
      });

    expectStatus(response, 403);
  });

  it("creates an option for a SELECT attribute", async () => {
    const attribute = await createAttributeDirect({
      inputType: "SELECT",
    });

    const label = "Red";
    const value = `red-${randomUUID()}`;

    const response = await api(permittedAdmin).post(
      optionsPath(attribute.id),
      { label, value, position: 0 },
    );

    expectStatus(response, 201);

    const stored = await prisma.attributeOption.findFirst({
      where: { attributeId: attribute.id, value },
    });

    expect(stored).not.toBeNull();
    expect(stored?.label).toBe(label);
    expect(stored?.position).toBe(0);

    if (stored) createdOptionIds.push(stored.id);
  });

  it("creates an option for a MULTI_SELECT attribute", async () => {
    const attribute = await createAttributeDirect({
      inputType: "MULTI_SELECT",
    });

    const value = `cotton-${randomUUID()}`;

    const response = await api(permittedAdmin).post(
      optionsPath(attribute.id),
      { label: "Cotton", value },
    );

    expectStatus(response, 201);

    const stored = await prisma.attributeOption.findFirst({
      where: { attributeId: attribute.id, value },
    });

    expect(stored).not.toBeNull();

    if (stored) createdOptionIds.push(stored.id);
  });

  it("rejects creating an option for a TEXT attribute", async () => {
    const attribute = await createAttributeDirect({
      inputType: "TEXT",
    });

    const response = await api(permittedAdmin).post(
      optionsPath(attribute.id),
      {
        label: "Invalid option",
        value: `invalid-${randomUUID()}`,
      },
    );

    expectStatus(response, 409);
  });

  it("rejects creating an option with a duplicate value in the same attribute", async () => {
    const attribute = await createAttributeDirect();
    const existing = await createOptionDirect(attribute.id);

    const response = await api(permittedAdmin).post(
      optionsPath(attribute.id),
      {
        label: "Duplicate value",
        value: existing.value,
      },
    );

    expectStatus(response, 409);
  });

  it("lists options belonging to an attribute", async () => {
    const attribute = await createAttributeDirect();
    const first = await createOptionDirect(attribute.id);
    const second = await createOptionDirect(attribute.id);

    const response = await api(permittedAdmin).get(
      optionsPath(attribute.id),
    );

    expectStatus(response, 200);

    const returned = JSON.stringify(response.body);
    expect(returned).toContain(first.id);
    expect(returned).toContain(second.id);
  });

  it("gets an option by ID", async () => {
    const attribute = await createAttributeDirect();
    const option = await createOptionDirect(attribute.id);

    const response = await api(permittedAdmin).get(
      `${optionsPath(attribute.id)}/${option.id}`,
    );

    expectStatus(response, 200);
    expect(JSON.stringify(response.body)).toContain(option.id);
  });

  it("returns 404 when an option does not belong to the requested attribute", async () => {
    const firstAttribute = await createAttributeDirect();
    const secondAttribute = await createAttributeDirect();
    const option = await createOptionDirect(firstAttribute.id);

    const response = await api(permittedAdmin).get(
      `${optionsPath(secondAttribute.id)}/${option.id}`,
    );

    expectStatus(response, 404);
  });

  it("updates an option label and value", async () => {
    const attribute = await createAttributeDirect();
    const option = await createOptionDirect(attribute.id);

    const newLabel = `Updated label ${randomUUID()}`;
    const newValue = `updated-value-${randomUUID()}`;

    const response = await api(permittedAdmin).patch(
      `${optionsPath(attribute.id)}/${option.id}`,
      {
        label: newLabel,
        value: newValue,
      },
    );

    expectStatus(response, 200);

    const stored = await prisma.attributeOption.findUnique({
      where: { id: option.id },
    });

    expect(stored?.label).toBe(newLabel);
    expect(stored?.value).toBe(newValue);
  });

  it("rejects updating an option to another option's value in the same attribute", async () => {
    const attribute = await createAttributeDirect();
    const first = await createOptionDirect(attribute.id);
    const second = await createOptionDirect(attribute.id);

    const response = await api(permittedAdmin).patch(
      `${optionsPath(attribute.id)}/${first.id}`,
      { value: second.value },
    );

    expectStatus(response, 409);
  });

  it("updates an option position", async () => {
    const attribute = await createAttributeDirect();
    const option = await createOptionDirect(attribute.id, {
      position: 0,
    });

    const response = await api(permittedAdmin).patch(
      `${optionsPath(attribute.id)}/${option.id}`,
      { position: 5 },
    );

    expectStatus(response, 200);

    const stored = await prisma.attributeOption.findUnique({
      where: { id: option.id },
    });

    expect(stored?.position).toBe(5);
  });

  it("deactivates and reactivates an option", async () => {
    const attribute = await createAttributeDirect();
    const option = await createOptionDirect(attribute.id, {
      isActive: true,
    });

    const deactivate = await api(permittedAdmin).patch(
      `${optionsPath(attribute.id)}/${option.id}/status`,
      { isActive: false },
    );

    expectStatus(deactivate, 200);

    let stored = await prisma.attributeOption.findUnique({
      where: { id: option.id },
    });

    expect(stored?.isActive).toBe(false);

    const activate = await api(permittedAdmin).patch(
      `${optionsPath(attribute.id)}/${option.id}/status`,
      { isActive: true },
    );

    expectStatus(activate, 200);

    stored = await prisma.attributeOption.findUnique({
      where: { id: option.id },
    });

    expect(stored?.isActive).toBe(true);
  });

  it("reorders options according to the supplied IDs", async () => {
    const attribute = await createAttributeDirect();

    const first = await createOptionDirect(attribute.id, {
      position: 0,
    });
    const second = await createOptionDirect(attribute.id, {
      position: 1,
    });
    const third = await createOptionDirect(attribute.id, {
      position: 2,
    });

    const response = await api(permittedAdmin).patch(
      `${optionsPath(attribute.id)}/reorder`,
      {
        optionIds: [third.id, first.id, second.id],
      },
    );

    expectStatus(response, 200);

    const stored = await prisma.attributeOption.findMany({
      where: { attributeId: attribute.id },
      orderBy: { position: "asc" },
    });

    expect(stored.map((item) => item.id)).toEqual([
      third.id,
      first.id,
      second.id,
    ]);
  });

  it("rejects reordering with duplicate option IDs", async () => {
    const attribute = await createAttributeDirect();
    const first = await createOptionDirect(attribute.id);
    const second = await createOptionDirect(attribute.id);

    const response = await api(permittedAdmin).patch(
      `${optionsPath(attribute.id)}/reorder`,
      {
        optionIds: [first.id, first.id, second.id],
      },
    );

    expectStatus(response, 400);
  });

  it("rejects reordering when the supplied IDs do not match the attribute's options", async () => {
    const attribute = await createAttributeDirect();
    const first = await createOptionDirect(attribute.id);
    const second = await createOptionDirect(attribute.id);
    const unrelated = randomUUID();

    const response = await api(permittedAdmin).patch(
      `${optionsPath(attribute.id)}/reorder`,
      {
        optionIds: [first.id, unrelated],
      },
    );

    expectStatus(response, 400);

    const stored = await prisma.attributeOption.findMany({
      where: { attributeId: attribute.id },
      orderBy: { position: "asc" },
    });

    expect(stored.map((item) => item.id)).toEqual([
      first.id,
      second.id,
    ]);
  });

  it("deletes an option that is not in use", async () => {
    const attribute = await createAttributeDirect();
    const option = await createOptionDirect(attribute.id);

    const response = await api(permittedAdmin).delete(
      `${optionsPath(attribute.id)}/${option.id}`,
    );

    expectStatus(response, 200);

    const stored = await prisma.attributeOption.findUnique({
      where: { id: option.id },
    });

    expect(stored).toBeNull();

    const index = createdOptionIds.indexOf(option.id);
    if (index >= 0) createdOptionIds.splice(index, 1);
  });

  it("returns 404 when updating an unknown option", async () => {
    const attribute = await createAttributeDirect();

    const response = await api(permittedAdmin).patch(
      `${optionsPath(attribute.id)}/${randomUUID()}`,
      { label: "Unknown option" },
    );

    expectStatus(response, 404);
  });

  it("returns 404 when deleting an unknown option", async () => {
    const attribute = await createAttributeDirect();

    const response = await api(permittedAdmin).delete(
      `${optionsPath(attribute.id)}/${randomUUID()}`,
    );

    expectStatus(response, 404);
  });
});
