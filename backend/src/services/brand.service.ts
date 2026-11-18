
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../config/prisma.js";

export class BrandServiceError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly statusCode: number = 400
    ) {
        super(message);
        this.name = "BrandServiceError";
    }
}

interface CreateBrandInput {
    name: string;
    slug: string;
    isActive?: boolean;
}

interface UpdateBrandInput {
    name?: string;
    slug?: string;
}

interface BrandListQuery {
    page?: number;
    limit?: number;
    search?: string;
    isActive?: boolean;
}

function normalizeCategoryIds(categoryIds: string[]): string[] {
    return [...new Set(categoryIds)];
}

async function assertCategoriesAreLeaves(
    client: typeof prisma | Prisma.TransactionClient,
    categoryIds: string[]
): Promise<void> {
    if (categoryIds.length === 0) return;

    const categories = await client.category.findMany({
        where: {
            id: { in: categoryIds },
        },
        select: {
            id: true,
            _count: {
                select: {
                    children: true,
                },
            },
        },
    });

    if (categories.length !== categoryIds.length) {
        throw new BrandServiceError(
            "One or more categories were not found.",
            "CATEGORY_NOT_FOUND",
            404
        );
    }

    const nonLeafCategories = categories.filter(
        (category) => category._count.children > 0
    );

    if (nonLeafCategories.length > 0) {
        throw new BrandServiceError(
            "Brands can only be assigned to leaf categories.",
            "BRAND_CATEGORY_MUST_BE_LEAF",
            400
        );
    }
}

export async function createBrand(input: CreateBrandInput) {
    try {
        return await prisma.brand.create({
            data: {
                name: input.name.trim(),
                slug: input.slug.trim(),
                isActive: input.isActive ?? true,
            },
        });
    } catch (error) {
        if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002"
        ) {
            throw new BrandServiceError(
                "A brand with this slug already exists.",
                "BRAND_SLUG_EXISTS",
                409
            );
        }

        throw error;
    }
}

export async function listBrands(query: BrandListQuery = {}) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 25));
    const skip = (page - 1) * limit;

    const where: Prisma.BrandWhereInput = {
        ...(query.isActive !== undefined
            ? { isActive: query.isActive }
            : {}),
        ...(query.search
            ? {
                OR: [
                    {
                        name: {
                            contains: query.search,
                            mode: "insensitive",
                        },
                    },
                    {
                        slug: {
                            contains: query.search,
                            mode: "insensitive",
                        },
                    },
                ],
            }
            : {}),
    };

    const [brands, total] = await prisma.$transaction([
        prisma.brand.findMany({
            where,
            skip,
            take: limit,
            orderBy: {
                name: "asc",
            },
            include: {
                _count: {
                    select: {
                        products: true,
                        categoryBrands: true,
                    },
                },
            },
        }),
        prisma.brand.count({ where }),
    ]);

    return {
        brands,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
}

export async function getBrandById(id: string) {
    const brand = await prisma.brand.findUnique({
        where: { id },
        include: {
            categoryBrands: {
                include: {
                    category: {
                        select: {
                            id: true,
                            name: true,
                            slug: true,
                            parentId: true,
                            isActive: true,
                        },
                    },
                },
            },
            _count: {
                select: {
                    products: true,
                },
            },
        },
    });

    if (!brand) {
        throw new BrandServiceError(
            "Brand not found.",
            "BRAND_NOT_FOUND",
            404
        );
    }

    return brand;
}

export async function updateBrand(
    id: string,
    input: UpdateBrandInput
) {
    try {
        const existing = await prisma.brand.findUnique({
            where: { id },
            select: { id: true },
        });

        if (!existing) {
            throw new BrandServiceError(
                "Brand not found.",
                "BRAND_NOT_FOUND",
                404
            );
        }

        return await prisma.brand.update({
            where: { id },
            data: {
                ...(input.name !== undefined
                    ? { name: input.name.trim() }
                    : {}),
                ...(input.slug !== undefined
                    ? { slug: input.slug.trim() }
                    : {}),
            },
        });
    } catch (error) {
        if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002"
        ) {
            throw new BrandServiceError(
                "A brand with this slug already exists.",
                "BRAND_SLUG_EXISTS",
                409
            );
        }

        if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2025"
        ) {
            throw new BrandServiceError(
                "Brand not found.",
                "BRAND_NOT_FOUND",
                404
            );
        }

        throw error;
    }
}

export async function updateBrandStatus(
    id: string,
    isActive: boolean
) {
    try {
        return await prisma.brand.update({
            where: { id },
            data: { isActive },
        });
    } catch (error) {
        if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2025"
        ) {
            throw new BrandServiceError(
                "Brand not found.",
                "BRAND_NOT_FOUND",
                404
            );
        }

        throw error;
    }
}

export async function deleteBrand(id: string) {
    try {
        return await prisma.brand.delete({
            where: { id },
        });
    } catch (error) {
        if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2025"
        ) {
            throw new BrandServiceError(
                "Brand not found.",
                "BRAND_NOT_FOUND",
                404
            );
        }

        if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2003"
        ) {
            throw new BrandServiceError(
                "This brand is assigned to one or more products. Deactivate it instead of deleting it.",
                "BRAND_HAS_PRODUCTS",
                409
            );
        }

        throw error;
    }
}

/**
 * Replaces all direct category assignments of a brand.
 * Only leaf categories are accepted.
 */
