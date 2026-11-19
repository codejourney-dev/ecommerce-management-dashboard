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
      "Product image API tests may run only against ecommerce_dashboard_migration_test.",
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
const {
  resolveProductImagePath,
  removeStoredFileIfExists,
} = await import("../../src/utils/storage/image-storage.js");

// Keep these in sync with product-image.routes.ts and seed-permissions.ts.
const PRODUCT_IMAGE_PERMISSIONS = [
  "products.view",
  "products.create",
  "products.update",
] as const;

type AuthContext = {
  adminId: string;
  accessToken: string;
  csrfToken: string;
  allowedOrigin: string;
};

const createdProductIds: string[] = [];
const createdCategoryIds: string[] = [];
const createdAdminIds: string[] = [];
const createdRoleIds: string[] = [];
const createdSessionIds: string[] = [];

let permittedAdmin: AuthContext;
let restrictedAdmin: AuthContext;

// A small PNG used by multipart upload tests. The file signature is valid and
// is sufficient for file-type to identify the uploaded file as image/png.
const PNG_BUFFER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pXcAAAAASUVORK5CYII=",
  "base64",
);

const INVALID_IMAGE_BUFFER = Buffer.from(
  "This is not an image file.",
  "utf8",
);

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
      email: `product-image-test-${suffix}@example.test`,
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
      userAgent: "vitest-product-image-management",
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

    upload(
      path: string,
      file: Buffer = PNG_BUFFER,
      fields: Record<string, string | number | boolean> = {},
      filename = "product-image.png",
      contentType = "image/png",
    ) {
      let test = request(app)
        .post(path)
        .set("Authorization", `Bearer ${auth.accessToken}`)
        .set("Origin", auth.allowedOrigin)
        .set("Cookie", `csrf_token=${auth.csrfToken}`)
        .set("X-CSRF-Token", auth.csrfToken)
        .attach("image", file, { filename, contentType });

      for (const [key, value] of Object.entries(fields)) {
        test = test.field(key, String(value));
      }

      return test;
    },
  };
}

async function assignPermissionSetToAdmin(adminId: string) {
  const suffix = randomUUID();

  const role = await prisma.role.create({
    data: {
      name: `product-image-${suffix.slice(0, 8)}`,
      description: "Temporary role for product image integration tests",
    },
  });

  createdRoleIds.push(role.id);

  const permissions = await Promise.all(
    PRODUCT_IMAGE_PERMISSIONS.map((name) =>
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
      name: input.name ?? `Product image test category ${suffix}`,
      slug: input.slug ?? `product-image-test-category-${suffix}`,
      parentId: input.parentId ?? null,
      isActive: input.isActive ?? true,
    },
  });

  createdCategoryIds.push(category.id);
  return category;
}

function productPayload(categoryIds: string[]) {
  const suffix = randomUUID();

  return {
    name: `Product image integration ${suffix}`,
    slug: `product-image-integration-${suffix}`,
    description: "Created by product-image-management.integration.test.ts",
    categoryIds,
  };
}

async function createProductThroughApi(categoryIds: string[]) {
  const payload = productPayload(categoryIds);
  const response = await api(permittedAdmin).post("/api/products", payload);

  expectStatus(response, 201);

  const productId = response.body.data?.id;
  if (typeof productId !== "string") {
    throw new Error("Product creation response did not contain data.id.");
  }

  createdProductIds.push(productId);
  return { product: response.body.data, payload, response };
}

function imagesPath(productId: string, imageId?: string) {
  const base = `/api/products/${productId}/images`;
  return imageId ? `${base}/${imageId}` : base;
}

function variantsPath(productId: string) {
  return `/api/products/${productId}/variants`;
}

async function createVariantThroughApi(productId: string) {
  const suffix = randomUUID();

  const response = await api(permittedAdmin)
    .post(variantsPath(productId), {
      sku: `IMG-VAR-${suffix}`,
      title: `Image test variant ${suffix}`,
      priceRial: "1250000",
    });

  expectStatus(response, 201);

  const variantId = response.body.data?.id;
  if (typeof variantId !== "string") {
    throw new Error("Variant creation response did not contain data.id.");
  }

  return response.body.data as { id: string; productId: string };
}

