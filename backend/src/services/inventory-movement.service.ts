import { Prisma, MovementType } from "../../generated/prisma/client.js";
import { prisma } from "../config/prisma.js";

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_REFERENCE_TYPE_LENGTH = 30;

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class InventoryMovementServiceError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly statusCode: number = 400
    ) {
        super(message);
        this.name = "InventoryMovementServiceError";
    }
}

export interface InventoryMovementListQuery {
    page?: number;
    limit?: number;
    variantId?: string;
    warehouseId?: string;
    movementType?: MovementType;
    referenceType?: string;
    referenceId?: string;
    createdBy?: string;
    from?: Date | string;
    to?: Date | string;
}

interface PaginationInput {
    page?: number;
    limit?: number;
}

function normalizeUuid(value: unknown, fieldName: string): string {
    if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
        throw new InventoryMovementServiceError(
            `${fieldName} must be a valid UUID.`,
            `INVALID_${fieldName.replace(/([A-Z])/g, "_$1").toUpperCase()}`,
            400
        );
    }

    return value;
}

function normalizeOptionalUuid(
    value: unknown,
    fieldName: string
): string | undefined {
    if (value === undefined || value === null || value === "") {
        return undefined;
    }

    return normalizeUuid(value, fieldName);
}

function normalizeText(
    value: unknown,
    fieldName: string,
    options: {
        required?: boolean;
        maxLength?: number;
        defaultValue?: string;
    } = {}
): string {
    const {
        required = false,
        maxLength = MAX_REFERENCE_TYPE_LENGTH,
        defaultValue = "",
    } = options;

    if (value === undefined || value === null) {
        if (required) {
            throw new InventoryMovementServiceError(
                `${fieldName} is required.`,
                `INVALID_${fieldName.replace(/([A-Z])/g, "_$1").toUpperCase()}`,
                400
            );
        }

        return defaultValue;
    }

    if (typeof value !== "string") {
        throw new InventoryMovementServiceError(
            `${fieldName} must be a string.`,
            `INVALID_${fieldName.replace(/([A-Z])/g, "_$1").toUpperCase()}`,
            400
        );
    }

    const normalized = value.trim();

    if (required && normalized.length === 0) {
        throw new InventoryMovementServiceError(
            `${fieldName} cannot be empty.`,
            `INVALID_${fieldName.replace(/([A-Z])/g, "_$1").toUpperCase()}`,
            400
        );
    }

    if (normalized.length > maxLength) {
        throw new InventoryMovementServiceError(
            `${fieldName} cannot exceed ${maxLength} characters.`,
            `INVALID_${fieldName.replace(/([A-Z])/g, "_$1").toUpperCase()}`,
            400
        );
    }

    return normalized;
}

function normalizePagination(query: PaginationInput) {
    const page = query.page ?? DEFAULT_PAGE;
    const requestedLimit = query.limit ?? DEFAULT_LIMIT;

    if (!Number.isSafeInteger(page) || page < 1) {
        throw new InventoryMovementServiceError(
            "page must be a positive integer.",
            "INVALID_PAGE",
            400
        );
    }

    if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
        throw new InventoryMovementServiceError(
            "limit must be a positive integer.",
            "INVALID_LIMIT",
            400
        );
    }

    const limit = Math.min(requestedLimit, MAX_LIMIT);

    return {
        page,
        limit,
        skip: (page - 1) * limit,
    };
}

function normalizeDate(
    value: Date | string | undefined,
    fieldName: string
): Date | undefined {
    if (value === undefined || value === null || value === "") {
        return undefined;
    }

    const date = value instanceof Date ? value : new Date(value);

    if (Number.isNaN(date.getTime())) {
        throw new InventoryMovementServiceError(
            `${fieldName} must be a valid date.`,
            `INVALID_${fieldName.toUpperCase()}`,
            400
        );
    }

    return date;
}

