import {
    AttributeInputType,
    AttributeScope,
    Prisma,
    ProductStatus,
} from "../../generated/prisma/client.js";
import { prisma } from "../config/prisma.js";

export class ProductServiceError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly statusCode: number = 400
    ) {
        super(message);
        this.name = "ProductServiceError";
    }
}

type DbClient = typeof prisma | Prisma.TransactionClient;

export interface ProductAttributeValueInput {
    categoryAttributeId: string;
    textValue?: string | null;
    numberValue?: number | string | Prisma.Decimal | null;
    booleanValue?: boolean | null;
    dateValue?: string | Date | null;
    optionId?: string | null;
    optionIds?: string[];
}

export interface CreateProductInput {
    name: string;
    slug: string;
    description: string;
    brandId?: string | null;
    status?: ProductStatus;
    categoryIds: string[];
    attributeValues?: ProductAttributeValueInput[];
}

export interface UpdateProductInput {
    name?: string;
    slug?: string;
    description?: string;
    brandId?: string | null;
    categoryIds?: string[];
    attributeValues?: ProductAttributeValueInput[];
}

export interface ProductListQuery {
    page?: number;
    limit?: number;
    search?: string;
    status?: ProductStatus;
    categoryId?: string;
    brandId?: string;
    includeDeleted?: boolean;
}

type CategoryAttributeRow = {
    id: string;
    categoryId: string;
    attributeId: string;
    scope: AttributeScope;
    isRequired: boolean;
    attribute: {
        id: string;
        name: string;
        inputType: AttributeInputType;
        isActive: boolean;
        options: Array<{ id: string; isActive: boolean }>;
    };
};

function isKnownRequestError(
    error: unknown,
    code: string
): error is Prisma.PrismaClientKnownRequestError {
    return (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === code
    );
}

function normalizeCategoryIds(categoryIds: string[]): string[] {
    if (!Array.isArray(categoryIds) || categoryIds.length === 0) {
        throw new ProductServiceError(
            "At least one category is required.",
            "PRODUCT_CATEGORY_REQUIRED",
            400
        );
    }

    if (categoryIds.some((id) => typeof id !== "string" || !id.trim())) {
        throw new ProductServiceError(
            "Category IDs must be valid strings.",
            "PRODUCT_INVALID_CATEGORY_IDS",
            400
        );
    }

    const uniqueIds = [...new Set(categoryIds)];
    if (uniqueIds.length !== categoryIds.length) {
        throw new ProductServiceError(
            "Duplicate category IDs are not allowed.",
            "PRODUCT_DUPLICATE_CATEGORIES",
            400
        );
    }

    return uniqueIds;
}

async function assertCategoriesAndGetAttributeScope(
    client: DbClient,
    categoryIds: string[]
): Promise<{
    categoryIds: string[];
    categoryScopeIds: string[];
    categoryAttributes: CategoryAttributeRow[];
}> {
    const normalizedIds = normalizeCategoryIds(categoryIds);
    const categories = await client.category.findMany({
        select: {
            id: true,
            parentId: true,
            isActive: true,
        },
    });

    const categoryMap = new Map(categories.map((category) => [category.id, category]));
    const scopeIds = new Set<string>();

    for (const categoryId of normalizedIds) {
        const selected = categoryMap.get(categoryId);

        if (!selected) {
            throw new ProductServiceError(
                `Category '${categoryId}' was not found.`,
                "PRODUCT_CATEGORY_NOT_FOUND",
                404
            );
        }

        if (!selected.isActive) {
            throw new ProductServiceError(
                "Products can only be assigned to active categories.",
                "PRODUCT_CATEGORY_INACTIVE",
                409
            );
        }

        let current: typeof selected | undefined = selected;
        const visited = new Set<string>();

        while (current) {
            if (visited.has(current.id)) {
                throw new ProductServiceError(
                    "A category hierarchy cycle was detected.",
                    "PRODUCT_CATEGORY_HIERARCHY_INVALID",
                    409
                );
            }

            visited.add(current.id);
            scopeIds.add(current.id);

            if (!current.parentId) break;
            current = categoryMap.get(current.parentId);

            if (!current) {
                throw new ProductServiceError(
                    "A parent category in the selected category hierarchy was not found.",
                    "PRODUCT_CATEGORY_HIERARCHY_INVALID",
                    409
                );
            }

            if (!current.isActive) {
                throw new ProductServiceError(
                    "A product cannot be assigned to a category with an inactive parent.",
                    "PRODUCT_CATEGORY_INACTIVE_PARENT",
                    409
                );
            }
        }
    }

    const categoryScopeIds = [...scopeIds];
    const categoryAttributes = await client.categoryAttribute.findMany({
        where: {
            categoryId: { in: categoryScopeIds },
            scope: AttributeScope.PRODUCT,
        },
        select: {
            id: true,
            categoryId: true,
            attributeId: true,
            scope: true,
            isRequired: true,
            attribute: {
                select: {
                    id: true,
                    name: true,
                    inputType: true,
                    isActive: true,
                    options: {
                        select: { id: true, isActive: true },
                    },
                },
            },
        },
    });

    return {
        categoryIds: normalizedIds,
        categoryScopeIds,
        categoryAttributes,
    };
}

