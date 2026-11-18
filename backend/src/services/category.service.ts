// Category creation and editing include parent validation to prevent circular references.
// Activating a subcategory under an inactive parent is prohibited.
// Deactivating a category automatically deactivates all its subcategories.
// Reactivating a parent does not automatically reactivate its subcategories.
// A preview feature is available for deletion and deactivation actions.
// Deletion is permitted only if there are no blocking dependencies, such as products or attributes, within the entire subcategory tree.
// Subcategories are deleted in a bottom-up order, executed within a database transaction.

import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../config/prisma.js";

export class CategoryServiceError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly statusCode: number = 400
    ) {
        super(message);
        this.name = "CategoryServiceError";
    }
}

type DbClient = typeof prisma | Prisma.TransactionClient;

type CategoryTreeRow = {
    id: string;
    parentId: string | null;
    name: string;
    slug: string;
    isActive: boolean;
};

interface CategoryInput {
    name: string;
    slug: string;
    description?: string | null;
    imageUrl?: string | null;
    parentId?: string | null;
    isActive?: boolean;
}

interface CategoryUpdateInput {
    name?: string;
    slug?: string;
    description?: string | null;
    imageUrl?: string | null;
    parentId?: string | null;
}

interface CategoryListQuery {
    page?: number;
    limit?: number;
    search?: string;
    parentId?: string | null;
    isActive?: boolean;
}

async function getSubtree(
    client: DbClient,
    rootId: string
): Promise<CategoryTreeRow[]> {
    const categories = await client.category.findMany({
        select: {
            id: true,
            parentId: true,
            name: true,
            slug: true,
            isActive: true,
        },
    });
    const root = categories.find((category) => category.id === rootId);
    if (!root) {
        throw new CategoryServiceError(
            "Category not found.",
            "CATEGORY_NOT_FOUND",
            404
        );
    }
    const childrenMap = new Map<string, CategoryTreeRow[]>();
    for (const category of categories) {
        if (!category.parentId) continue;

        const children = childrenMap.get(category.parentId) ?? [];
        children.push(category);
        childrenMap.set(category.parentId, children);
    }
    const result: CategoryTreeRow[] = [];
    const visited = new Set<string>();
    const queue: CategoryTreeRow[] = [root];
    while (queue.length > 0) {
        const current = queue.shift()!;

        if (visited.has(current.id)) continue;

        visited.add(current.id);
        result.push(current);

        const children = childrenMap.get(current.id) ?? [];
        queue.push(...children);
    }
    return result;
}

// async function assertParentIsValid(
//     client: DbClient,
//     parentId: string | null | undefined,
//     isActive: boolean
// ): Promise<void> {
//     if (!parentId) return;
//     const parent = await client.category.findUnique({
//         where: { id: parentId },
//         select: {
//             id: true,
//             isActive: true,
//         },
//     });
//     if (!parent) {
//         throw new CategoryServiceError(
//             "Parent category not found.",
//             "PARENT_CATEGORY_NOT_FOUND",
//             404
//         );
//     }
//     if (isActive && !parent.isActive) {
//         throw new CategoryServiceError(
//             "An active category cannot have an inactive parent.",
//             "PARENT_CATEGORY_INACTIVE",
//             400
//         );
//     }
// }

async function assertParentIsValid(
    client: DbClient,
    parentId: string | null | undefined,
    isActive: boolean
): Promise<void> {
    let currentParentId = parentId;
    const visited = new Set<string>();

    while (currentParentId) {
        if (visited.has(currentParentId)) {
            throw new CategoryServiceError(
                "Invalid category hierarchy detected.",
                "CATEGORY_HIERARCHY_CYCLE",
                400
            );
        }

        visited.add(currentParentId);

        const parent = await client.category.findUnique({
            where: { id: currentParentId },
            select: {
                id: true,
                parentId: true,
                isActive: true,
            },
        });

        if (!parent) {
            throw new CategoryServiceError(
                "Parent category not found.",
                "PARENT_CATEGORY_NOT_FOUND",
                404
            );
        }

        if (isActive && !parent.isActive) {
            throw new CategoryServiceError(
                "An active category must have active parents throughout its hierarchy.",
                "PARENT_CATEGORY_INACTIVE",
                400
            );
        }

        currentParentId = parent.parentId;
    }
}