function throwPrismaError(error: unknown): never {
    if (error instanceof InventoryMovementServiceError) {
        throw error;
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2003") {
            throw new InventoryMovementServiceError(
                "The requested inventory movement references a related record that is no longer available.",
                "INVENTORY_MOVEMENT_RELATION_CONFLICT",
                409
            );
        }

        if (error.code === "P2025") {
            throw new InventoryMovementServiceError(
                "The requested inventory movement was not found.",
                "INVENTORY_MOVEMENT_NOT_FOUND",
                404
            );
        }
    }

    throw error;
}

/**
 * Returns a paginated, filterable history of inventory movements.
 * This function is read-only: it never changes inventory or movement records.
 */
export async function listInventoryMovements(
    query: InventoryMovementListQuery = {}
) {
    try {
        const { page, limit, skip } = normalizePagination(query);

        const variantId = normalizeOptionalUuid(
            query.variantId,
            "variantId"
        );
        const warehouseId = normalizeOptionalUuid(
            query.warehouseId,
            "warehouseId"
        );
        const referenceId = normalizeOptionalUuid(
            query.referenceId,
            "referenceId"
        );
        const createdBy = normalizeOptionalUuid(
            query.createdBy,
            "createdBy"
        );

        const movementType = query.movementType;

        if (
            movementType !== undefined &&
            !Object.values(MovementType).includes(movementType)
        ) {
            throw new InventoryMovementServiceError(
                "movementType is invalid.",
                "INVALID_MOVEMENT_TYPE",
                400
            );
        }

        const referenceType =
            query.referenceType === undefined
                ? undefined
                : normalizeText(query.referenceType, "referenceType", {
                      required: true,
                      maxLength: MAX_REFERENCE_TYPE_LENGTH,
                  });

        const from = normalizeDate(query.from, "from");
        const to = normalizeDate(query.to, "to");

        if (from && to && from > to) {
            throw new InventoryMovementServiceError(
                "from must be earlier than or equal to to.",
                "INVALID_DATE_RANGE",
                400
            );
        }

        const where: Prisma.InventoryMovementWhereInput = {
            ...(variantId ? { variantId } : {}),
            ...(warehouseId ? { warehouseId } : {}),
            ...(movementType ? { movementType } : {}),
            ...(referenceType ? { referenceType } : {}),
            ...(referenceId ? { referenceId } : {}),
            ...(createdBy ? { createdBy } : {}),
            ...(from || to
                ? {
                      createdAt: {
                          ...(from ? { gte: from } : {}),
                          ...(to ? { lte: to } : {}),
                      },
                  }
                : {}),
        };

        const [items, total] = await prisma.$transaction([
            prisma.inventoryMovement.findMany({
                where,
                include: {
                    productVariants: {
                        include: {
                            product: {
                                select: {
                                    id: true,
                                    name: true,
                                    slug: true,
                                },
                            },
                        },
                    },
                    warehouses: true,
                    adminUsers: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                        },
                    },
                },
                orderBy: [
                    { createdAt: "desc" },
                    { id: "desc" },
                ],
                skip,
                take: limit,
            }),
            prisma.inventoryMovement.count({ where }),
        ]);

        return {
            data: items,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
                hasNextPage: page * limit < total,
                hasPreviousPage: page > 1,
            },
        };
    } catch (error) {
        throwPrismaError(error);
    }
}

/**
 * Returns one inventory movement with its related variant, product,
 * warehouse, and the admin who recorded it.
 * This function is read-only.
 */
export async function getInventoryMovementById(id: string) {
    try {
        const movementId = normalizeUuid(id, "movementId");

        const movement = await prisma.inventoryMovement.findUnique({
            where: { id: movementId },
            include: {
                productVariants: {
                    include: {
                        product: true,
                    },
                },
                warehouses: true,
                adminUsers: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                    },
                },
            },
        });

        if (!movement) {
            throw new InventoryMovementServiceError(
                "The inventory movement was not found.",
                "INVENTORY_MOVEMENT_NOT_FOUND",
                404
            );
        }

        return movement;
    } catch (error) {
        throwPrismaError(error);
    }
}
