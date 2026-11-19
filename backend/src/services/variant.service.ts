import {
    AttributeInputType,
    AttributeScope,
    Prisma,
} from "../../generated/prisma/client.js";
import { prisma } from "../config/prisma.js";

export class VariantServiceError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly statusCode: number = 400,
    ) {
        super(message);
        this.name = "VariantServiceError";
    }
}

type DbClient = typeof prisma | Prisma.TransactionClient;

export interface VariantAttributeValueInput {
    categoryAttributeId: string;
    textValue?: string | null;
    numberValue?: number | string | Prisma.Decimal | null;
    booleanValue?: boolean | null;
    dateValue?: string | Date | null;
    optionId?: string | null;
    optionIds?: string[];
}

type RialInput = bigint | number | string;

export interface CreateVariantInput {
    productId: string;
    sku: string;
    title: string;
    priceRial: RialInput;
    compareAtPriceRial?: RialInput | null;
    costPriceRial?: RialInput | null;
    barcode?: string | null;
    attributeValues?: VariantAttributeValueInput[];
}

export interface UpdateVariantInput {
    sku?: string;
    title?: string;
    priceRial?: RialInput;
    compareAtPriceRial?: RialInput | null;
    costPriceRial?: RialInput | null;
    barcode?: string | null;
    attributeValues?: VariantAttributeValueInput[];
}

export interface VariantListQuery {
    page?: number;
    limit?: number;
    search?: string;
    isActive?: boolean;
    includeInactive?: boolean;
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
    code: string,
): error is Prisma.PrismaClientKnownRequestError {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

function parseRial(value: RialInput, fieldName: string, allowZero = true): bigint {
    let parsed: bigint;

    try {
        if (typeof value === "number") {
            if (!Number.isSafeInteger(value)) throw new Error("unsafe integer");
            parsed = BigInt(value);
        } else if (typeof value === "string") {
            if (!/^\d+$/.test(value.trim())) throw new Error("invalid integer");
            parsed = BigInt(value.trim());
        } else {
            parsed = value;
        }
    } catch {
        throw new VariantServiceError(
            `${fieldName} must be a valid integer amount in Rials.`,
            "VARIANT_INVALID_PRICE",
            400,
        );
    }

    if (parsed < 0n || (!allowZero && parsed === 0n)) {
        throw new VariantServiceError(
            `${fieldName} must be ${allowZero ? "zero or greater" : "greater than zero"}.`,
            "VARIANT_INVALID_PRICE",
            400,
        );
    }

    return parsed;
}

async function getProductCategoryAttributeScope(
    client: DbClient,
    productId: string,
): Promise<CategoryAttributeRow[]> {
    const product = await client.product.findFirst({
        where: { id: productId, deletedAt: null },
        select: {
            id: true,
            categories: {
                select: {
                    categoryId: true,
                    categories: {
                        select: { id: true, parentId: true, isActive: true },
                    },
                },
            },
        },
    });

    if (!product) {
        throw new VariantServiceError("Product not found.", "VARIANT_PRODUCT_NOT_FOUND", 404);
    }

    if (product.categories.length === 0) {
        throw new VariantServiceError(
            "The product must belong to at least one category before variants can be created.",
            "VARIANT_PRODUCT_CATEGORY_REQUIRED",
            409,
        );
    }

    const categoryIds = new Set<string>();

    for (const link of product.categories) {
        let current: { id: string; parentId: string | null; isActive: boolean } | null =
            link.categories;
        const visited = new Set<string>();

        while (current) {
            if (visited.has(current.id)) {
                throw new VariantServiceError(
                    "A category hierarchy cycle was detected.",
                    "VARIANT_CATEGORY_HIERARCHY_INVALID",
                    409,
                );
            }

            visited.add(current.id);
            categoryIds.add(current.id);

            if (!current.isActive) {
                throw new VariantServiceError(
                    "Variants cannot use attributes from inactive product categories.",
                    "VARIANT_CATEGORY_INACTIVE",
                    409,
                );
            }

            if (!current.parentId) break;

            const parent: {
                id: string;
                parentId: string | null;
                isActive: boolean;
            } | null = await client.category.findUnique({
                where: { id: current.parentId },
                select: { id: true, parentId: true, isActive: true },
            });

            if (!parent) {
                throw new VariantServiceError(
                    "A parent category in the product hierarchy was not found.",
                    "VARIANT_CATEGORY_HIERARCHY_INVALID",
                    409,
                );
            }

            current = parent;
        }
    }

    return client.categoryAttribute.findMany({
        where: {
            categoryId: { in: [...categoryIds] },
            scope: AttributeScope.VARIANT,
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
                    options: { select: { id: true, isActive: true } },
                },
            },
        },
    });
}