async function getDeletionDependencies(
    client: DbClient,
    categoryIds: string[]
) {
    const productLinks = await client.productCategory.findMany({
        where: {
            categoryId: { in: categoryIds },
        },
        select: {
            productId: true,
        },
        distinct: ["productId"],
    });
    const productAttributeValues = await client.productAttributeValue.count({
        where: {
            categoryAttribute: {
                categoryId: { in: categoryIds },
            },
        },
    });
    const variantAttributeValues = await client.variantAttributeValue.count({
        where: {
            categoryAttribute: {
                categoryId: { in: categoryIds },
            },
        },
    });
    return {
        productCount: productLinks.length,
        productAttributeValueCount: productAttributeValues,
        variantAttributeValueCount: variantAttributeValues,
    };
}

export async function createCategory(input: CategoryInput) {
    const isActive = input.isActive ?? true;
    await assertParentIsValid(
        prisma,
        input.parentId,
        isActive
    );
    try {
        return await prisma.category.create({
            data: {
                name: input.name.trim(),
                slug: input.slug.trim(),
                description: input.description ?? null,
                imageUrl: input.imageUrl ?? null,
                parentId: input.parentId ?? null,
                isActive,
            },
        });
    } catch (error) {
        if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002"
        ) {
            throw new CategoryServiceError(
                "A category with this slug already exists.",
                "CATEGORY_SLUG_EXISTS",
                409
            );
        }

        throw error;
    }
}

export async function listCategories(query: CategoryListQuery = {}) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 25));
    const skip = (page - 1) * limit;

    const where = {
        ...(query.isActive !== undefined
            ? { isActive: query.isActive }
            : {}),
        ...(query.parentId !== undefined
            ? { parentId: query.parentId }
            : {}),
        ...(query.search
            ? {
                OR: [
                    {
                        name: {
                            contains: query.search,
                            mode: "insensitive" as const,
                        },
                    },
                    {
                        slug: {
                            contains: query.search,
                            mode: "insensitive" as const,
                        },
                    },
                ],
            }
            : {}),
    };

    const [categories, total] = await prisma.$transaction([
        prisma.category.findMany({
            where,
            skip,
            take: limit,
            orderBy: [
                { parentId: "asc" },
                { name: "asc" },
            ],
            include: {
                _count: {
                    select: {
                        children: true,
                        productCategories: true,
                    },
                },
            },
        }),
        prisma.category.count({ where }),
    ]);

    return {
        categories,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
}

export async function getCategoryTree() {
    const categories = await prisma.category.findMany({
        orderBy: { name: "asc" },
        include: {
            _count: {
                select: {
                    children: true,
                    productCategories: true,
                },
            },
        },
    });

    type Node = (typeof categories)[number] & {
        children: Node[];
    };

    const nodeMap = new Map<string, Node>();

    for (const category of categories) {
        nodeMap.set(category.id, {
            ...category,
            children: [],
        });
    }

    const roots: Node[] = [];

    for (const category of categories) {
        const node = nodeMap.get(category.id)!;

        if (!category.parentId) {
            roots.push(node);
            continue;
        }

        const parent = nodeMap.get(category.parentId);

        if (parent) {
            parent.children.push(node);
        }
    }

    return roots;
}

export async function getCategoryById(id: string) {
    const category = await prisma.category.findUnique({
        where: { id },
        include: {
            parent: {
                select: {
                    id: true,
                    name: true,
                    slug: true,
                    isActive: true,
                },
            },
            children: {
                orderBy: { name: "asc" },
                select: {
                    id: true,
                    name: true,
                    slug: true,
                    isActive: true,
                },
            },
            _count: {
                select: {
                    children: true,
                    productCategories: true,
                    categoryAttributes: true,
                    categoryBrands: true,
                },
            },
        },
    });

    if (!category) {
        throw new CategoryServiceError(
            "Category not found.",
            "CATEGORY_NOT_FOUND",
            404
        );
    }

    return category;
}