export async function setBrandCategories(
    brandId: string,
    categoryIds: string[]
) {
    const normalizedIds = normalizeCategoryIds(categoryIds);

    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await prisma.$transaction(
                async (tx) => {
                    const brand = await tx.brand.findUnique({
                        where: { id: brandId },
                        select: { id: true },
                    });

                    if (!brand) {
                        throw new BrandServiceError(
                            "Brand not found.",
                            "BRAND_NOT_FOUND",
                            404
                        );
                    }

                    await assertCategoriesAreLeaves(tx, normalizedIds);
                    // Ensure existing products remain compatible with the new assignments.
                    const products = await tx.product.findMany({
                        where: {
                            brandId,
                        },
                        select: {
                            id: true,
                            categories: {
                                select: {
                                    categoryId: true,
                                },
                            },
                        },
                    });

                    const allowedCategoryIds = new Set(normalizedIds);

                    const incompatibleProducts = products.filter(product =>
                        !product.categories.some(category =>
                            allowedCategoryIds.has(category.categoryId)
                        )
                    );

                    if (incompatibleProducts.length > 0) {
                        throw new BrandServiceError(
                            "The new category assignments would make one or more existing products incompatible with this brand.",
                            "BRAND_CATEGORY_ASSIGNMENT_CONFLICT",
                            409
                        );
                    }
                    await tx.categoryBrand.deleteMany({
                        where: { brandId },
                    });

                    if (normalizedIds.length > 0) {
                        await tx.categoryBrand.createMany({
                            data: normalizedIds.map((categoryId) => ({
                                brandId,
                                categoryId,
                            })),
                            skipDuplicates: true,
                        });
                    }

                    return tx.brand.findUniqueOrThrow({
                        where: { id: brandId },
                        include: {
                            categoryBrands: {
                                include: {
                                    category: {
                                        select: {
                                            id: true,
                                            name: true,
                                            slug: true,
                                            parentId: true,
                                        },
                                    },
                                },
                            },
                        },
                    });
                },
                {
                    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
                }
            );
        } catch (error) {
            const isSerializationConflict =
                error instanceof Prisma.PrismaClientKnownRequestError &&
                error.code === "P2034";

            if (!isSerializationConflict) {
                throw error;
            }

            if (attempt === maxAttempts) {
                throw new BrandServiceError(
                    "The brand category assignments could not be updated because of concurrent changes. Please try again.",
                    "BRAND_UPDATE_CONFLICT",
                    409
                );
            }

            // Small increasing delay gives the competing transaction time to finish.
            await new Promise((resolve) => setTimeout(resolve, 20 * attempt));
        }
    }

    // The loop always returns or throws; this is a defensive fallback.
    throw new BrandServiceError(
        "The brand category assignments could not be updated.",
        "BRAND_UPDATE_CONFLICT",
        409
    );
}

/**
 * Returns active brands available in a category.
 * For a parent category, brands are aggregated from all
 * descendant leaf categories. No assignments are inherited or copied.
 */
export async function getAvailableBrandsByCategory(
    categoryId: string
) {
    const categories = await prisma.category.findMany({
        select: {
            id: true,
            parentId: true,
            isActive: true,
        },
    });

    const categoryMap = new Map(
        categories.map((category) => [category.id, category])
    );

    const requestedCategory = categoryMap.get(categoryId);

    if (!requestedCategory) {
        throw new BrandServiceError(
            "Category not found.",
            "CATEGORY_NOT_FOUND",
            404
        );
    }

    const childrenMap = new Map<string, string[]>();

    for (const category of categories) {
        if (!category.parentId) continue;

        const children = childrenMap.get(category.parentId) ?? [];
        children.push(category.id);
        childrenMap.set(category.parentId, children);
    }

    const requestedCategoryChildren =
        childrenMap.get(categoryId) ?? [];

    /*
     * If the requested category is an inactive leaf, use its parent as the
     * aggregation root. Its brands will appear only if they are also assigned
     * to at least one active leaf in that parent's subtree.
     *
     * Inactive parent categories do not block traversal into their children.
     */
    let aggregationRootId = categoryId;

    if (
        !requestedCategory.isActive &&
        requestedCategoryChildren.length === 0 &&
        requestedCategory.parentId
    ) {
        aggregationRootId = requestedCategory.parentId;
    }

    const leafCategoryIds: string[] = [];
    const visited = new Set<string>();
    const queue = [aggregationRootId];

    while (queue.length > 0) {
        const currentId = queue.shift()!;

        if (visited.has(currentId)) continue;
        visited.add(currentId);

        const currentCategory = categoryMap.get(currentId);
        if (!currentCategory) continue;

        const children = childrenMap.get(currentId) ?? [];

        if (children.length === 0) {
            // Only active leaf categories contribute brands.
            if (currentCategory.isActive) {
                leafCategoryIds.push(currentId);
            }
            continue;
        }

        // Do not stop traversal just because this parent is inactive.
        queue.push(...children);
    }

    if (leafCategoryIds.length === 0) {
        return [];
    }

    const assignments = await prisma.categoryBrand.findMany({
        where: {
            categoryId: {
                in: leafCategoryIds,
            },
            brand: {
                isActive: true,
            },
        },
        select: {
            brand: true,
        },
        distinct: ["brandId"],
    });

    return assignments.map((assignment) => assignment.brand);
}