function hasValidValue(
    inputType: AttributeInputType,
    value: VariantAttributeValueInput,
): boolean {
    switch (inputType) {
        case AttributeInputType.TEXT:
            return typeof value.textValue === "string" && value.textValue.trim().length > 0;
        case AttributeInputType.NUMBER:
            return (
                value.numberValue !== null &&
                value.numberValue !== undefined &&
                value.numberValue !== "" &&
                Number.isFinite(Number(value.numberValue))
            );
        case AttributeInputType.BOOLEAN:
            return typeof value.booleanValue === "boolean";
        case AttributeInputType.DATE: {
            if (value.dateValue === null || value.dateValue === undefined) return false;
            const date = value.dateValue instanceof Date ? value.dateValue : new Date(value.dateValue);
            return !Number.isNaN(date.getTime());
        }
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
    value: VariantAttributeValueInput,
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
        throw new VariantServiceError(
            "The supplied value fields do not match the attribute input type.",
            "VARIANT_ATTRIBUTE_VALUE_TYPE_MISMATCH",
            400,
        );
    }
}

async function validateVariantAttributeValues(
    categoryAttributes: CategoryAttributeRow[],
    values: VariantAttributeValueInput[] = [],
) {
    if (!Array.isArray(values)) {
        throw new VariantServiceError(
            "Attribute values must be an array.",
            "VARIANT_INVALID_ATTRIBUTE_VALUES",
            400,
        );
    }

    const assignmentMap = new Map(categoryAttributes.map((item) => [item.id, item]));
    const suppliedMap = new Map<string, VariantAttributeValueInput>();

    for (const value of values) {
        if (!value || typeof value.categoryAttributeId !== "string" || !value.categoryAttributeId.trim()) {
            throw new VariantServiceError(
                "Every attribute value must include a categoryAttributeId.",
                "VARIANT_INVALID_ATTRIBUTE_VALUE",
                400,
            );
        }

        if (suppliedMap.has(value.categoryAttributeId)) {
            throw new VariantServiceError(
                "An attribute value was supplied more than once.",
                "VARIANT_DUPLICATE_ATTRIBUTE_VALUE",
                400,
            );
        }

        const assignment = assignmentMap.get(value.categoryAttributeId);
        if (!assignment) {
            throw new VariantServiceError(
                "The attribute is not assigned to the product's categories or parent categories with VARIANT scope.",
                "VARIANT_ATTRIBUTE_NOT_ASSIGNED",
                409,
            );
        }

        if (!assignment.attribute.isActive) {
            throw new VariantServiceError(
                `Attribute '${assignment.attribute.name}' is inactive.`,
                "VARIANT_ATTRIBUTE_INACTIVE",
                409,
            );
        }

        assertNoConflictingValueFields(assignment.attribute.inputType, value);

        if (!hasValidValue(assignment.attribute.inputType, value)) {
            throw new VariantServiceError(
                `A valid value is required for attribute '${assignment.attribute.name}'.`,
                "VARIANT_ATTRIBUTE_VALUE_INVALID",
                400,
            );
        }

        const activeOptionIds = new Set(
            assignment.attribute.options.filter((option) => option.isActive).map((option) => option.id),
        );

        if (
            assignment.attribute.inputType === AttributeInputType.SELECT &&
            !activeOptionIds.has(value.optionId!)
        ) {
            throw new VariantServiceError(
                `The selected option for '${assignment.attribute.name}' is inactive or does not belong to this attribute.`,
                "VARIANT_ATTRIBUTE_OPTION_INVALID",
                400,
            );
        }

        if (assignment.attribute.inputType === AttributeInputType.MULTI_SELECT) {
            const optionIds = value.optionIds!;
            if (new Set(optionIds).size !== optionIds.length) {
                throw new VariantServiceError(
                    `Duplicate options are not allowed for '${assignment.attribute.name}'.`,
                    "VARIANT_ATTRIBUTE_DUPLICATE_OPTIONS",
                    400,
                );
            }

            if (optionIds.some((optionId) => !activeOptionIds.has(optionId))) {
                throw new VariantServiceError(
                    `One or more selected options for '${assignment.attribute.name}' are inactive or do not belong to this attribute.`,
                    "VARIANT_ATTRIBUTE_OPTION_INVALID",
                    400,
                );
            }
        }

        suppliedMap.set(value.categoryAttributeId, value);
    }

    for (const assignment of categoryAttributes) {
        if (assignment.isRequired && assignment.attribute.isActive && !suppliedMap.has(assignment.id)) {
            throw new VariantServiceError(
                `Required attribute '${assignment.attribute.name}' is missing.`,
                "VARIANT_REQUIRED_ATTRIBUTE_MISSING",
                409,
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
                    ? value.dateValue instanceof Date
                        ? value.dateValue
                        : new Date(value.dateValue!)
                    : null,
            optionId: inputType === AttributeInputType.SELECT ? value.optionId! : null,
            optionIds: inputType === AttributeInputType.MULTI_SELECT ? value.optionIds! : [],
        };
    });
}

