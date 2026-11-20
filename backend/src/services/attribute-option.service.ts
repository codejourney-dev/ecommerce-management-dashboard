
import {
    AttributeInputType,
    Prisma,
} from "../../generated/prisma/client.js";
import { prisma } from "../config/prisma.js";

export class AttributeOptionServiceError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly statusCode: number = 400
    ) {
        super(message);
        this.name = "AttributeOptionServiceError";
    }
}

interface CreateAttributeOptionInput {
    label: string;
    value: string;
    position?: number;
    isActive?: boolean;
}

interface UpdateAttributeOptionInput {
    label?: string;
    value?: string;
    position?: number;
}

const OPTION_INPUT_TYPES: AttributeInputType[] = [
    AttributeInputType.SELECT,
    AttributeInputType.MULTI_SELECT,
];

function ensureOptionInputType(inputType: AttributeInputType) {
    if (!OPTION_INPUT_TYPES.includes(inputType)) {
        throw new AttributeOptionServiceError(
            "Options are only supported for SELECT and MULTI_SELECT attributes.",
            "ATTRIBUTE_OPTIONS_NOT_SUPPORTED",
            409
        );
    }
}

function validateOptionText(value: string, field: string): string {
    const normalized = value.trim();

    if (!normalized) {
        throw new AttributeOptionServiceError(
            `${field} cannot be empty.`,
            `INVALID_OPTION_${field.toUpperCase()}`,
            400
        );
    }

    if (normalized.length > 150) {
        throw new AttributeOptionServiceError(
            `${field} must not exceed 150 characters.`,
            `INVALID_OPTION_${field.toUpperCase()}`,
            400
        );
    }

    return normalized;
}

function validatePosition(position: number) {
    if (!Number.isSafeInteger(position) || position < 0) {
        throw new AttributeOptionServiceError(
            "Position must be a non-negative integer.",
            "INVALID_OPTION_POSITION",
            400
        );
    }
}

async function ensureAttributeSupportsOptions(
    client: Prisma.TransactionClient | typeof prisma,
    attributeId: string
) {
    const attribute = await client.attribute.findUnique({
        where: { id: attributeId },
        select: {
            id: true,
            inputType: true,
        },
    });

    if (!attribute) {
        throw new AttributeOptionServiceError(
            "Attribute not found.",
            "ATTRIBUTE_NOT_FOUND",
            404
        );
    }

    ensureOptionInputType(attribute.inputType);

    return attribute;
}

// Create Option
export async function createAttributeOption(
    attributeId: string,
    input: CreateAttributeOptionInput
) {
    const label = validateOptionText(input.label, "label");
    const value = validateOptionText(input.value, "value");
    const position = input.position ?? 0;

    validatePosition(position);

    try {
        await ensureAttributeSupportsOptions(prisma, attributeId);

        return await prisma.attributeOption.create({
            data: {
                attributeId,
                label,
                value,
                position,
                isActive: input.isActive ?? true,
            },
        });
    } catch (error) {
        if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002"
        ) {
            throw new AttributeOptionServiceError(
                "An option with this value already exists for this attribute.",
                "ATTRIBUTE_OPTION_VALUE_EXISTS",
                409
            );
        }

        throw error;
    }
}

// List Options
export async function listAttributeOptions(attributeId: string) {
    await ensureAttributeSupportsOptions(prisma, attributeId);

    return prisma.attributeOption.findMany({
        where: { attributeId },
        orderBy: [
            { position: "asc" },
            { label: "asc" },
        ],
        include: {
            _count: {
                select: {
                    productSingleValues: true,
                    variantSingleValues: true,
                    productSelections: true,
                    variantSelections: true,
                },
            },
        },
    });
}

// Get Option by ID
export async function getAttributeOptionById(
    attributeId: string,
    optionId: string
) {
    await ensureAttributeSupportsOptions(prisma, attributeId);

    const option = await prisma.attributeOption.findFirst({
        where: {
            id: optionId,
            attributeId,
        },
        include: {
            _count: {
                select: {
                    productSingleValues: true,
                    variantSingleValues: true,
                    productSelections: true,
                    variantSelections: true,
                },
            },
        },
    });

    if (!option) {
        throw new AttributeOptionServiceError(
            "Attribute option not found.",
            "ATTRIBUTE_OPTION_NOT_FOUND",
            404
        );
    }

    return option;
}

// Update Option
export async function updateAttributeOption(
    attributeId: string,
    optionId: string,
    input: UpdateAttributeOptionInput
) {
    const data: Prisma.AttributeOptionUpdateInput = {};

    if (input.label !== undefined) {
        data.label = validateOptionText(input.label, "label");
    }

    if (input.value !== undefined) {
        data.value = validateOptionText(input.value, "value");
    }

    if (input.position !== undefined) {
        validatePosition(input.position);
        data.position = input.position;
    }

    if (Object.keys(data).length === 0) {
        throw new AttributeOptionServiceError(
            "At least one option field must be provided.",
            "EMPTY_OPTION_UPDATE",
            400
        );
    }

    try {
        await ensureAttributeSupportsOptions(prisma, attributeId);

        const existing = await prisma.attributeOption.findFirst({
            where: {
                id: optionId,
                attributeId,
            },
            select: { id: true },
        });

        if (!existing) {
            throw new AttributeOptionServiceError(
                "Attribute option not found.",
                "ATTRIBUTE_OPTION_NOT_FOUND",
                404
            );
        }

        return await prisma.attributeOption.update({
            where: { id: optionId },
            data,
        });
    } catch (error) {
        if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002"
        ) {
            throw new AttributeOptionServiceError(
                "An option with this value already exists for this attribute.",
                "ATTRIBUTE_OPTION_VALUE_EXISTS",
                409
            );
        }

        throw error;
    }
}