function hasValidValue(
    inputType: AttributeInputType,
    value: ProductAttributeValueInput
): boolean {
    switch (inputType) {
        case AttributeInputType.TEXT:
            return typeof value.textValue === "string" && value.textValue.trim().length > 0;
        case AttributeInputType.NUMBER:
            if (value.numberValue === null || value.numberValue === undefined || value.numberValue === "") {
                return false;
            }
            return Number.isFinite(Number(value.numberValue));
        case AttributeInputType.BOOLEAN:
            return typeof value.booleanValue === "boolean";
        case AttributeInputType.DATE:
            return (
                value.dateValue !== null &&
                value.dateValue !== undefined &&
                !Number.isNaN(
                    (value.dateValue instanceof Date
                        ? value.dateValue
                        : new Date(value.dateValue)
                    ).getTime()
                )
            );
        case AttributeInputType.SELECT:
            return typeof value.optionId === "string" && value.optionId.length > 0;
        case AttributeInputType.MULTI_SELECT:
            return Array.isArray(value.optionIds) && value.optionIds.length > 0;
        default:
            return false;
    }
}

function assertNoConflictingValueFields(
    inputType: AttributeInputType,
    value: ProductAttributeValueInput
): void {
    const suppliedFields = [
        value.textValue !== undefined,
        value.numberValue !== undefined,
        value.booleanValue !== undefined,
        value.dateValue !== undefined,
        value.optionId !== undefined,
        value.optionIds !== undefined,
    ];
    const expectedIndex: Record<AttributeInputType, number> = {
        [AttributeInputType.TEXT]: 0,
        [AttributeInputType.NUMBER]: 1,
        [AttributeInputType.BOOLEAN]: 2,
        [AttributeInputType.DATE]: 3,
        [AttributeInputType.SELECT]: 4,
        [AttributeInputType.MULTI_SELECT]: 5,
    };

    if (suppliedFields.some((supplied, index) => supplied && index !== expectedIndex[inputType])) {
        throw new ProductServiceError(
            "The supplied value fields do not match the attribute input type.",
            "PRODUCT_ATTRIBUTE_VALUE_TYPE_MISMATCH",
            400
        );
    }
}