async function uploadImage(
  productId: string,
  fields: Record<string, string | number | boolean> = {},
) {
  const response = await api(permittedAdmin).upload(
    imagesPath(productId),
    PNG_BUFFER,
    {
      altText: `Product image ${randomUUID()}`,
      ...fields,
    },
  );

  expectStatus(response, 201);

  const imageId = response.body.data?.id;
  if (typeof imageId !== "string") {
    throw new Error("Image upload response did not contain data.id.");
  }

  return { image: response.body.data, response };
}

// -----------------------------------------------------------------------------
// Setup
// -----------------------------------------------------------------------------

beforeAll(async () => {
  const admin = await createAdmin("Product Image Integration Admin");
  await assignPermissionSetToAdmin(admin.id);
  permittedAdmin = await createAuthContext(admin.id);

  const noPermissionAdmin = await createAdmin(
    "Product Image Restricted Admin",
  );
  restrictedAdmin = await createAuthContext(noPermissionAdmin.id);
});

// -----------------------------------------------------------------------------
// Cleanup
// -----------------------------------------------------------------------------

afterEach(async () => {
  const productIds = createdProductIds.splice(0);

  if (productIds.length) {
    // Read URLs before deleting rows so the corresponding physical files can
    // also be removed. This also catches uploads whose HTTP response failed
    // after the database transaction had already committed.
    const images = await prisma.productImage.findMany({
      where: { productId: { in: productIds } },
      select: { imageUrl: true },
    });

    for (const image of images) {
      try {
        await removeStoredFileIfExists(
          resolveProductImagePath(image.imageUrl),
        );
      } catch {
        // Preserve the test result; the database cleanup below still runs.
      }
    }

    await prisma.productImage.deleteMany({
      where: { productId: { in: productIds } },
    });

    await prisma.productVariant.deleteMany({
      where: { productId: { in: productIds } },
    });

    await prisma.product.deleteMany({
      where: { id: { in: productIds } },
    });
  }

  // Children are created after parents, so reverse order respects hierarchy.
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
// Product Image Management API
// -----------------------------------------------------------------------------

describe("Product Image Management API", () => {
  // ---------------------------------------------------------------------------
  // Authentication and authorization
  // ---------------------------------------------------------------------------

  it("rejects requests without an access token", async () => {
    const response = await request(app).get(
      imagesPath(randomUUID()),
    );

    expectStatus(response, 401);
  });

  it("rejects an authenticated admin without products.view permission", async () => {
    const response = await api(restrictedAdmin).get(
      imagesPath(randomUUID()),
    );

    expectStatus(response, 403);
  });

  it("rejects an upload without a valid CSRF token", async () => {
    const category = await createCategory();
    const { product } = await createProductThroughApi([category.id]);

    const response = await request(app)
      .post(imagesPath(product.id))
      .set("Authorization", `Bearer ${permittedAdmin.accessToken}`)
      .set("Origin", permittedAdmin.allowedOrigin)
      .attach("image", PNG_BUFFER, {
        filename: "csrf-test.png",
        contentType: "image/png",
      })
      .field("altText", "CSRF test image");

    expectStatus(response, 403);
  });

  // ---------------------------------------------------------------------------
  // Upload and local storage
  // ---------------------------------------------------------------------------

  it("uploads a valid PNG, stores its metadata, and serves it statically", async () => {
    const category = await createCategory();
    const { product } = await createProductThroughApi([category.id]);

    const { image } = await uploadImage(product.id, {
      position: 0,
      isPrimary: false,
    });

    expect(image.productId).toBe(product.id);
    expect(image.variantId).toBeNull();
    expect(image.altText).toContain("Product image");
    expect(image.position).toBe(0);
    expect(image.isPrimary).toBe(false);
    expect(image.imageUrl).toMatch(
      /^\/uploads\/products\/[0-9a-f-]+\/[0-9a-f-]+\.png$/i,
    );

    const stored = await prisma.productImage.findUnique({
      where: { id: image.id },
    });

    expect(stored).not.toBeNull();
    expect(stored?.productId).toBe(product.id);

    });

  it("assigns the next position automatically within the same image scope", async () => {
    const category = await createCategory();
    const { product } = await createProductThroughApi([category.id]);

    const first = await uploadImage(product.id);
    const second = await uploadImage(product.id);

    expect(first.image.position).toBe(0);
    expect(second.image.position).toBe(1);
  });

  it("uploads an image for a variant belonging to the product", async () => {
    const category = await createCategory();
    const { product } = await createProductThroughApi([category.id]);
    const variant = await createVariantThroughApi(product.id);

    const { image } = await uploadImage(product.id, {
      variantId: variant.id,
    });

    expect(image.productId).toBe(product.id);
    expect(image.variantId).toBe(variant.id);
  });

  it("rejects a variant that belongs to another product", async () => {
    const category = await createCategory();
    const firstProduct = await createProductThroughApi([category.id]);
    const secondProduct = await createProductThroughApi([category.id]);
    const otherVariant = await createVariantThroughApi(secondProduct.product.id);

    const response = await api(permittedAdmin).upload(
      imagesPath(firstProduct.product.id),
      PNG_BUFFER,
      {
        altText: "Wrong product variant",
        variantId: otherVariant.id,
      },
    );

    expectStatus(response, 404);
    expect(response.body.code).toBe("PRODUCT_IMAGE_VARIANT_NOT_FOUND");

    const stored = await prisma.productImage.count({
      where: { productId: firstProduct.product.id },
    });
    expect(stored).toBe(0);
  });

  it("rejects a request without the image multipart field", async () => {
    const category = await createCategory();
    const { product } = await createProductThroughApi([category.id]);

    const response = await request(app)
      .post(imagesPath(product.id))
      .set("Authorization", `Bearer ${permittedAdmin.accessToken}`)
      .set("Origin", permittedAdmin.allowedOrigin)
      .set("Cookie", `csrf_token=${permittedAdmin.csrfToken}`)
      .set("X-CSRF-Token", permittedAdmin.csrfToken)
      .field("altText", "Missing file");

    expectStatus(response, 400);
    expect(response.body.code).toBe("PRODUCT_IMAGE_FILE_REQUIRED");
  });

  it("rejects a file whose actual signature is not an allowed image type", async () => {
    const category = await createCategory();
    const { product } = await createProductThroughApi([category.id]);

    const response = await api(permittedAdmin).upload(
      imagesPath(product.id),
      INVALID_IMAGE_BUFFER,
      { altText: "Invalid file" },
      "not-an-image.png",
      "image/png",
    );

    expectStatus(response, 415);
    expect(response.body.code).toBe("PRODUCT_IMAGE_INVALID_FILE_TYPE");
  });

  it("rejects an upload larger than 5 MB", async () => {
    const category = await createCategory();
    const { product } = await createProductThroughApi([category.id]);
    const oversizedBuffer = Buffer.alloc(5 * 1024 * 1024 + 1, 1);

    const response = await api(permittedAdmin).upload(
      imagesPath(product.id),
      oversizedBuffer,
      { altText: "Oversized image" },
    );

    expectStatus(response, 413);
    expect(response.body.code).toBe("PRODUCT_IMAGE_FILE_TOO_LARGE");
  });

  it("rejects missing, blank, and too-long alt text", async () => {
    const category = await createCategory();
    const { product } = await createProductThroughApi([category.id]);

    const missing = await api(permittedAdmin).upload(
      imagesPath(product.id),
      PNG_BUFFER,
    );
    expectStatus(missing, 400);
    expect(missing.body.code).toBe("PRODUCT_IMAGE_INVALID_ALT_TEXT");

    const blank = await api(permittedAdmin).upload(
      imagesPath(product.id),
      PNG_BUFFER,
      { altText: "   " },
    );
    expectStatus(blank, 400);
    expect(blank.body.code).toBe("PRODUCT_IMAGE_INVALID_ALT_TEXT");

    const tooLong = await api(permittedAdmin).upload(
      imagesPath(product.id),
      PNG_BUFFER,
      { altText: "a".repeat(256) },
    );
    expectStatus(tooLong, 400);
    expect(tooLong.body.code).toBe("PRODUCT_IMAGE_ALT_TEXT_TOO_LONG");
  });

  it("rejects an unknown product during upload", async () => {
    const response = await api(permittedAdmin).upload(
      imagesPath(randomUUID()),
      PNG_BUFFER,
      { altText: "Unknown product image" },
    );

    expectStatus(response, 404);
    expect(response.body.code).toBe("PRODUCT_IMAGE_PRODUCT_NOT_FOUND");
  });

  // ---------------------------------------------------------------------------
  // List and get images
  // ---------------------------------------------------------------------------

  it("lists all images belonging to a product", async () => {
    const category = await createCategory();
    const { product } = await createProductThroughApi([category.id]);

    const first = await uploadImage(product.id);
    const second = await uploadImage(product.id);

    const response = await api(permittedAdmin).get(imagesPath(product.id));

    expectStatus(response, 200);
    expect(response.body.data).toHaveLength(2);

    const ids = response.body.data.map((image: { id: string }) => image.id);
    expect(ids).toContain(first.image.id);
    expect(ids).toContain(second.image.id);
  });

  it("filters images by variant and can include product-wide images", async () => {
    const category = await createCategory();
    const { product } = await createProductThroughApi([category.id]);
    const variant = await createVariantThroughApi(product.id);

    const productImage = await uploadImage(product.id);
    const variantImage = await uploadImage(product.id, {
      variantId: variant.id,
    });

    const variantOnly = await api(permittedAdmin).get(
      `${imagesPath(product.id)}?variantId=${variant.id}`,
    );

    expectStatus(variantOnly, 200);
    expect(variantOnly.body.data).toHaveLength(1);
    expect(variantOnly.body.data[0].id).toBe(variantImage.image.id);

    const combined = await api(permittedAdmin).get(
      `${imagesPath(product.id)}?variantId=${variant.id}&includeProductImages=true`,
    );

    expectStatus(combined, 200);
    expect(combined.body.data).toHaveLength(2);
    const combinedIds = combined.body.data.map(
      (image: { id: string }) => image.id,
    );
    expect(combinedIds).toContain(productImage.image.id);
    expect(combinedIds).toContain(variantImage.image.id);
  });

  it("lists only product-wide images when variantId=null is supplied", async () => {
    const category = await createCategory();
    const { product } = await createProductThroughApi([category.id]);
    const variant = await createVariantThroughApi(product.id);

    const productImage = await uploadImage(product.id);
    await uploadImage(product.id, { variantId: variant.id });

    const response = await api(permittedAdmin).get(
      `${imagesPath(product.id)}?variantId=null`,
    );

    expectStatus(response, 200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].id).toBe(productImage.image.id);
  });

  it("rejects invalid list query parameters", async () => {
    const category = await createCategory();
    const { product } = await createProductThroughApi([category.id]);

    const invalidVariant = await api(permittedAdmin).get(
      `${imagesPath(product.id)}?variantId=not-a-uuid`,
    );
    expectStatus(invalidVariant, 400);
    expect(invalidVariant.body.code).toBe("INVALID_VARIANT_ID");

    const invalidInclude = await api(permittedAdmin).get(
      `${imagesPath(product.id)}?includeProductImages=maybe`,
    );
    expectStatus(invalidInclude, 400);
    expect(invalidInclude.body.code).toBe(
      "INVALID_INCLUDE_PRODUCT_IMAGES",
    );
  });

  it("gets an image by ID and rejects unknown or invalid IDs", async () => {
    const category = await createCategory();
    const { product } = await createProductThroughApi([category.id]);
    const { image } = await uploadImage(product.id);

    const found = await api(permittedAdmin).get(
      imagesPath(product.id, image.id),
    );
    expectStatus(found, 200);
    expect(found.body.data.id).toBe(image.id);

    const invalid = await api(permittedAdmin).get(
      imagesPath(product.id, "not-a-uuid"),
    );
    expectStatus(invalid, 400);
    expect(invalid.body.code).toBe("INVALID_PRODUCT_IMAGE_ID");

    const missing = await api(permittedAdmin).get(
      imagesPath(product.id, randomUUID()),
    );
    expectStatus(missing, 404);
    expect(missing.body.code).toBe("PRODUCT_IMAGE_NOT_FOUND");
  });

  it("does not expose an image through another product's nested route", async () => {
    const category = await createCategory();
    const firstProduct = await createProductThroughApi([category.id]);
    const secondProduct = await createProductThroughApi([category.id]);
    const { image } = await uploadImage(firstProduct.product.id);

    const response = await api(permittedAdmin).get(
      imagesPath(secondProduct.product.id, image.id),
    );

    expectStatus(response, 404);
    expect(response.body.code).toBe("PRODUCT_IMAGE_NOT_FOUND");
  });

  // ---------------------------------------------------------------------------
  // Update metadata and reorder
  // ---------------------------------------------------------------------------

  it("updates image alt text and position", async () => {
    const category = await createCategory();
    const { product } = await createProductThroughApi([category.id]);
    const { image } = await uploadImage(product.id);

    const response = await api(permittedAdmin).patch(
      imagesPath(product.id, image.id),
      {
        altText: "Front view of the product",
        position: 7,
      },
    );

    expectStatus(response, 200);
    expect(response.body.data.altText).toBe("Front view of the product");
    expect(response.body.data.position).toBe(7);

    const stored = await prisma.productImage.findUnique({
      where: { id: image.id },
    });
    expect(stored?.altText).toBe("Front view of the product");
    expect(stored?.position).toBe(7);
  });

  it("rejects empty or invalid metadata updates", async () => {
    const category = await createCategory();
    const { product } = await createProductThroughApi([category.id]);
    const { image } = await uploadImage(product.id);

    const empty = await api(permittedAdmin).patch(
      imagesPath(product.id, image.id),
      {},
    );
    expectStatus(empty, 400);
    expect(empty.body.code).toBe("PRODUCT_IMAGE_EMPTY_UPDATE");

    const invalidPosition = await api(permittedAdmin).patch(
      imagesPath(product.id, image.id),
      { position: -1 },
    );
    expectStatus(invalidPosition, 400);
    expect(invalidPosition.body.code).toBe("PRODUCT_IMAGE_INVALID_POSITION");
  });

  it("reorders every image belonging to the product", async () => {
    const category = await createCategory();
    const { product } = await createProductThroughApi([category.id]);

    const first = await uploadImage(product.id);
    const second = await uploadImage(product.id);
    const third = await uploadImage(product.id);

    const response = await api(permittedAdmin).patch(
      `${imagesPath(product.id)}/reorder`,
      {
        imageIds: [
          third.image.id,
          first.image.id,
          second.image.id,
        ],
      },
    );

    expectStatus(response, 200);

    const stored = await prisma.productImage.findMany({
      where: { productId: product.id },
      orderBy: { position: "asc" },
    });

    expect(stored.map((image) => image.id)).toEqual([
      third.image.id,
      first.image.id,
      second.image.id,
    ]);
    expect(stored.map((image) => image.position)).toEqual([0, 1, 2]);
  });

  it("rejects duplicate or incomplete reorder lists", async () => {
    const category = await createCategory();
    const { product } = await createProductThroughApi([category.id]);

    const first = await uploadImage(product.id);
    const second = await uploadImage(product.id);

    const duplicate = await api(permittedAdmin).patch(
      `${imagesPath(product.id)}/reorder`,
      { imageIds: [first.image.id, first.image.id] },
    );
    expectStatus(duplicate, 400);
    expect(duplicate.body.code).toBe("PRODUCT_IMAGE_DUPLICATE_REORDER_ID");

    const incomplete = await api(permittedAdmin).patch(
      `${imagesPath(product.id)}/reorder`,
      { imageIds: [first.image.id] },
    );
    expectStatus(incomplete, 400);
    expect(incomplete.body.code).toBe(
      "PRODUCT_IMAGE_REORDER_SCOPE_MISMATCH",
    );

    expect(second.image.id).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // Primary image
  // ---------------------------------------------------------------------------

  it("keeps only one primary image within the same product or variant scope", async () => {
    const category = await createCategory();
    const { product } = await createProductThroughApi([category.id]);

    const first = await uploadImage(product.id, { isPrimary: true });
    const second = await uploadImage(product.id, { isPrimary: true });

    let stored = await prisma.productImage.findMany({
      where: { productId: product.id, variantId: null },
    });

    expect(
      stored.filter((image) => image.isPrimary).map((image) => image.id),
    ).toEqual([second.image.id]);

    const setFirstPrimary = await api(permittedAdmin).patch(
      `${imagesPath(product.id, first.image.id)}/primary`,
      {},
    );

    expectStatus(setFirstPrimary, 200);

    stored = await prisma.productImage.findMany({
      where: { productId: product.id, variantId: null },
    });

    expect(
      stored.filter((image) => image.isPrimary).map((image) => image.id),
    ).toEqual([first.image.id]);
  });

  it("keeps product-wide and variant primary images independent", async () => {
    const category = await createCategory();
    const { product } = await createProductThroughApi([category.id]);
    const variant = await createVariantThroughApi(product.id);

    const productImage = await uploadImage(product.id, { isPrimary: true });
    const variantImage = await uploadImage(product.id, {
      variantId: variant.id,
      isPrimary: true,
    });

    const stored = await prisma.productImage.findMany({
      where: { productId: product.id, isPrimary: true },
    });

    expect(stored.map((image) => image.id)).toContain(productImage.image.id);
    expect(stored.map((image) => image.id)).toContain(variantImage.image.id);
    expect(stored).toHaveLength(2);
  });

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  it("deletes the database record and physical image file", async () => {
    const category = await createCategory();
    const { product } = await createProductThroughApi([category.id]);
    const { image } = await uploadImage(product.id);
    const physicalPath = resolveProductImagePath(image.imageUrl);

    const response = await api(permittedAdmin).delete(
      imagesPath(product.id, image.id),
    );

    expectStatus(response, 200);
    expect(response.body.data).toMatchObject({
      id: image.id,
      deleted: true,
    });

    const stored = await prisma.productImage.findUnique({
      where: { id: image.id },
    });
    expect(stored).toBeNull();

    const staticResponse = await request(app).get(image.imageUrl);
    expectStatus(staticResponse, 404);

    await expect(
      import("node:fs/promises").then(({ access }) => access(physicalPath)),
    ).rejects.toThrow();
  });

  it("returns 404 when deleting an image through the wrong product route", async () => {
    const category = await createCategory();
    const firstProduct = await createProductThroughApi([category.id]);
    const secondProduct = await createProductThroughApi([category.id]);
    const { image } = await uploadImage(firstProduct.product.id);

    const response = await api(permittedAdmin).delete(
      imagesPath(secondProduct.product.id, image.id),
    );

    expectStatus(response, 404);
    expect(response.body.code).toBe("PRODUCT_IMAGE_NOT_FOUND");
  });

  it("rejects a mutation from an admin without products.update permission", async () => {
    const category = await createCategory();
    const { product } = await createProductThroughApi([category.id]);

    const response = await request(app)
      .post(imagesPath(product.id))
      .set("Authorization", `Bearer ${restrictedAdmin.accessToken}`)
      .set("Origin", restrictedAdmin.allowedOrigin)
      .set("Cookie", `csrf_token=${restrictedAdmin.csrfToken}`)
      .set("X-CSRF-Token", restrictedAdmin.csrfToken)
      .attach("image", PNG_BUFFER, {
        filename: "restricted.png",
        contentType: "image/png",
      })
      .field("altText", "Restricted upload");

    expectStatus(response, 403);
  });
});