// Update Option Status
export async function updateAttributeOptionStatus(
    attributeId: string,
    optionId: string,
    isActive: boolean
) {
    await ensureAttributeSupportsOptions(prisma, attributeId);

    const existing = await prisma.attributeOption.findFirst({
        where: {
            id: optionId,
            attributeId,
        },
        select: { id: true },
    });

    if (!existing) {
        throw new AttributeOptionServiceError(
            "Attribute option not found.",
            "ATTRIBUTE_OPTION_NOT_FOUND",
            404
        );
    }

    return prisma.attributeOption.update({
        where: { id: optionId },
        data: { isActive },
    });
}

// Reorder Options
export async function reorderAttributeOptions(
    attributeId: string,
    optionIds: string[]
) {
    if (new Set(optionIds).size !== optionIds.length) {
        throw new AttributeOptionServiceError(
            "Duplicate option IDs are not allowed.",
            "DUPLICATE_OPTION_IDS",
            400
        );
    }

    try {
        return await prisma.$transaction(
            async (tx) => {
                await ensureAttributeSupportsOptions(tx, attributeId);

                const existingOptions =
                    await tx.attributeOption.findMany({
                        where: { attributeId },
                        select: { id: true },
                    });

                const existingIds = new Set(
                    existingOptions.map((option) => option.id)
                );

                if (
                    optionIds.length !== existingIds.size ||
                    optionIds.some((id) => !existingIds.has(id))
                ) {
                    throw new AttributeOptionServiceError(
                        "The supplied option IDs must contain every option of this attribute exactly once.",
                        "INVALID_OPTION_ORDER",
                        400
                    );
                }

                for (const [index, id] of optionIds.entries()) {
                    await tx.attributeOption.update({
                        where: { id },
                        data: { position: index },
                    });
                }

                // await Promise.all(
                //     optionIds.map((id, index) =>
                //         tx.attributeOption.update({
                //             where: { id },
                //             data: { position: index },
                //         })
                //     )
                // );

                return tx.attributeOption.findMany({
                    where: { attributeId },
                    orderBy: [
                        { position: "asc" },
                        { label: "asc" },
                    ],
                });
            },
            {
                isolationLevel:
                    Prisma.TransactionIsolationLevel.Serializable,
            }
        );
    } catch (error) {
        if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2034"
        ) {
            throw new AttributeOptionServiceError(
                "Options could not be reordered because of concurrent changes. Please try again.",
                "ATTRIBUTE_OPTION_REORDER_CONFLICT",
                409
            );
        }

        throw error;
    }
}

// Delete Option
export async function deleteAttributeOption(
    attributeId: string,
    optionId: string
) {
    try {
        return await prisma.$transaction(
            async (tx) => {
                await ensureAttributeSupportsOptions(tx, attributeId);

                const existing = await tx.attributeOption.findFirst({
                    where: {
                        id: optionId,
                        attributeId,
                    },
                    select: {
                        id: true,
                        _count: {
                            select: {
                                productSingleValues: true,
                                variantSingleValues: true,
                                productSelections: true,
                                variantSelections: true,
                            },
                        },
                    },
                });

                if (!existing) {
                    throw new AttributeOptionServiceError(
                        "Attribute option not found.",
                        "ATTRIBUTE_OPTION_NOT_FOUND",
                        404
                    );
                }

                const usageCount =
                    existing._count.productSingleValues +
                    existing._count.variantSingleValues +
                    existing._count.productSelections +
                    existing._count.variantSelections;

                if (usageCount > 0) {
                    throw new AttributeOptionServiceError(
                        "This option is used by existing product or variant attribute values and cannot be deleted.",
                        "ATTRIBUTE_OPTION_IN_USE",
                        409
                    );
                }

                return tx.attributeOption.delete({
                    where: { id: optionId },
                });
            },
            {
                isolationLevel:
                    Prisma.TransactionIsolationLevel.Serializable,
            }
        );
    } catch (error) {
        if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2003"
        ) {
            throw new AttributeOptionServiceError(
                "This option is referenced by existing attribute values and cannot be deleted.",
                "ATTRIBUTE_OPTION_IN_USE",
                409
            );
        }

        if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2034"
        ) {
            throw new AttributeOptionServiceError(
                "The option could not be deleted because of concurrent changes. Please try again.",
                "ATTRIBUTE_OPTION_DELETE_CONFLICT",
                409
            );
        }

        throw error;
    }
}
