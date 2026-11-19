import { prisma } from "../config/prisma.js";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export class CategoryAttributeServiceError extends Error {
    statusCode: number;
    code: string;

    constructor(
        message: string,
        statusCode = 400,
        code = "CATEGORY_ATTRIBUTE_ERROR"
    ) {
        super(message);

        this.name = "CategoryAttributeServiceError";
        this.statusCode = statusCode;
        this.code = code;
    }
}

type EffectiveCategoryAttribute = {
    id: string;
    attributeId: string;
    categoryId: string;
    scope: "PRODUCT" | "VARIANT";
    isRequired: boolean;
    position: number;

    attribute: {
        id: string;
        name: string;
        slug: string;
        inputType: string;
        isActive: boolean;
        options: {
            id: string;
            label: string;
            value: string;
            position: number;
            isActive: boolean;
        }[];
    };

    sourceCategory: {
        id: string;
        name: string;
    };

    isInherited: boolean;
};


type CreateCategoryAttributeInput = {
    attributeId: string;
    scope: "PRODUCT" | "VARIANT";
    isRequired?: boolean;
    position?: number;
};

export async function createCategoryAttribute(
    categoryId: string,
    data: CreateCategoryAttributeInput
) {
    const {
        attributeId,
        scope,
        isRequired = false,
        position = 0,
    } = data;

    // 1. Validate input
    if (!attributeId || typeof attributeId !== "string") {
        throw new CategoryAttributeServiceError(
            "Attribute ID is required.",
            400,
            "ATTRIBUTE_ID_REQUIRED"
        );
    }

    if (scope !== "PRODUCT" && scope !== "VARIANT") {
        throw new CategoryAttributeServiceError(
            "Invalid attribute scope.",
            400,
            "INVALID_ATTRIBUTE_SCOPE"
        );
    }

    if (typeof isRequired !== "boolean") {
        throw new CategoryAttributeServiceError(
            "isRequired must be a boolean.",
            400,
            "INVALID_REQUIRED_VALUE"
        );
    }

    // Assignments must start as optional. Required status is enabled
    // only through updateCategoryAttributeRequired after value validation.
    if (isRequired) {
        throw new CategoryAttributeServiceError(
            "Create the category attribute as optional first, enter valid values for existing items, then make it required.",
            409,
            "REQUIRED_ATTRIBUTE_MUST_BE_ENABLED_AFTER_CREATION"
        );
    }

    if (!Number.isInteger(position) || position < 0) {
        throw new CategoryAttributeServiceError(
            "Position must be a non-negative integer.",
            400,
            "INVALID_POSITION"
        );
    }

    return prisma.$transaction(
        async (tx) => {
            // 2. Load categories
            const categories = await tx.category.findMany({
                select: {
                    id: true,
                    parentId: true,
                },
            });

            const categoryMap = new Map(
                categories.map((category) => [
                    category.id,
                    category,
                ])
            );

            if (!categoryMap.has(categoryId)) {
                throw new CategoryAttributeServiceError(
                    "Category not found.",
                    404,
                    "CATEGORY_NOT_FOUND"
                );
            }

            // 3. Find ancestors
            const ancestorIds: string[] = [];
            const visitedAncestors = new Set<string>();

            let currentParentId =
                categoryMap.get(categoryId)?.parentId ?? null;

            while (currentParentId !== null) {
                if (visitedAncestors.has(currentParentId)) {
                    throw new CategoryAttributeServiceError(
                        "Category hierarchy contains a cycle.",
                        409,
                        "CATEGORY_HIERARCHY_CYCLE"
                    );
                }

                visitedAncestors.add(currentParentId);

                const parent = categoryMap.get(currentParentId);

                if (!parent) {
                    throw new CategoryAttributeServiceError(
                        "Category hierarchy is invalid.",
                        409,
                        "CATEGORY_HIERARCHY_INVALID"
                    );
                }

                ancestorIds.push(parent.id);
                currentParentId = parent.parentId;
            }

            // 4. Build children map
            const childrenMap = new Map<string, string[]>();

            for (const category of categories) {
                if (!category.parentId) continue;

                const children =
                    childrenMap.get(category.parentId) ?? [];

                children.push(category.id);

                childrenMap.set(category.parentId, children);
            }

            // 5. Find descendants
            const descendantIds: string[] = [];
            const visitedDescendants = new Set<string>([
                categoryId,
            ]);

            const queue = [categoryId];

            while (queue.length > 0) {
                const currentId = queue.shift()!;

                const children =
                    childrenMap.get(currentId) ?? [];

                for (const childId of children) {
                    if (visitedDescendants.has(childId)) {
                        throw new CategoryAttributeServiceError(
                            "Category hierarchy contains a cycle.",
                            409,
                            "CATEGORY_HIERARCHY_CYCLE"
                        );
                    }

                    visitedDescendants.add(childId);
                    descendantIds.push(childId);
                    queue.push(childId);
                }
            }

            // 6. Check attribute
            const attribute = await tx.attribute.findUnique({
                where: {
                    id: attributeId,
                },
                select: {
                    id: true,
                    isActive: true,
                },
            });

            if (!attribute) {
                throw new CategoryAttributeServiceError(
                    "Attribute not found.",
                    404,
                    "ATTRIBUTE_NOT_FOUND"
                );
            }

            if (!attribute.isActive) {
                throw new CategoryAttributeServiceError(
                    "Inactive attributes cannot be assigned.",
                    409,
                    "ATTRIBUTE_INACTIVE"
                );
            }

            // 7. Prevent duplicate assignments in the hierarchy
            const relatedCategoryIds = [
                ...ancestorIds,
                categoryId,
                ...descendantIds,
            ];

            const existingAssignment =
                await tx.categoryAttribute.findFirst({
                    where: {
                        attributeId,
                        categoryId: {
                            in: relatedCategoryIds,
                        },
                    },
                    select: {
                        id: true,
                        categoryId: true,
                    },
                });

            if (existingAssignment) {
                throw new CategoryAttributeServiceError(
                    "This attribute is already assigned to an ancestor or descendant category.",
                    409,
                    "ATTRIBUTE_ALREADY_ASSIGNED_IN_HIERARCHY"
                );
            }

            // 8. Create assignment
            return tx.categoryAttribute.create({
                data: {
                    categoryId,
                    attributeId,
                    scope,
                    isRequired,
                    position,
                },
                include: {
                    category: {
                        select: {
                            id: true,
                            name: true,
                        },
                    },
                    attribute: {
                        include: {
                            options: {
                                orderBy: {
                                    position: "asc",
                                },
                            },
                        },
                    },
                },
            });
        },
        {
            isolationLevel: "Serializable",
        }
    );
}

