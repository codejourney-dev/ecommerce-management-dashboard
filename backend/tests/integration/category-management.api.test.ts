
import { config } from "dotenv";
config({ path: ".env.test" });

import { randomUUID } from "node:crypto";
import {
    afterAll,
    beforeAll,
    describe,
    expect,
    it,
} from "vitest";
import request from "supertest";

// -----------------------------------------------------------------------------
// 1. Protect the test database
// -----------------------------------------------------------------------------

function assertTestDatabase(): void {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
        throw new Error("DATABASE_URL is required.");
    }

    const databaseName = new URL(databaseUrl).pathname;

    if (databaseName !== "/ecommerce_dashboard_migration_test") {
        throw new Error(
            "Refusing to run category integration tests outside the test database."
        );
    }
}

assertTestDatabase();

// -----------------------------------------------------------------------------
// 2. Import database-dependent modules after the database guard
// -----------------------------------------------------------------------------

const { prisma } = await import("../../src/config/prisma.js");

const { AdminStatus } = await import(
    "../../generated/prisma/client.js"
);

const { createSessionCsrfToken } = await import(
    "../../src/services/csrf.service.js"
);

const {
    createAccessToken,
    hashRefreshToken,
} = await import("../../src/services/token.service.js");

const { default: app } = await import("../../src/app.js");

// -----------------------------------------------------------------------------
// 3. Test types and fixtures
// -----------------------------------------------------------------------------

type AuthContext = {
    adminId: string;
    accessToken: string;
    csrfToken: string;
    allowedOrigin: string;
};

const adminIds: string[] = [];
const roleIds: string[] = [];
const categoryIds: string[] = [];
const productIds: string[] = [];
const permissionIds: string[] = [];

const categoryPermissions = [
    "categories.view",
    "categories.create",
    "categories.update",
    "categories.delete",
];

// -----------------------------------------------------------------------------
// 4. Create an authenticated admin
// -----------------------------------------------------------------------------

async function createAuthenticatedAdminContext(
    permissions: string[]
): Promise<AuthContext> {
    const uniqueId = randomUUID();

    const admin = await prisma.adminUser.create({
        data: {
            name: "Category Integration Test Admin",
            email: `category-${uniqueId}@example.test`,
            phone: `+989${uniqueId.replaceAll("-", "").slice(0, 10)}`,
            passwordHash: "integration-test-only",
            status: AdminStatus.ACTIVE,
            phoneVerifiedAt: new Date(),
        },
    });

    adminIds.push(admin.id);

    const role = await prisma.role.create({
        data: {
            name: `category-test-${uniqueId}`,
            description: "Category integration test role",
        },
    });

    roleIds.push(role.id);

    await prisma.adminUserRole.create({
        data: {
            adminUserId: admin.id,
            roleId: role.id,
        },
    });

    if (permissions.length > 0) {
    const permissionRecords = await Promise.all(
        permissions.map(async (permissionName) => {
            const existingPermission =
                await prisma.permission.findUnique({
                    where: {
                        name: permissionName,
                    },
                });

            if (existingPermission) {
                return existingPermission;
            }

            const createdPermission =
                await prisma.permission.create({
                    data: {
                        name: permissionName,
                        description:
                            "Created by category integration tests.",
                    },
                });

            permissionIds.push(createdPermission.id);

            return createdPermission;
        })
    );

    await prisma.rolePermission.createMany({
        data: permissionRecords.map((permission) => ({
            roleId: role.id,
            permissionId: permission.id,
        })),
    });
}

    // Create a real authenticated session.
    const expiresAt = new Date(
        Date.now() + 60 * 60 * 1000
    );

    const session = await prisma.adminSession.create({
        data: {
            adminUserId: admin.id,
            refreshTokenHash: hashRefreshToken(randomUUID()),
            expiresAt,
            ipAddress: "127.0.0.1",
            userAgent: "vitest-category-integration",
        },
    });

    // Generate and persist a session-bound CSRF token.
    const csrf = createSessionCsrfToken(
        session.id,
        session.expiresAt
    );

    await prisma.adminSession.update({
        where: {
            id: session.id,
        },
        data: {
            csrfTokenHash: csrf.tokenHash,
        },
    });

    // Create a real access token.
    const accessToken = await createAccessToken(
        admin.id,
        session.id
    );

    const allowedOrigin = process.env.FRONTEND_ORIGINS
        ?.split(",")[0]
        ?.trim();

    if (!allowedOrigin) {
        throw new Error("FRONTEND_ORIGINS is not configured.");
    }

    return {
        adminId: admin.id,
        accessToken,
        csrfToken: csrf.token,
        allowedOrigin,
    };
}