async function validateProductAttributeValues(
    client: DbClient,
    categoryAttributes: CategoryAttributeRow[],
    values: ProductAttributeValueInput[] = []
): Promise<Array<{
    categoryAttributeId: string;
    attributeId: string;
    textValue: string | null;
    numberValue: Prisma.Decimal | null;
    booleanValue: boolean | null;
    dateValue: Date | null;
    optionId: string | null;
    optionIds: string[];
}>> {
    if (!Array.isArray(values)) {
        throw new ProductServiceError(
            "Attribute values must be an array.",
            "PRODUCT_INVALID_ATTRIBUTE_VALUES",
            400
        );
    }

    const assignmentMap = new Map(categoryAttributes.map((item) => [item.id, item]));
    const suppliedMap = new Map<string, ProductAttributeValueInput>();

    for (const value of values) {
        if (!value || typeof value.categoryAttributeId !== "string") {
            throw new ProductServiceError(
                "Every attribute value must include a categoryAttributeId.",
                "PRODUCT_INVALID_ATTRIBUTE_VALUE",
                400
            );
        }

        if (suppliedMap.has(value.categoryAttributeId)) {
            throw new ProductServiceError(
                "An attribute value was supplied more than once.",
                "PRODUCT_DUPLICATE_ATTRIBUTE_VALUE",
                400
            );
        }

        const assignment = assignmentMap.get(value.categoryAttributeId);
        if (!assignment) {
            throw new ProductServiceError(
                "The attribute is not assigned to one of the product's categories or its parent categories with PRODUCT scope.",
                "PRODUCT_ATTRIBUTE_NOT_ASSIGNED",
                409
            );
        }

        if (!assignment.attribute.isActive) {
            throw new ProductServiceError(
                `Attribute '${assignment.attribute.name}' is inactive.`,
                "PRODUCT_ATTRIBUTE_INACTIVE",
                409
            );
        }

        assertNoConflictingValueFields(assignment.attribute.inputType, value);

        if (!hasValidValue(assignment.attribute.inputType, value)) {
            throw new ProductServiceError(
                `A valid value is required for attribute '${assignment.attribute.name}'.`,
                "PRODUCT_ATTRIBUTE_VALUE_INVALID",
                400
            );
        }

        const activeOptionIds = new Set(
            assignment.attribute.options
                .filter((option) => option.isActive)
                .map((option) => option.id)
        );

        if (assignment.attribute.inputType === AttributeInputType.SELECT) {
            if (!activeOptionIds.has(value.optionId!)) {
                throw new ProductServiceError(
                    `The selected option for '${assignment.attribute.name}' is inactive or does not belong to this attribute.`,
                    "PRODUCT_ATTRIBUTE_OPTION_INVALID",
                    400
                );
            }
        }

        if (assignment.attribute.inputType === AttributeInputType.MULTI_SELECT) {
            const optionIds = value.optionIds!;
            if (new Set(optionIds).size !== optionIds.length) {
                throw new ProductServiceError(
                    `Duplicate options are not allowed for '${assignment.attribute.name}'.`,
                    "PRODUCT_ATTRIBUTE_DUPLICATE_OPTIONS",
                    400
                );
            }

            if (optionIds.some((optionId) => !activeOptionIds.has(optionId))) {
                throw new ProductServiceError(
                    `One or more selected options for '${assignment.attribute.name}' are inactive or do not belong to this attribute.`,
                    "PRODUCT_ATTRIBUTE_OPTION_INVALID",
                    400
                );
            }
        }

        suppliedMap.set(value.categoryAttributeId, value);
    }

    for (const assignment of categoryAttributes) {
        if (
            assignment.isRequired &&
            assignment.attribute.isActive &&
            !suppliedMap.has(assignment.id)
        ) {
            throw new ProductServiceError(
                `Required attribute '${assignment.attribute.name}' is missing.`,
                "PRODUCT_REQUIRED_ATTRIBUTE_MISSING",
                409
            );
        }
    }

    return [...suppliedMap.entries()].map(([categoryAttributeId, value]) => {
        const assignment = assignmentMap.get(categoryAttributeId)!;
        const inputType = assignment.attribute.inputType;

        return {
            categoryAttributeId,
            attributeId: assignment.attributeId,
            textValue: inputType === AttributeInputType.TEXT ? value.textValue!.trim() : null,
            numberValue:
                inputType === AttributeInputType.NUMBER
                    ? new Prisma.Decimal(value.numberValue!)
                    : null,
            booleanValue: inputType === AttributeInputType.BOOLEAN ? value.booleanValue! : null,
            dateValue:
                inputType === AttributeInputType.DATE
                    ? (value.dateValue instanceof Date
                        ? value.dateValue
                        : new Date(value.dateValue!))
                    : null,
            optionId: inputType === AttributeInputType.SELECT ? value.optionId! : null,
            optionIds: inputType === AttributeInputType.MULTI_SELECT ? value.optionIds! : [],
        };
    });
}