// -----------------------------------------------------------------------------
// Update Category Attribute Required Status
// -----------------------------------------------------------------------------

type AttributeValueValidationRecord = {
    textValue: string | null;
    numberValue: unknown;
    booleanValue: boolean | null;
    dateValue: Date | null;
    option: { isActive: boolean } | null;
    selectedOptions: {
        option: { isActive: boolean };
    }[];
};

function hasValidAttributeValue(
    inputType: string,
    value: AttributeValueValidationRecord
): boolean {
    switch (inputType) {
        case "TEXT":
            return (
                typeof value.textValue === "string" &&
                value.textValue.trim().length > 0
            );

        case "NUMBER":
            return value.numberValue !== null;

        case "BOOLEAN":
            // false is a valid value; only null means missing.
            return value.booleanValue !== null;

        case "DATE":
            return value.dateValue !== null;

        case "SELECT":
            return value.option?.isActive === true;

        case "MULTI_SELECT":
            return value.selectedOptions.some(
                (selection) => selection.option.isActive
            );

        default:
            return false;
    }
}

export async function updateCategoryAttributeRequired(
    categoryId: string,
    categoryAttributeId: string,
    isRequired: boolean
) {
    if (typeof isRequired !== "boolean") {
        throw new CategoryAttributeServiceError(
            "isRequired must be a boolean.",
            400,
            "INVALID_REQUIRED_VALUE"
        );
    }
    // Fast path: return immediately when the requested state
    // is already persisted. No transaction is needed.
    const existingAssignment = await prisma.categoryAttribute.findFirst({
        where: {
            id: categoryAttributeId,
            categoryId,
        },
        include: {
            category: {
                select: {
                    id: true,
                    name: true,
                },
            },
            attribute: {
                include: {
                    options: {
                        orderBy: {
                            position: "asc",
                        },
                    },
                },
            },
        },
    });

    if (!existingAssignment) {
        throw new CategoryAttributeServiceError(
            "Category attribute assignment not found.",
            404,
            "CATEGORY_ATTRIBUTE_NOT_FOUND"
        );
    }

    if (existingAssignment.isRequired === isRequired) {
        return existingAssignment;
    }
    try {
        return await prisma.$transaction(
            async (tx) => {
                // 1. Find the exact assignment under the requested category.
                const categoryAttribute =
                    await tx.categoryAttribute.findFirst({
                        where: {
                            id: categoryAttributeId,
                            categoryId,
                        },
                        include: {
                            attribute: {
                                select: {
                                    id: true,
                                    inputType: true,
                                    isActive: true,
                                },
                            },
                        },
                    });

                if (!categoryAttribute) {
                    throw new CategoryAttributeServiceError(
                        "Category attribute assignment not found.",
                        404,
                        "CATEGORY_ATTRIBUTE_NOT_FOUND"
                    );
                }

                // 2. No validation is needed when making an assignment optional.
                // Also keep repeated requests idempotent.
                if (categoryAttribute.isRequired === isRequired) {
                    return tx.categoryAttribute.findUniqueOrThrow({
                        where: { id: categoryAttribute.id },
                        include: {
                            category: {
                                select: { id: true, name: true },
                            },
                            attribute: {
                                include: {
                                    options: {
                                        orderBy: { position: "asc" },
                                    },
                                },
                            },
                        },
                    });
                }

                if (!isRequired) {
                    return tx.categoryAttribute.update({
                        where: { id: categoryAttribute.id },
                        data: { isRequired: false },
                        include: {
                            category: {
                                select: { id: true, name: true },
                            },
                            attribute: {
                                include: {
                                    options: {
                                        orderBy: { position: "asc" },
                                    },
                                },
                            },
                        },
                    });
                }

                if (!categoryAttribute.attribute.isActive) {
                    throw new CategoryAttributeServiceError(
                        "An inactive attribute cannot be made required.",
                        409,
                        "ATTRIBUTE_INACTIVE"
                    );
                }

                // 3. Load the category hierarchy and collect descendants.
                const categories = await tx.category.findMany({
                    select: {
                        id: true,
                        parentId: true,
                    },
                });

                const categoryMap = new Map(
                    categories.map((category) => [
                        category.id,
                        category,
                    ])
                );

                if (!categoryMap.has(categoryId)) {
                    throw new CategoryAttributeServiceError(
                        "Category not found.",
                        404,
                        "CATEGORY_NOT_FOUND"
                    );
                }

                const childrenMap = new Map<string, string[]>();

                for (const category of categories) {
                    if (!category.parentId) continue;

                    const children =
                        childrenMap.get(category.parentId) ?? [];

                    children.push(category.id);
                    childrenMap.set(category.parentId, children);
                }

                const descendantIds: string[] = [];
                const visited = new Set<string>([categoryId]);
                const queue = [categoryId];

                while (queue.length > 0) {
                    const currentId = queue.shift()!;
                    const children = childrenMap.get(currentId) ?? [];

                    for (const childId of children) {
                        if (visited.has(childId)) {
                            throw new CategoryAttributeServiceError(
                                "Category hierarchy contains a cycle.",
                                409,
                                "CATEGORY_HIERARCHY_CYCLE"
                            );
                        }

                        visited.add(childId);
                        descendantIds.push(childId);
                        queue.push(childId);
                    }
                }

                const affectedCategoryIds = [
                    categoryId,
                    ...descendantIds,
                ];

                // 4. Collect distinct, non-deleted products in this subtree.
                const productCategoryRows =
                    await tx.productCategory.findMany({
                        where: {
                            categoryId: { in: affectedCategoryIds },
                        },
                        select: { productId: true },
                    });

                const candidateProductIds = [
                    ...new Set(
                        productCategoryRows.map((row) => row.productId)
                    ),
                ];

                const products = candidateProductIds.length
                    ? await tx.product.findMany({
                          where: {
                              id: { in: candidateProductIds },
                              deletedAt: null,
                          },
                          select: { id: true },
                      })
                    : [];

                const productIds = products.map((product) => product.id);

                // 5. Select the target records based on the assignment scope.
                // Product/variant status is intentionally not filtered: draft,
                // inactive, and archived records must also be complete.
                const targetIds =
                    categoryAttribute.scope === "PRODUCT"
                        ? productIds
                        : productIds.length
                          ? (
                                await tx.productVariant.findMany({
                                    where: {
                                        productId: { in: productIds },
                                    },
                                    select: { id: true },
                                })
                            ).map((variant) => variant.id)
                          : [];

                if (targetIds.length === 0) {
                    return tx.categoryAttribute.update({
                        where: { id: categoryAttribute.id },
                        data: { isRequired: true },
                        include: {
                            category: {
                                select: { id: true, name: true },
                            },
                            attribute: {
                                include: {
                                    options: {
                                        orderBy: { position: "asc" },
                                    },
                                },
                            },
                        },
                    });
                }

                // 6. Load saved values and determine which target records have
                // a meaningful value matching the Attribute input type.
                let validTargetIds = new Set<string>();

                if (categoryAttribute.scope === "PRODUCT") {
                    const values =
                        await tx.productAttributeValue.findMany({
                            where: {
                                categoryAttributeId: categoryAttribute.id,
                                productId: { in: targetIds },
                            },
                            select: {
                                productId: true,
                                textValue: true,
                                numberValue: true,
                                booleanValue: true,
                                dateValue: true,
                                option: {
                                    select: { isActive: true },
                                },
                                selectedOptions: {
                                    select: {
                                        option: {
                                            select: { isActive: true },
                                        },
                                    },
                                },
                            },
                        });

                    validTargetIds = new Set(
                        values
                            .filter((value) =>
                                hasValidAttributeValue(
                                    categoryAttribute.attribute.inputType,
                                    value
                                )
                            )
                            .map((value) => value.productId)
                    );
                } else {
                    const values =
                        await tx.variantAttributeValue.findMany({
                            where: {
                                categoryAttributeId: categoryAttribute.id,
                                variantId: { in: targetIds },
                            },
                            select: {
                                variantId: true,
                                textValue: true,
                                numberValue: true,
                                booleanValue: true,
                                dateValue: true,
                                option: {
                                    select: { isActive: true },
                                },
                                selectedOptions: {
                                    select: {
                                        option: {
                                            select: { isActive: true },
                                        },
                                    },
                                },
                            },
                        });

                    validTargetIds = new Set(
                        values
                            .filter((value) =>
                                hasValidAttributeValue(
                                    categoryAttribute.attribute.inputType,
                                    value
                                )
                            )
                            .map((value) => value.variantId)
                    );
                }

                const missingCount = targetIds.filter(
                    (targetId) => !validTargetIds.has(targetId)
                ).length;

                if (missingCount > 0) {
                    const targetLabel =
                        categoryAttribute.scope === "PRODUCT"
                            ? "product(s)"
                            : "variant(s)";

                    throw new CategoryAttributeServiceError(
                        `Cannot make this attribute required. ${missingCount} of ${targetIds.length} ${targetLabel} are missing a valid value.`,
                        409,
                        "REQUIRED_ATTRIBUTE_VALUES_INCOMPLETE"
                    );
                }

                // 7. All existing target records have valid values.
                return tx.categoryAttribute.update({
                    where: { id: categoryAttribute.id },
                    data: { isRequired: true },
                    include: {
                        category: {
                            select: { id: true, name: true },
                        },
                        attribute: {
                            include: {
                                options: {
                                    orderBy: { position: "asc" },
                                },
                            },
                        },
                    },
                });
            },
            {
                isolationLevel: "Serializable",
            }
        );
    } catch (error) {
        if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "P2034"
        ) {
            throw new CategoryAttributeServiceError(
                "The category attribute or related catalog data changed concurrently. Please retry the request.",
                409,
                "CONCURRENT_CATEGORY_ATTRIBUTE_UPDATE"
            );
        }

        throw error;
    }
}