// -----------------------------------------------------------------------------
// 5. Create category fixtures
// -----------------------------------------------------------------------------

async function createCategoryFixture(input?: {
    name?: string;
    slug?: string;
    parentId?: string | null;
    isActive?: boolean;
}) {
    const uniqueId = randomUUID();

    const category = await prisma.category.create({
        data: {
            name: input?.name ?? `Integration Category ${uniqueId}`,
            slug: input?.slug ?? `integration-category-${uniqueId}`,
            parentId: input?.parentId ?? null,
            isActive: input?.isActive ?? true,
        },
    });

    categoryIds.push(category.id);

    return category;
}

// -----------------------------------------------------------------------------
// 6. Create product fixtures
// -----------------------------------------------------------------------------

async function createProductFixture(categoryId: string) {
    const uniqueId = randomUUID();

    const product = await prisma.product.create({
        data: {
            name: `Integration Product ${uniqueId}`,
            slug: `integration-product-${uniqueId}`,
            description: "Created by category integration tests.",
        },
    });

    productIds.push(product.id);

    await prisma.productCategory.create({
        data: {
            productId: product.id,
            categoryId,
        },
    });

    return product;
}

// -----------------------------------------------------------------------------
// 7. Request helpers
// -----------------------------------------------------------------------------

function authenticatedRequest(
    method: "get" | "post" | "patch" | "delete",
    url: string,
    auth: AuthContext
) {
    const req = request(app)[method](url)
        .set("Authorization", `Bearer ${auth.accessToken}`);

    return req;
}

function csrfRequest(
    method: "post" | "patch" | "delete",
    url: string,
    auth: AuthContext
) {
    return authenticatedRequest(method, url, auth)
        .set("Origin", auth.allowedOrigin)
        .set("Cookie", `csrf_token=${auth.csrfToken}`)
        .set("x-csrf-token", auth.csrfToken);
}

// -----------------------------------------------------------------------------
// 8. Global test setup and cleanup
// -----------------------------------------------------------------------------

let adminAuth: AuthContext;
let restrictedAdminAuth: AuthContext;

beforeAll(async () => {
    adminAuth = await createAuthenticatedAdminContext(
        categoryPermissions
    );

    // This admin has a valid session but no category permissions.
    restrictedAdminAuth = await createAuthenticatedAdminContext([]);
});

afterAll(async () => {
    try {
        // Delete products first to remove their category associations.
        if (productIds.length > 0) {
            await prisma.product.deleteMany({
                where: {
                    id: {
                        in: productIds,
                    },
                },
            });
        }

        // Delete categories in reverse creation order.
        // This respects the parent relation's onDelete: Restrict rule.
        for (const categoryId of [...categoryIds].reverse()) {
            await prisma.category.deleteMany({
                where: {
                    id: categoryId,
                },
            });
        }

        // Delete admins and their dependent sessions.
        if (adminIds.length > 0) {
            await prisma.adminUser.deleteMany({
                where: {
                    id: {
                        in: adminIds,
                    },
                },
            });
        }

        // Deleting roles also removes their role-permission associations.
        if (roleIds.length > 0) {
            await prisma.role.deleteMany({
                where: {
                    id: {
                        in: roleIds,
                    },
                },
            });
        }

        if (permissionIds.length > 0) {
            await prisma.permission.deleteMany({
                where: {
                    id: {
                        in: permissionIds,
                    },
                },
            });
        }
    } finally {
        await prisma.$disconnect();
    }
});

// ============================================================================
// CATEGORY MANAGEMENT API TESTS
// ============================================================================