export async function updateCategory(
    id: string,
    input: CategoryUpdateInput
) {
    try {
        return await prisma.$transaction(async (tx) => {
            const current = await tx.category.findUnique({
                where: { id },
            });

            if (!current) {
                throw new CategoryServiceError(
                    "Category not found.",
                    "CATEGORY_NOT_FOUND",
                    404
                );
            }

            if (input.parentId !== undefined) {
                if (input.parentId === id) {
                    throw new CategoryServiceError(
                        "A category cannot be its own parent.",
                        "CATEGORY_SELF_PARENT",
                        400
                    );
                }

                if (input.parentId !== null) {
                    const subtree = await getSubtree(tx, id);
                    const subtreeIds = new Set(
                        subtree.map((category) => category.id)
                    );

                    if (subtreeIds.has(input.parentId)) {
                        throw new CategoryServiceError(
                            "A category cannot be moved under one of its descendants.",
                            "CATEGORY_HIERARCHY_CYCLE",
                            400
                        );
                    }
                }

                await assertParentIsValid(
                    tx,
                    input.parentId,
                    current.isActive
                );
            }

            const updated = await tx.category.update({
                where: { id },
                data: {
                    ...(input.name !== undefined
                        ? { name: input.name.trim() }
                        : {}),
                    ...(input.slug !== undefined
                        ? { slug: input.slug.trim() }
                        : {}),
                    ...(input.description !== undefined
                        ? { description: input.description }
                        : {}),
                    ...(input.imageUrl !== undefined
                        ? { imageUrl: input.imageUrl }
                        : {}),
                    ...(input.parentId !== undefined
                        ? { parentId: input.parentId }
                        : {}),
                },
            });

            return updated;
        }, {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
    } catch (error) {
        if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002"
        ) {
            throw new CategoryServiceError(
                "A category with this slug already exists.",
                "CATEGORY_SLUG_EXISTS",
                409
            );
        }

        throw error;
    }
}

export async function getCategoryStatusPreview(id: string) {
    const subtree = await getSubtree(prisma, id);
    const categoryIds = subtree.map((category) => category.id);

    const productLinks = await prisma.productCategory.findMany({
        where: {
            categoryId: { in: categoryIds },
        },
        select: {
            productId: true,
        },
        distinct: ["productId"],
    });

    return {
        category: subtree[0],
        descendantCount: Math.max(0, subtree.length - 1),
        affectedProductCount: productLinks.length,
        descendants: subtree.slice(1),
        note:
            "Products linked to this category branch may no longer be visible through this branch. Products with another active category path may remain visible.",
    };
}

export async function updateCategoryStatus(
    id: string,
    isActive: boolean
) {
    return prisma.$transaction(async (tx) => {
        const subtree = await getSubtree(tx, id);
        const category = subtree[0];
        if (!category) {
            throw new Error("Category not found.");
        }
        if (isActive) {
            await assertParentIsValid(
                tx,
                category.parentId,
                true
            );

            // Reactivating a parent does not reactivate descendants.
            return tx.category.update({
                where: { id },
                data: { isActive: true },
            });
        }

        const categoryIds = subtree.map((item) => item.id);

        await tx.category.updateMany({
            where: {
                id: { in: categoryIds },
            },
            data: {
                isActive: false,
            },
        });

        return tx.category.findUniqueOrThrow({
            where: { id },
        });
    }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
}

export async function getCategoryDeletePreview(id: string) {
    const subtree = await getSubtree(prisma, id);
    const categoryIds = subtree.map((category) => category.id);

    const dependencies = await getDeletionDependencies(
        prisma,
        categoryIds
    );

    const hasBlockingDependencies =
        dependencies.productCount > 0 ||
        dependencies.productAttributeValueCount > 0 ||
        dependencies.variantAttributeValueCount > 0;

    return {
        category: subtree[0],
        descendants: subtree.slice(1),
        descendantCount: subtree.length - 1,
        ...dependencies,
        canDelete: !hasBlockingDependencies,
        blockers: {
            products: dependencies.productCount > 0,
            productAttributeValues:
                dependencies.productAttributeValueCount > 0,
            variantAttributeValues:
                dependencies.variantAttributeValueCount > 0,
        },
    };
}

export async function deleteCategory(id: string) {
    return prisma.$transaction(async (tx) => {
        const subtree = await getSubtree(tx, id);
        const categoryIds = subtree.map((category) => category.id);

        // Recheck every blocking dependency inside the transaction.
        const dependencies = await getDeletionDependencies(
            tx,
            categoryIds
        );

        if (dependencies.productCount > 0) {
            throw new CategoryServiceError(
                `Cannot delete this category tree because ${dependencies.productCount} product(s) are associated with it.`,
                "CATEGORY_HAS_PRODUCTS",
                409
            );
        }

        if (
            dependencies.productAttributeValueCount > 0 ||
            dependencies.variantAttributeValueCount > 0
        ) {
            throw new CategoryServiceError(
                "Cannot delete this category tree because attribute values depend on its category attributes.",
                "CATEGORY_HAS_ATTRIBUTE_DEPENDENCIES",
                409
            );
        }

        // getSubtree returns parent-first order.
        // Delete descendants before their parents because the
        // Category self-relation uses onDelete: Restrict.
        for (const category of [...subtree].reverse()) {
            await tx.category.delete({
                where: { id: category.id },
            });
        }

        return {
            deletedCategoryIds: categoryIds,
            deletedCount: categoryIds.length,
        };
    }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
}