// -----------------------------------------------------------------------------
// Get Effective Category Attributes
// -----------------------------------------------------------------------------

export async function getEffectiveCategoryAttributes(
    categoryId: string
): Promise<EffectiveCategoryAttribute[]> {

    // 1. Check requested category
    const category = await prisma.category.findUnique({
        where: {
            id: categoryId,
        },
        select: {
            id: true,
        },
    });

    if (!category) {
        throw new CategoryAttributeServiceError(
            "Category not found.",
            404,
            "CATEGORY_NOT_FOUND"
        );
    }

    // 2. Get all ancestors and the requested category
    const hierarchy: {
        id: string;
        parentId: string | null;
        name: string;
    }[] = [];

    let currentCategoryId: string | null = categoryId;

    type CategoryHierarchyNode = {
        id: string;
        parentId: string | null;
        name: string;
    };

    while (currentCategoryId !== null) {
        const currentCategory: CategoryHierarchyNode | null =
            await prisma.category.findUnique({
            where: { id: currentCategoryId },
            select: {
                id: true,
                parentId: true,
                name: true,
            },
            });

        if (!currentCategory) {
            throw new CategoryAttributeServiceError(
            "Category hierarchy is invalid.",
            409,
            "CATEGORY_HIERARCHY_INVALID"
            );
        }

        hierarchy.push(currentCategory);
        currentCategoryId = currentCategory.parentId;
    }

    // 3. Reverse hierarchy: root -> requested category
    hierarchy.reverse();

    const hierarchyIds = hierarchy.map(
        (item) => item.id
    );

    // 4. Fetch direct assignments from all ancestors
    const assignments = await prisma.categoryAttribute.findMany({
        where: {
            categoryId: {
                in: hierarchyIds,
            },
        },
        include: {
            attribute: {
                include: {
                    options: {
                        orderBy: {
                            position: "asc",
                        },
                    },
                },
            },
        },
        orderBy: [
            {
                position: "asc",
            },
            {
                createdAt: "asc",
            },
        ],
    });

    const hierarchyOrder = new Map(
        hierarchy.map((category, index) => [category.id, index])
    );

    assignments.sort((a, b) => {
        const depthA = hierarchyOrder.get(a.categoryId) ?? 0;
        const depthB = hierarchyOrder.get(b.categoryId) ?? 0;

        if (depthA !== depthB) {
            return depthA - depthB;
        }

        return a.position - b.position;
    });

    // 5. Map category names
    const categoryNames = new Map(
        hierarchy.map((item) => [
            item.id,
            item.name,
        ])
    );

    // 6. Build effective attributes
    const effectiveAttributes: EffectiveCategoryAttribute[] =
        assignments.map((assignment) => {

            const sourceCategoryName =
                categoryNames.get(assignment.categoryId);

            if (!sourceCategoryName) {
                throw new CategoryAttributeServiceError(
                    "Attribute source category not found.",
                    409,
                    "INVALID_ATTRIBUTE_SOURCE"
                );
            }

            return {
                id: assignment.id,
                attributeId: assignment.attributeId,

                // The category being requested
                categoryId,

                scope: assignment.scope,
                isRequired: assignment.isRequired,
                position: assignment.position,

                attribute: {
                    id: assignment.attribute.id,
                    name: assignment.attribute.name,
                    slug: assignment.attribute.slug,
                    inputType: assignment.attribute.inputType,
                    isActive: assignment.attribute.isActive,

                    options: assignment.attribute.options.map(
                        (option) => ({
                            id: option.id,
                            label: option.label,
                            value: option.value,
                            position: option.position,
                            isActive: option.isActive,
                        })
                    ),
                },

                sourceCategory: {
                    id: assignment.categoryId,
                    name: sourceCategoryName,
                },

                isInherited:
                    assignment.categoryId !== categoryId,
            };
        });

    return effectiveAttributes;
}