async function assertBrandIsValid(
    client: DbClient,
    brandId: string | null | undefined
): Promise<void> {
    if (brandId === undefined || brandId === null) return;

    const brand = await client.brand.findUnique({
        where: { id: brandId },
        select: { id: true, isActive: true },
    });

    if (!brand) {
        throw new ProductServiceError(
            "Brand not found.",
            "PRODUCT_BRAND_NOT_FOUND",
            404
        );
    }

    if (!brand.isActive) {
        throw new ProductServiceError(
            "An inactive brand cannot be assigned to a product.",
            "PRODUCT_BRAND_INACTIVE",
            409
        );
    }
}

function buildAttributeValueCreateData(
    values: Awaited<ReturnType<typeof validateProductAttributeValues>>
) {
    return values.map((value) => ({
        categoryAttribute: {
            connect: {
                id_attributeId: {
                    id: value.categoryAttributeId,
                    attributeId: value.attributeId,
                },
            },
        },
        textValue: value.textValue,
        numberValue: value.numberValue,
        booleanValue: value.booleanValue,
        dateValue: value.dateValue,
        ...(value.optionId
            ? {
                option: {
                    connect: {
                        id_attributeId: {
                            id: value.optionId,
                            attributeId: value.attributeId,
                        },
                    },
                },
            }
            : {}),
        ...(value.optionIds.length > 0
            ? {
                selectedOptions: {
                    create: value.optionIds.map((optionId) => ({
                        option: { connect: { id: optionId } },
                    })),
                },
            }
            : {}),
    }));
}

function buildProductInclude() {
    return {
        brand: {
            select: { id: true, name: true, slug: true, isActive: true },
        },
        categories: {
            include: {
                categories: {
                    select: { id: true, name: true, slug: true, isActive: true, parentId: true },
                },
            },
        },
        attributeValues: {
            include: {
                categoryAttribute: {
                    include: {
                        category: {
                            select: { id: true, name: true, slug: true },
                        },
                    },
                },
                option: true,
                selectedOptions: {
                    include: { option: true },
                },
            },
        },
        _count: {
            select: { variants: true, images: true, reviews: true },
        },
    } satisfies Prisma.ProductInclude;
}

// Create Product
export async function createProduct(input: CreateProductInput) {
    const name = input.name?.trim();
    const slug = input.slug?.trim();
    const description = input.description?.trim();

    if (!name || !slug || !description) {
        throw new ProductServiceError(
            "Product name, slug, and description are required.",
            "PRODUCT_INVALID_INPUT",
            400
        );
    }

    const status = input.status ?? ProductStatus.DRAFT;

    try {
        return await prisma.$transaction(async (tx) => {
            const categoryData = await assertCategoriesAndGetAttributeScope(tx, input.categoryIds);
            await assertBrandIsValid(tx, input.brandId);

            const attributeValues = await validateProductAttributeValues(
                tx,
                categoryData.categoryAttributes,
                input.attributeValues ?? []
            );

            return tx.product.create({
                data: {
                    name,
                    slug,
                    description,
                    brandId: input.brandId ?? null,
                    status,
                    categories: {
                        create: categoryData.categoryIds.map((categoryId) => ({
                            categories: { connect: { id: categoryId } },
                        })),
                    },
                    ...(attributeValues.length > 0
                        ? { attributeValues: { create: buildAttributeValueCreateData(attributeValues) } }
                        : {}),
                },
                include: buildProductInclude(),
            });
        }, {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
    } catch (error) {
        if (isKnownRequestError(error, "P2002")) {
            throw new ProductServiceError(
                "A product with this slug already exists.",
                "PRODUCT_SLUG_EXISTS",
                409
            );
        }
        if (isKnownRequestError(error, "P2034")) {
            throw new ProductServiceError(
                "The product could not be created because of concurrent changes. Please try again.",
                "PRODUCT_CREATE_CONFLICT",
                409
            );
        }
        throw error;
    }
}

// List Products
export async function listProducts(query: ProductListQuery = {}) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 25));
    const skip = (page - 1) * limit;

    const where: Prisma.ProductWhereInput = {
        deletedAt: query.includeDeleted ? undefined : null,
        ...(query.status !== undefined ? { status: query.status } : {}),
        ...(query.brandId !== undefined ? { brandId: query.brandId } : {}),
        ...(query.categoryId !== undefined
            ? { categories: { some: { categoryId: query.categoryId } } }
            : {}),
        ...(query.search?.trim()
            ? {
                OR: [
                    { name: { contains: query.search.trim(), mode: "insensitive" } },
                    { slug: { contains: query.search.trim(), mode: "insensitive" } },
                    { description: { contains: query.search.trim(), mode: "insensitive" } },
                ],
            }
            : {}),
    };

    const [products, total] = await prisma.$transaction([
        prisma.product.findMany({
            where,
            skip,
            take: limit,
            orderBy: [{ createdAt: "desc" }, { id: "asc" }],
            include: buildProductInclude(),
        }),
        prisma.product.count({ where }),
    ]);

    return {
        products,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
}