function buildAttributeValueCreateData(
    values: Awaited<ReturnType<typeof validateVariantAttributeValues>>,
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

function buildVariantInclude() {
    return {
        product: {
            select: {
                id: true,
                name: true,
                slug: true,
                status: true,
            },
        },
        images: {
            orderBy: [{ position: "asc" as const }, { id: "asc" as const }],
        },
        attributeValues: {
            include: {
                categoryAttribute: {
                    include: {
                        category: { select: { id: true, name: true, slug: true } },
                    },
                },
                option: true,
                selectedOptions: { include: { option: true } },
            },
        },
        _count: {
            select: { orderItems: true, inventory: true, inventoryMovements: true },
        },
    } satisfies Prisma.ProductVariantInclude;
}

function normalizeVariantText(value: string | undefined, fieldName: string): string | undefined {
    if (value === undefined) return undefined;
    const normalized = value.trim();
    if (!normalized) {
        throw new VariantServiceError(
            `${fieldName} cannot be empty.`,
            "VARIANT_INVALID_INPUT",
            400,
        );
    }
    return normalized;
}

// Create Variant
export async function createVariant(input: CreateVariantInput) {
    const sku = normalizeVariantText(input.sku, "SKU")!;
    const title = normalizeVariantText(input.title, "Title")!;
    const priceRial = parseRial(input.priceRial, "priceRial", false);
    const compareAtPriceRial =
        input.compareAtPriceRial === undefined || input.compareAtPriceRial === null
            ? null
            : parseRial(input.compareAtPriceRial, "compareAtPriceRial");
    const costPriceRial =
        input.costPriceRial === undefined || input.costPriceRial === null
            ? null
            : parseRial(input.costPriceRial, "costPriceRial");
    const barcode = input.barcode === undefined ? undefined : input.barcode?.trim() || null;

    try {
        return await prisma.$transaction(
            async (tx) => {
                const categoryAttributes = await getProductCategoryAttributeScope(tx, input.productId);
                const attributeValues = await validateVariantAttributeValues(
                    categoryAttributes,
                    input.attributeValues ?? [],
                );

                return tx.productVariant.create({
                    data: {
                        product: { connect: { id: input.productId } },
                        sku,
                        title,
                        priceRial,
                        compareAtPriceRial,
                        costPriceRial,
                        barcode,
                        ...(attributeValues.length > 0
                            ? { attributeValues: { create: buildAttributeValueCreateData(attributeValues) } }
                            : {}),
                    },
                    include: buildVariantInclude(),
                });
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
    } catch (error) {
        if (isKnownRequestError(error, "P2002")) {
            throw new VariantServiceError(
                "A variant with this SKU or barcode already exists.",
                "VARIANT_DUPLICATE_SKU_OR_BARCODE",
                409,
            );
        }
        if (isKnownRequestError(error, "P2034")) {
            throw new VariantServiceError(
                "The variant could not be created because of concurrent changes. Please try again.",
                "VARIANT_CREATE_CONFLICT",
                409,
            );
        }
        if (isKnownRequestError(error, "P2003")) {
            throw new VariantServiceError("The specified product was not found.", "VARIANT_PRODUCT_NOT_FOUND", 404);
        }
        throw error;
    }
}

// List Variants for a Product
export async function listVariants(productId: string, query: VariantListQuery = {}) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 25));
    const skip = (page - 1) * limit;

    const product = await prisma.product.findFirst({
        where: { id: productId, deletedAt: null },
        select: { id: true },
    });
    if (!product) {
        throw new VariantServiceError("Product not found.", "VARIANT_PRODUCT_NOT_FOUND", 404);
    }

    const where: Prisma.ProductVariantWhereInput = {
        productId,
        ...(query.includeInactive
            ? {}
            : { isActive: query.isActive ?? true }),
        ...(query.search?.trim()
            ? {
                  OR: [
                      { sku: { contains: query.search.trim(), mode: "insensitive" } },
                      { title: { contains: query.search.trim(), mode: "insensitive" } },
                      { barcode: { contains: query.search.trim(), mode: "insensitive" } },
                  ],
              }
            : {}),
    };

    const [variants, total] = await prisma.$transaction([
        prisma.productVariant.findMany({
            where,
            skip,
            take: limit,
            orderBy: [{ createdAt: "desc" }, { id: "asc" }],
            include: buildVariantInclude(),
        }),
        prisma.productVariant.count({ where }),
    ]);

    return {
        variants,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
}

// Get Variant by ID
export async function getVariantById(id: string) {
    const variant = await prisma.productVariant.findFirst({
        where: {
            id,
            product: { deletedAt: null },
        },
        include: buildVariantInclude(),
    });

    if (!variant) {
        throw new VariantServiceError("Variant not found.", "VARIANT_NOT_FOUND", 404);
    }

    return variant;
}

// Update Variant
export async function updateVariant(id: string, input: UpdateVariantInput) {
    const sku = normalizeVariantText(input.sku, "SKU");
    const title = normalizeVariantText(input.title, "Title");
    const priceRial =
        input.priceRial === undefined ? undefined : parseRial(input.priceRial, "priceRial", false);
    const compareAtPriceRial =
        input.compareAtPriceRial === undefined
            ? undefined
            : input.compareAtPriceRial === null
              ? null
              : parseRial(input.compareAtPriceRial, "compareAtPriceRial");
    const costPriceRial =
        input.costPriceRial === undefined
            ? undefined
            : input.costPriceRial === null
              ? null
              : parseRial(input.costPriceRial, "costPriceRial");
    const barcode = input.barcode === undefined ? undefined : input.barcode?.trim() || null;

    if (
        sku === undefined &&
        title === undefined &&
        priceRial === undefined &&
        compareAtPriceRial === undefined &&
        costPriceRial === undefined &&
        barcode === undefined &&
        input.attributeValues === undefined
    ) {
        throw new VariantServiceError(
            "At least one supported field must be provided.",
            "VARIANT_EMPTY_UPDATE",
            400,
        );
    }

    try {
        return await prisma.$transaction(
            async (tx) => {
                const existing = await tx.productVariant.findFirst({
                    where: { id, product: { deletedAt: null } },
                    select: { id: true, productId: true },
                });

                if (!existing) {
                    throw new VariantServiceError("Variant not found.", "VARIANT_NOT_FOUND", 404);
                }

                let validatedValues:
                    | Awaited<ReturnType<typeof validateVariantAttributeValues>>
                    | undefined;

                if (input.attributeValues !== undefined) {
                    const categoryAttributes = await getProductCategoryAttributeScope(
                        tx,
                        existing.productId,
                    );
                    validatedValues = await validateVariantAttributeValues(
                        categoryAttributes,
                        input.attributeValues,
                    );
                } else {
                    const categoryAttributes = await getProductCategoryAttributeScope(
                        tx,
                        existing.productId,
                    );
                    const currentValues = await tx.variantAttributeValue.findMany({
                        where: { variantId: id },
                        select: {
                            categoryAttributeId: true,
                            textValue: true,
                            numberValue: true,
                            booleanValue: true,
                            dateValue: true,
                            optionId: true,
                            selectedOptions: { select: { optionId: true } },
                        },
                    });

                    const assignmentById = new Map(
                        categoryAttributes.map((assignment) => [assignment.id, assignment]),
                    );

                    const retainedValues: VariantAttributeValueInput[] = currentValues
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

                    validatedValues = await validateVariantAttributeValues(
                        categoryAttributes,
                        retainedValues,
                    );
                }

                const updated = await tx.productVariant.update({
                    where: { id },
                    data: {
                        ...(sku !== undefined ? { sku } : {}),
                        ...(title !== undefined ? { title } : {}),
                        ...(priceRial !== undefined ? { priceRial } : {}),
                        ...(compareAtPriceRial !== undefined ? { compareAtPriceRial } : {}),
                        ...(costPriceRial !== undefined ? { costPriceRial } : {}),
                        ...(barcode !== undefined ? { barcode } : {}),
                        ...(input.attributeValues !== undefined
                            ? {
                                  attributeValues: {
                                      deleteMany: {},
                                      create: buildAttributeValueCreateData(validatedValues!),
                                  },
                              }
                            : {}),
                    },
                    include: buildVariantInclude(),
                });

                // Revalidate retained values against current assignments and remove values
                // whose category-attribute assignment is no longer in the product's scope.
                if (input.attributeValues === undefined) {
                    const validAssignmentIds = new Set(
                        (await getProductCategoryAttributeScope(tx, existing.productId)).map(
                            (assignment) => assignment.id,
                        ),
                    );
                    await tx.variantAttributeValue.deleteMany({
                        where: {
                            variantId: id,
                            categoryAttributeId: { notIn: [...validAssignmentIds] },
                        },
                    });
                    return tx.productVariant.findUniqueOrThrow({
                        where: { id },
                        include: buildVariantInclude(),
                    });
                }

                return updated;
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
    } catch (error) {
        if (isKnownRequestError(error, "P2002")) {
            throw new VariantServiceError(
                "A variant with this SKU or barcode already exists.",
                "VARIANT_DUPLICATE_SKU_OR_BARCODE",
                409,
            );
        }
        if (isKnownRequestError(error, "P2034")) {
            throw new VariantServiceError(
                "The variant could not be updated because of concurrent changes. Please try again.",
                "VARIANT_UPDATE_CONFLICT",
                409,
            );
        }
        if (isKnownRequestError(error, "P2025")) {
            throw new VariantServiceError("Variant not found.", "VARIANT_NOT_FOUND", 404);
        }
        throw error;
    }
}

// Activate / Deactivate Variant
export async function updateVariantStatus(id: string, isActive: boolean) {
    try {
        return await prisma.$transaction(
            async (tx) => {
                const result = await tx.productVariant.updateMany({
                    where: { id, product: { deletedAt: null } },
                    data: { isActive },
                });

                if (result.count === 0) {
                    throw new VariantServiceError("Variant not found.", "VARIANT_NOT_FOUND", 404);
                }

                return tx.productVariant.findUniqueOrThrow({
                    where: { id },
                    include: buildVariantInclude(),
                });
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
    } catch (error) {
        if (isKnownRequestError(error, "P2034")) {
            throw new VariantServiceError(
                "The variant status could not be updated because of concurrent changes.",
                "VARIANT_STATUS_UPDATE_CONFLICT",
                409,
            );
        }
        throw error;
    }
}

// Deactivate Variant
// ProductVariant has no deletedAt column in the current Prisma schema.
// Therefore this operation deactivates the variant instead of performing a soft delete.
export async function deleteVariant(id: string) {
    return updateVariantStatus(id, false);
}