describe("Category Management API", () => {

    // -------------------------------------------------------------------------
    // Authentication and authorization
    // -------------------------------------------------------------------------

    describe("Authentication and authorization", () => {

        it("should reject requests without authentication", async () => {
            const response = await request(app)
                .get("/api/categories");

            expect(response.status).toBe(401);
            expect(response.body.status).toBe("error");
        });

        it("should reject an authenticated admin without category permission", async () => {
            const response = await authenticatedRequest(
                "get",
                "/api/categories",
                restrictedAdminAuth
            );

            expect(response.status).toBe(403);
            expect(response.body.status).toBe("error");
        });

        it("should reject category creation without a valid CSRF token", async () => {
            const response = await authenticatedRequest(
                "post",
                "/api/categories",
                adminAuth
            )
                .set("Origin", adminAuth.allowedOrigin)
                .send({
                    name: "CSRF Test Category",
                    slug: `csrf-test-${randomUUID()}`,
                });

            expect(response.status).toBe(403);
            expect(response.body.status).toBe("error");
        });
    });

    // -------------------------------------------------------------------------
    // Create category
    // -------------------------------------------------------------------------

    describe("POST /api/categories", () => {

        it("should create a category successfully", async () => {
            const uniqueId = randomUUID();

            const response = await csrfRequest(
                "post",
                "/api/categories",
                adminAuth
            ).send({
                name: `Created Category ${uniqueId}`,
                slug: `created-category-${uniqueId}`,
                description: "Category integration test",
                isActive: true,
            });

            expect(response.status).toBe(201);
            expect(response.body.status).toBe("success");

            expect(response.body.data).toMatchObject({
                name: `Created Category ${uniqueId}`,
                slug: `created-category-${uniqueId}`,
                isActive: true,
            });

            categoryIds.push(response.body.data.id);

            const savedCategory = await prisma.category.findUnique({
                where: {
                    id: response.body.data.id,
                },
            });

            expect(savedCategory).not.toBeNull();
        });

        it("should create a child category under an active parent", async () => {
            const parent = await createCategoryFixture();

            const uniqueId = randomUUID();

            const response = await csrfRequest(
                "post",
                "/api/categories",
                adminAuth
            ).send({
                name: `Child Category ${uniqueId}`,
                slug: `child-category-${uniqueId}`,
                parentId: parent.id,
            });

            expect(response.status).toBe(201);
            expect(response.body.data.parentId).toBe(parent.id);

            categoryIds.push(response.body.data.id);
        });

        it("should reject a category with an invalid name", async () => {
            const response = await csrfRequest(
                "post",
                "/api/categories",
                adminAuth
            ).send({
                name: " ",
                slug: `invalid-name-${randomUUID()}`,
            });

            expect(response.status).toBe(400);
            expect(response.body.status).toBe("error");
        });

        it("should reject duplicate category slugs", async () => {
            const existing = await createCategoryFixture();

            const response = await csrfRequest(
                "post",
                "/api/categories",
                adminAuth
            ).send({
                name: "Duplicate Slug Category",
                slug: existing.slug,
            });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe("CATEGORY_SLUG_EXISTS");
        });

        it("should reject creating an active category under an inactive parent", async () => {
            const inactiveParent = await createCategoryFixture({
                isActive: false,
            });

            const response = await csrfRequest(
                "post",
                "/api/categories",
                adminAuth
            ).send({
                name: "Active Child Under Inactive Parent",
                slug: `inactive-parent-child-${randomUUID()}`,
                parentId: inactiveParent.id,
                isActive: true,
            });

            expect(response.status).toBe(400);
            expect(response.body.code).toBe("PARENT_CATEGORY_INACTIVE");
        });
    });

    // -------------------------------------------------------------------------
    // List categories
    // -------------------------------------------------------------------------

    describe("GET /api/categories", () => {

        it("should return categories with pagination information", async () => {
            const marker = randomUUID();

            const first = await createCategoryFixture({
                name: `List Test ${marker} A`,
                slug: `list-test-${marker}-a`,
            });

            const second = await createCategoryFixture({
                name: `List Test ${marker} B`,
                slug: `list-test-${marker}-b`,
            });

            const response = await authenticatedRequest(
                "get",
                `/api/categories?search=${marker}&page=1&limit=1`,
                adminAuth
            );

            expect(response.status).toBe(200);
            expect(response.body.status).toBe("success");

            expect(response.body.data.categories).toHaveLength(1);
            expect(response.body.data.pagination).toMatchObject({
                page: 1,
                limit: 1,
                total: 2,
                totalPages: 2,
            });

            expect(
                [first.id, second.id]
            ).toContain(response.body.data.categories[0].id);
        });

        it("should filter categories by active status", async () => {
            const active = await createCategoryFixture({
                isActive: true,
            });

            await createCategoryFixture({
                isActive: false,
            });

            const response = await authenticatedRequest(
                "get",
                "/api/categories?isActive=true",
                adminAuth
            );

            expect(response.status).toBe(200);

            expect(
                response.body.data.categories.some(
                    (category: { id: string }) => category.id === active.id
                )
            ).toBe(true);

            expect(
                response.body.data.categories.every(
                    (category: { isActive: boolean }) => category.isActive
                )
            ).toBe(true);
        });
    });

    // -------------------------------------------------------------------------
    // Category tree
    // -------------------------------------------------------------------------

    describe("GET /api/categories/tree", () => {

        it("should return a nested category tree", async () => {
            const root = await createCategoryFixture();
            const child = await createCategoryFixture({
                parentId: root.id,
            });
            const grandchild = await createCategoryFixture({
                parentId: child.id,
            });

            const response = await authenticatedRequest(
                "get",
                "/api/categories/tree",
                adminAuth
            );

            expect(response.status).toBe(200);
            expect(response.body.status).toBe("success");

            const rootNode = response.body.data.find(
                (category: { id: string }) => category.id === root.id
            );

            expect(rootNode).toBeDefined();
            expect(rootNode.children).toHaveLength(1);
            expect(rootNode.children[0].id).toBe(child.id);

            expect(rootNode.children[0].children).toHaveLength(1);
            expect(rootNode.children[0].children[0].id).toBe(grandchild.id);
        });
    });

    // -------------------------------------------------------------------------
    // Get category by ID
    // -------------------------------------------------------------------------

    describe("GET /api/categories/:id", () => {

        it("should return a category by ID", async () => {
            const category = await createCategoryFixture();

            const response = await authenticatedRequest(
                "get",
                `/api/categories/${category.id}`,
                adminAuth
            );

            expect(response.status).toBe(200);
            expect(response.body.data.id).toBe(category.id);
        });

        it("should return 404 for a category that does not exist", async () => {
            const response = await authenticatedRequest(
                "get",
                `/api/categories/${randomUUID()}`,
                adminAuth
            );

            expect(response.status).toBe(404);
            expect(response.body.code).toBe("CATEGORY_NOT_FOUND");
        });

        it("should reject an invalid category ID", async () => {
            const response = await authenticatedRequest(
                "get",
                "/api/categories/invalid-id",
                adminAuth
            );

            expect(response.status).toBe(400);
            expect(response.body.code).toBe("INVALID_CATEGORY_ID");
        });
    });

    // -------------------------------------------------------------------------
    // Update category
    // -------------------------------------------------------------------------

    describe("PATCH /api/categories/:id", () => {

        it("should update category fields", async () => {
            const category = await createCategoryFixture();

            const response = await csrfRequest(
                "patch",
                `/api/categories/${category.id}`,
                adminAuth
            ).send({
                name: "Updated Category Name",
                description: "Updated description",
            });

            expect(response.status).toBe(200);
            expect(response.body.data.name).toBe("Updated Category Name");
            expect(response.body.data.description).toBe("Updated description");
        });

        it("should reject assigning a category as its own parent", async () => {
            const category = await createCategoryFixture();

            const response = await csrfRequest(
                "patch",
                `/api/categories/${category.id}`,
                adminAuth
            ).send({
                parentId: category.id,
            });

            expect(response.status).toBe(400);
            expect(response.body.code).toBe("CATEGORY_SELF_PARENT");
        });

        it("should prevent moving a category under one of its descendants", async () => {
            const parent = await createCategoryFixture();

            const child = await createCategoryFixture({
                parentId: parent.id,
            });

            const response = await csrfRequest(
                "patch",
                `/api/categories/${parent.id}`,
                adminAuth
            ).send({
                parentId: child.id,
            });

            expect(response.status).toBe(400);
            expect(response.body.code).toBe("CATEGORY_HIERARCHY_CYCLE");
        });

        it("should reject an update that creates a duplicate slug", async () => {
            const first = await createCategoryFixture();
            const second = await createCategoryFixture();

            const response = await csrfRequest(
                "patch",
                `/api/categories/${second.id}`,
                adminAuth
            ).send({
                slug: first.slug,
            });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe("CATEGORY_SLUG_EXISTS");
        });
    });

    // -------------------------------------------------------------------------
    // Category status preview and update
    // -------------------------------------------------------------------------

    describe("Category status management", () => {

        it("should preview the descendants and affected products", async () => {
            const root = await createCategoryFixture();
            const child = await createCategoryFixture({
                parentId: root.id,
            });
            const grandchild = await createCategoryFixture({
                parentId: child.id,
            });

            await createProductFixture(child.id);
            await createProductFixture(grandchild.id);

            const response = await authenticatedRequest(
                "get",
                `/api/categories/${root.id}/status-preview`,
                adminAuth
            );

            expect(response.status).toBe(200);

            expect(response.body.data.descendantCount).toBe(2);
            expect(response.body.data.affectedProductCount).toBe(2);
            expect(response.body.data.descendants).toHaveLength(2);
            expect(response.body.data.note).toContain(
                "another active category path"
            );
        });

        it("should deactivate the category and all descendants", async () => {
            const root = await createCategoryFixture();
            const child = await createCategoryFixture({
                parentId: root.id,
            });
            const grandchild = await createCategoryFixture({
                parentId: child.id,
            });

            const response = await csrfRequest(
                "patch",
                `/api/categories/${root.id}/status`,
                adminAuth
            ).send({
                isActive: false,
            });

            expect(response.status).toBe(200);

            const categories = await prisma.category.findMany({
                where: {
                    id: {
                        in: [root.id, child.id, grandchild.id],
                    },
                },
                select: {
                    id: true,
                    isActive: true,
                },
            });

            expect(categories).toHaveLength(3);
            expect(
                categories.every((category) => !category.isActive)
            ).toBe(true);
        });

        it("should reactivate only the selected parent category", async () => {
            const root = await createCategoryFixture({
                isActive: false,
            });

            const child = await createCategoryFixture({
                parentId: root.id,
                isActive: false,
            });

            const response = await csrfRequest(
                "patch",
                `/api/categories/${root.id}/status`,
                adminAuth
            ).send({
                isActive: true,
            });

            expect(response.status).toBe(200);

            const savedRoot = await prisma.category.findUnique({
                where: { id: root.id },
            });

            const savedChild = await prisma.category.findUnique({
                where: { id: child.id },
            });

            expect(savedRoot?.isActive).toBe(true);
            expect(savedChild?.isActive).toBe(false);
        });
    });

    // -------------------------------------------------------------------------
    // Category deletion preview and deletion
    // -------------------------------------------------------------------------

    describe("Category deletion", () => {

        it("should preview an empty category tree as deletable", async () => {
            const root = await createCategoryFixture();
            const child = await createCategoryFixture({
                parentId: root.id,
            });

            const response = await authenticatedRequest(
                "get",
                `/api/categories/${root.id}/delete-preview`,
                adminAuth
            );

            expect(response.status).toBe(200);

            expect(response.body.data.canDelete).toBe(true);
            expect(response.body.data.descendantCount).toBe(1);
            expect(response.body.data.productCount).toBe(0);
            expect(response.body.data.blockers.products).toBe(false);
            expect(response.body.data.descendants).toHaveLength(1);
            expect(response.body.data.descendants[0].id).toBe(child.id);
        });

        it("should block deletion when a product exists in the subtree", async () => {
            const root = await createCategoryFixture();
            const child = await createCategoryFixture({
                parentId: root.id,
            });

            const product = await createProductFixture(child.id);

            const previewResponse = await authenticatedRequest(
                "get",
                `/api/categories/${root.id}/delete-preview`,
                adminAuth
            );

            expect(previewResponse.status).toBe(200);
            expect(previewResponse.body.data.canDelete).toBe(false);
            expect(previewResponse.body.data.productCount).toBe(1);
            expect(previewResponse.body.data.blockers.products).toBe(true);

            const deleteResponse = await csrfRequest(
                "delete",
                `/api/categories/${root.id}`,
                adminAuth
            );

            expect(deleteResponse.status).toBe(409);
            expect(deleteResponse.body.code).toBe("CATEGORY_HAS_PRODUCTS");

            // Neither category nor product must be deleted.
            const savedRoot = await prisma.category.findUnique({
                where: { id: root.id },
            });

            const savedChild = await prisma.category.findUnique({
                where: { id: child.id },
            });

            const savedProduct = await prisma.product.findUnique({
                where: { id: product.id },
            });

            expect(savedRoot).not.toBeNull();
            expect(savedChild).not.toBeNull();
            expect(savedProduct).not.toBeNull();
        });

        it("should delete an empty category tree from descendants to root", async () => {
            const root = await createCategoryFixture();
            const child = await createCategoryFixture({
                parentId: root.id,
            });
            const grandchild = await createCategoryFixture({
                parentId: child.id,
            });

            const previewResponse = await authenticatedRequest(
                "get",
                `/api/categories/${root.id}/delete-preview`,
                adminAuth
            );

            expect(previewResponse.status).toBe(200);
            expect(previewResponse.body.data.canDelete).toBe(true);
            expect(previewResponse.body.data.descendantCount).toBe(2);

            const deleteResponse = await csrfRequest(
                "delete",
                `/api/categories/${root.id}`,
                adminAuth
            );

            expect(deleteResponse.status).toBe(200);
            expect(deleteResponse.body.status).toBe("success");

            expect(deleteResponse.body.data.deletedCount).toBe(3);

            expect(deleteResponse.body.data.deletedCategoryIds).toEqual(
                expect.arrayContaining([
                    root.id,
                    child.id,
                    grandchild.id,
                ])
            );

            const remainingCategories = await prisma.category.count({
                where: {
                    id: {
                        in: [root.id, child.id, grandchild.id],
                    },
                },
            });

            expect(remainingCategories).toBe(0);
        });
    });
});
