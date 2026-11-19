
import { AttributeInputType, Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../config/prisma.js";

export class AttributeServiceError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly statusCode: number = 400
    ) {
        super(message);
        this.name = "AttributeServiceError";
    }
}

interface CreateAttributeInput {
    name: string;
    slug: string;
    inputType: AttributeInputType;
    isActive?: boolean;
}

interface UpdateAttributeInput {
    name?: string;
    slug?: string;
    inputType?: AttributeInputType;
}

interface AttributeListQuery {
    page?: number;
    limit?: number;
    search?: string;
    inputType?: AttributeInputType;
    isActive?: boolean;
}

// Create Attribute
export async function createAttribute(input: CreateAttributeInput) {
    const name = input.name.trim();
    const slug = input.slug.trim();

    if (!name || !slug) {
        throw new AttributeServiceError(
            "Attribute name and slug are required.",
            "ATTRIBUTE_INVALID_INPUT",
            400
        );
    }

    try {
        return await prisma.attribute.create({
            data: {
                name,
                slug,
                inputType: input.inputType,
                isActive: input.isActive ?? true,
            },
        });
    } catch (error) {
        if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002"
        ) {
            throw new AttributeServiceError(
                "An attribute with this slug already exists.",
                "ATTRIBUTE_SLUG_EXISTS",
                409
            );
        }

        throw error;
    }
}

// List Attributes
export async function listAttributes(
    query: AttributeListQuery = {}
) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 25));
    const skip = (page - 1) * limit;

    const where: Prisma.AttributeWhereInput = {
        ...(query.isActive !== undefined
            ? { isActive: query.isActive }
            : {}),

        ...(query.inputType !== undefined
            ? { inputType: query.inputType }
            : {}),

        ...(query.search
            ? {
                OR: [
                    {
                        name: {
                            contains: query.search.trim(),
                            mode: "insensitive",
                        },
                    },
                    {
                        slug: {
                            contains: query.search.trim(),
                            mode: "insensitive",
                        },
                    },
                ],
            }
            : {}),
    };

    const [attributes, total] = await prisma.$transaction([
        prisma.attribute.findMany({
            where,
            skip,
            take: limit,
            orderBy: {
                name: "asc",
            },
            include: {
                _count: {
                    select: {
                        options: true,
                        categoryAttributes: true,
                    },
                },
            },
        }),

        prisma.attribute.count({ where }),
    ]);

    return {
        attributes,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
}

// Get Attribute by ID
export async function getAttributeById(id: string) {
    const attribute = await prisma.attribute.findUnique({
        where: { id },
        include: {
            options: {
                orderBy: [
                    { position: "asc" },
                    { label: "asc" },
                ],
            },

            categoryAttributes: {
                orderBy: {
                    position: "asc",
                },
                include: {
                    category: {
                        select: {
                            id: true,
                            name: true,
                            slug: true,
                            isActive: true,
                        },
                    },
                },
            },

            _count: {
                select: {
                    options: true,
                    categoryAttributes: true,
                },
            },
        },
    });

    if (!attribute) {
        throw new AttributeServiceError(
            "Attribute not found.",
            "ATTRIBUTE_NOT_FOUND",
            404
        );
    }

    return attribute;
}

// Update Attribute
export async function updateAttribute(
    id: string,
    input: UpdateAttributeInput
) {
    if (
        input.name !== undefined &&
        !input.name.trim()
    ) {
        throw new AttributeServiceError(
            "Attribute name cannot be empty.",
            "ATTRIBUTE_INVALID_NAME",
            400
        );
    }

    if (
        input.slug !== undefined &&
        !input.slug.trim()
    ) {
        throw new AttributeServiceError(
            "Attribute slug cannot be empty.",
            "ATTRIBUTE_INVALID_SLUG",
            400
        );
    }

    try {
        return await prisma.$transaction(
            async (tx) => {
                const existing = await tx.attribute.findUnique({
                    where: { id },
                    select: {
                        id: true,
                        inputType: true,
                        _count: {
                            select: {
                                categoryAttributes: true,
                                options: true,
                            },
                        },
                    },
                });

                if (!existing) {
                    throw new AttributeServiceError(
                        "Attribute not found.",
                        "ATTRIBUTE_NOT_FOUND",
                        404
                    );
                }

                // Input type cannot change after category assignment.
                if (    
                    input.inputType !== undefined &&
                    input.inputType !== existing.inputType &&
                    (
                        existing._count.categoryAttributes > 0 ||
                        existing._count.options > 0
                    )
                ) {
                    throw new AttributeServiceError(
                        "The input type cannot be changed because this attribute has existing dependencies.",
                        "ATTRIBUTE_INPUT_TYPE_IN_USE",
                        409
                    );
                }

                return tx.attribute.update({
                    where: { id },
                    data: {
                        ...(input.name !== undefined
                            ? { name: input.name.trim() }
                            : {}),

                        ...(input.slug !== undefined
                            ? { slug: input.slug.trim() }
                            : {}),

                        ...(input.inputType !== undefined
                            ? { inputType: input.inputType }
                            : {}),
                    },
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
            error.code === "P2002"
        ) {
            throw new AttributeServiceError(
                "An attribute with this slug already exists.",
                "ATTRIBUTE_SLUG_EXISTS",
                409
            );
        }

        if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2034"
        ) {
            throw new AttributeServiceError(
                "The attribute could not be updated because of concurrent changes. Please try again.",
                "ATTRIBUTE_UPDATE_CONFLICT",
                409
            );
        }

        throw error;
    }
}

// Update Attribute Status
export async function updateAttributeStatus(
    id: string,
    isActive: boolean
) {
    try {
        return await prisma.attribute.update({
            where: { id },
            data: { isActive },
        });
    } catch (error) {
        if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2025"
        ) {
            throw new AttributeServiceError(
                "Attribute not found.",
                "ATTRIBUTE_NOT_FOUND",
                404
            );
        }

        throw error;
    }
}

// Delete Attribute
export async function deleteAttribute(id: string) {
    return prisma.$transaction(
        async (tx) => {
            const existing = await tx.attribute.findUnique({
                where: { id },
                select: {
                    id: true,
                    _count: {
                        select: {
                            categoryAttributes: true,
                        },
                    },
                },
            });

            if (!existing) {
                throw new AttributeServiceError(
                    "Attribute not found.",
                    "ATTRIBUTE_NOT_FOUND",
                    404
                );
            }

            if (existing._count.categoryAttributes > 0) {
                throw new AttributeServiceError(
                    "This attribute is assigned to one or more categories. Remove its category assignments before deleting it.",
                    "ATTRIBUTE_HAS_CATEGORY_DEPENDENCIES",
                    409
                );
            }

            return tx.attribute.delete({
                where: { id },
            });
        },
        {
            isolationLevel:
                Prisma.TransactionIsolationLevel.Serializable,
        }
    );
}