// Get Product by ID
export async function getProductById(id: string) {
    const product = await prisma.product.findFirst({
        where: { id, deletedAt: null },
        include: buildProductInclude(),
    });

    if (!product) {
        throw new ProductServiceError(
            "Product not found.",
            "PRODUCT_NOT_FOUND",
            404
        );
    }

    return product;
}

// Update Product
export async function updateProduct(id: string, input: UpdateProductInput) {
    if (input.name !== undefined && !input.name.trim()) {
        throw new ProductServiceError("Product name cannot be empty.", "PRODUCT_INVALID_NAME", 400);
    }
    if (input.slug !== undefined && !input.slug.trim()) {
        throw new ProductServiceError("Product slug cannot be empty.", "PRODUCT_INVALID_SLUG", 400);
    }
    if (input.description !== undefined && !input.description.trim()) {
        throw new ProductServiceError("Product description cannot be empty.", "PRODUCT_INVALID_DESCRIPTION", 400);
    }

    try {
        return await prisma.$transaction(async (tx) => {
            const existing = await tx.product.findFirst({
                where: { id, deletedAt: null },
                select: { id: true, brandId: true },
            });

            if (!existing) {
                throw new ProductServiceError("Product not found.", "PRODUCT_NOT_FOUND", 404);
            }

            const currentCategoryLinks = await tx.productCategory.findMany({
                where: { productId: id },
                select: { categoryId: true },
            });
            const categoryIds = input.categoryIds ?? currentCategoryLinks.map((item) => item.categoryId);
            const categoryData = await assertCategoriesAndGetAttributeScope(tx, categoryIds);

            if (input.brandId !== undefined) {
                await assertBrandIsValid(tx, input.brandId);
            } else {
                await assertBrandIsValid(tx, existing.brandId);
            }

            // If attributeValues are omitted, retain current values and validate them
            // against the resulting category assignments and current required rules.
            const existingValues = input.attributeValues === undefined
                ? await tx.productAttributeValue.findMany({
                    where: { productId: id },
                    select: {
                        categoryAttributeId: true,
                        textValue: true,
                        numberValue: true,
                        booleanValue: true,
                        dateValue: true,
                        optionId: true,
                        selectedOptions: { select: { optionId: true } },
                    },
                })
                : undefined;

            const assignmentById = new Map(
                categoryData.categoryAttributes.map((assignment) => [assignment.id, assignment])
            );

            const valuesToValidate: ProductAttributeValueInput[] = input.attributeValues ??
                (existingValues ?? [])
                    // Values belonging to assignments removed by a category change are
                    // intentionally discarded; values still in scope are revalidated.
                    .filter((value) => assignmentById.has(value.categoryAttributeId))
                    .map((value) => {
                        const assignment = assignmentById.get(value.categoryAttributeId)!;
                        const base = { categoryAttributeId: value.categoryAttributeId };

                        switch (assignment.attribute.inputType) {
                            case AttributeInputType.TEXT:
                                return { ...base, textValue: value.textValue };
                            case AttributeInputType.NUMBER:
                                return { ...base, numberValue: value.numberValue ?? null };
                            case AttributeInputType.BOOLEAN:
                                return { ...base, booleanValue: value.booleanValue };
                            case AttributeInputType.DATE:
                                return { ...base, dateValue: value.dateValue };
                            case AttributeInputType.SELECT:
                                return { ...base, optionId: value.optionId };
                            case AttributeInputType.MULTI_SELECT:
                                return {
                                    ...base,
                                    optionIds: value.selectedOptions.map((item) => item.optionId),
                                };
                        }
                    });

            const validatedValues = await validateProductAttributeValues(
                tx,
                categoryData.categoryAttributes,
                valuesToValidate
            );

            const updated = await tx.product.update({
                where: { id },
                data: {
                    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
                    ...(input.slug !== undefined ? { slug: input.slug.trim() } : {}),
                    ...(input.description !== undefined ? { description: input.description.trim() } : {}),
                    ...(input.brandId !== undefined ? { brandId: input.brandId } : {}),
                    ...(input.categoryIds !== undefined
                        ? {
                            categories: {
                                deleteMany: {},
                                create: categoryData.categoryIds.map((categoryId) => ({
                                    categories: { connect: { id: categoryId } },
                                })),
                            },
                        }
                        : {}),
                    ...(input.attributeValues !== undefined
                        ? {
                            attributeValues: {
                                deleteMany: {},
                                create: buildAttributeValueCreateData(validatedValues),
                            },
                        }
                        : {}),
                },
                include: buildProductInclude(),
            });

            // If categories changed but values were not explicitly supplied, remove
            // values that no longer belong to the product's category/parent scope.
            if (input.categoryIds !== undefined && input.attributeValues === undefined) {
                const validAssignmentIds = new Set(categoryData.categoryAttributes.map((item) => item.id));
                await tx.productAttributeValue.deleteMany({
                    where: {
                        productId: id,
                        categoryAttributeId: { notIn: [...validAssignmentIds] },
                    },
                });
                return tx.product.findUniqueOrThrow({
                    where: { id },
                    include: buildProductInclude(),
                });
            }

            return updated;
        }, {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
    } catch (error) {
        if (isKnownRequestError(error, "P2002")) {
            throw new ProductServiceError(
                "A product with this slug already exists.",
                "PRODUCT_SLUG_EXISTS",
                409
            );
        }
        if (isKnownRequestError(error, "P2034")) {
            throw new ProductServiceError(
                "The product could not be updated because of concurrent changes. Please try again.",
                "PRODUCT_UPDATE_CONFLICT",
                409
            );
        }
        if (isKnownRequestError(error, "P2025")) {
            throw new ProductServiceError("Product not found.", "PRODUCT_NOT_FOUND", 404);
        }
        throw error;
    }
}

// Update Product Status
export async function updateProductStatus(id: string, status: ProductStatus) {
    try {
        return await prisma.product.updateMany({
            where: { id, deletedAt: null },
            data: { status },
        }).then(async (result) => {
            if (result.count === 0) {
                throw new ProductServiceError("Product not found.", "PRODUCT_NOT_FOUND", 404);
            }
            return prisma.product.findUniqueOrThrow({
                where: { id },
                include: buildProductInclude(),
            });
        });
    } catch (error) {
        if (isKnownRequestError(error, "P2034")) {
            throw new ProductServiceError(
                "The product status could not be updated because of concurrent changes.",
                "PRODUCT_STATUS_UPDATE_CONFLICT",
                409
            );
        }
        throw error;
    }
}

// Soft Delete Product
export async function deleteProduct(id: string) {
    try {
        return await prisma.$transaction(async (tx) => {
            const existing = await tx.product.findFirst({
                where: { id, deletedAt: null },
                select: { id: true, deletedAt: true },
            });

            if (!existing) {
                throw new ProductServiceError("Product not found.", "PRODUCT_NOT_FOUND", 404);
            }

            return tx.product.update({
                where: { id },
                data: { deletedAt: new Date() },
                select: { id: true, deletedAt: true },
            });
        }, {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
    } catch (error) {
        if (isKnownRequestError(error, "P2034")) {
            throw new ProductServiceError(
                "The product could not be deleted because of concurrent changes. Please try again.",
                "PRODUCT_DELETE_CONFLICT",
                409
            );
        }
        throw error;
    }
}
