import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../config/prisma.js";

export class WarehouseServiceError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly statusCode: number = 400
    ) {
        super(message);
        this.name = "WarehouseServiceError";
    }
}

export interface CreateWarehouseInput {
    name: string;
    code: string;
    address: string;
    isActive?: boolean;
}

export interface UpdateWarehouseInput {
    name?: string;
    code?: string;
    address?: string;
}

export interface WarehouseListQuery {
    page?: number;
    limit?: number;
    search?: string;
    isActive?: boolean;
}

function isKnownRequestError(
    error: unknown,
    code: string
): error is Prisma.PrismaClientKnownRequestError {
    return (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === code
    );
}

function buildWarehouseInclude() {
    return {
        _count: {
            select: {
                inventory: true,
                inventoryMovements: true,
            },
        },
    } satisfies Prisma.WarehouseInclude;
}

function normalizeRequiredText(
    value: string,
    fieldName: string,
    errorCode: string,
    maxLength: number
): string {
    if (typeof value !== "string" || !value.trim()) {
        throw new WarehouseServiceError(
            `${fieldName} cannot be empty.`,
            errorCode,
            400
        );
    }

    const normalized = value.trim();

    if (normalized.length > maxLength) {
        throw new WarehouseServiceError(
            `${fieldName} cannot exceed ${maxLength} characters.`,
            errorCode,
            400
        );
    }

    return normalized;
}

function normalizeCreateInput(input: CreateWarehouseInput) {
    if (!input || typeof input !== "object") {
        throw new WarehouseServiceError(
            "A valid warehouse payload is required.",
            "WAREHOUSE_INVALID_INPUT",
            400
        );
    }

    const name = normalizeRequiredText(
        input.name,
        "Warehouse name",
        "WAREHOUSE_INVALID_NAME",
        150
    );
    const code = normalizeRequiredText(
        input.code,
        "Warehouse code",
        "WAREHOUSE_INVALID_CODE",
        50
    );
    const address = normalizeRequiredText(
        input.address,
        "Warehouse address",
        "WAREHOUSE_INVALID_ADDRESS",
        10000
    );

    if (input.isActive !== undefined && typeof input.isActive !== "boolean") {
        throw new WarehouseServiceError(
            "Warehouse isActive must be a boolean.",
            "WAREHOUSE_INVALID_STATUS",
            400
        );
    }

    return {
        name,
        code,
        address,
        isActive: input.isActive ?? true,
    };
}

// Create Warehouse
export async function createWarehouse(input: CreateWarehouseInput) {
    const data = normalizeCreateInput(input);

    try {
        return await prisma.warehouse.create({
            data,
            include: buildWarehouseInclude(),
        });
    } catch (error) {
        if (isKnownRequestError(error, "P2002")) {
            throw new WarehouseServiceError(
                "A warehouse with this code already exists.",
                "WAREHOUSE_CODE_EXISTS",
                409
            );
        }

        throw error;
    }
}

// List Warehouses
export async function listWarehouses(query: WarehouseListQuery = {}) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 25));
    const skip = (page - 1) * limit;

    const search = query.search?.trim();

    const where: Prisma.WarehouseWhereInput = {
        ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
        ...(search
            ? {
                OR: [
                    { name: { contains: search, mode: "insensitive" } },
                    { code: { contains: search, mode: "insensitive" } },
                    { address: { contains: search, mode: "insensitive" } },
                ],
            }
            : {}),
    };

    const [warehouses, total] = await prisma.$transaction([
        prisma.warehouse.findMany({
            where,
            skip,
            take: limit,
            orderBy: [{ createdAt: "desc" }, { id: "asc" }],
            include: buildWarehouseInclude(),
        }),
        prisma.warehouse.count({ where }),
    ]);

    return {
        warehouses,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
}

// Get Warehouse by ID
export async function getWarehouseById(id: string) {
    const warehouse = await prisma.warehouse.findUnique({
        where: { id },
        include: buildWarehouseInclude(),
    });

    if (!warehouse) {
        throw new WarehouseServiceError(
            "Warehouse not found.",
            "WAREHOUSE_NOT_FOUND",
            404
        );
    }

    return warehouse;
}

// Update Warehouse
export async function updateWarehouse(
    id: string,
    input: UpdateWarehouseInput
) {
    if (!input || typeof input !== "object") {
        throw new WarehouseServiceError(
            "A valid warehouse payload is required.",
            "WAREHOUSE_INVALID_INPUT",
            400
        );
    }

    const data: Prisma.WarehouseUpdateInput = {};

    if (input.name !== undefined) {
        data.name = normalizeRequiredText(
            input.name,
            "Warehouse name",
            "WAREHOUSE_INVALID_NAME",
            150
        );
    }

    if (input.code !== undefined) {
        data.code = normalizeRequiredText(
            input.code,
            "Warehouse code",
            "WAREHOUSE_INVALID_CODE",
            50
        );
    }

    if (input.address !== undefined) {
        data.address = normalizeRequiredText(
            input.address,
            "Warehouse address",
            "WAREHOUSE_INVALID_ADDRESS",
            10000
        );
    }

    if (Object.keys(data).length === 0) {
        throw new WarehouseServiceError(
            "At least one warehouse field must be provided.",
            "WAREHOUSE_EMPTY_UPDATE",
            400
        );
    }

    try {
        return await prisma.$transaction(async (tx) => {
            const existing = await tx.warehouse.findUnique({
                where: { id },
                select: { id: true },
            });

            if (!existing) {
                throw new WarehouseServiceError(
                    "Warehouse not found.",
                    "WAREHOUSE_NOT_FOUND",
                    404
                );
            }

            return tx.warehouse.update({
                where: { id },
                data,
                include: buildWarehouseInclude(),
            });
        }, {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
    } catch (error) {
        if (isKnownRequestError(error, "P2002")) {
            throw new WarehouseServiceError(
                "A warehouse with this code already exists.",
                "WAREHOUSE_CODE_EXISTS",
                409
            );
        }

        if (isKnownRequestError(error, "P2034")) {
            throw new WarehouseServiceError(
                "The warehouse could not be updated because of concurrent changes. Please try again.",
                "WAREHOUSE_UPDATE_CONFLICT",
                409
            );
        }

        if (isKnownRequestError(error, "P2025")) {
            throw new WarehouseServiceError(
                "Warehouse not found.",
                "WAREHOUSE_NOT_FOUND",
                404
            );
        }

        throw error;
    }
}

// Update Warehouse Status
export async function updateWarehouseStatus(id: string, isActive: boolean) {
    if (typeof isActive !== "boolean") {
        throw new WarehouseServiceError(
            "Warehouse status must be a boolean.",
            "WAREHOUSE_INVALID_STATUS",
            400
        );
    }

    try {
        return await prisma.$transaction(async (tx) => {
            const result = await tx.warehouse.updateMany({
                where: { id },
                data: { isActive },
            });

            if (result.count === 0) {
                throw new WarehouseServiceError(
                    "Warehouse not found.",
                    "WAREHOUSE_NOT_FOUND",
                    404
                );
            }

            return tx.warehouse.findUniqueOrThrow({
                where: { id },
                include: buildWarehouseInclude(),
            });
        }, {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
    } catch (error) {
        if (isKnownRequestError(error, "P2034")) {
            throw new WarehouseServiceError(
                "The warehouse status could not be updated because of concurrent changes. Please try again.",
                "WAREHOUSE_STATUS_UPDATE_CONFLICT",
                409
            );
        }

        if (isKnownRequestError(error, "P2025")) {
            throw new WarehouseServiceError(
                "Warehouse not found.",
                "WAREHOUSE_NOT_FOUND",
                404
            );
        }

        throw error;
    }
}

// Delete Warehouse
// A warehouse can only be physically deleted when it has no inventory
// records and no inventory movement history.
export async function deleteWarehouse(id: string) {
    try {
        return await prisma.$transaction(async (tx) => {
            const existing = await tx.warehouse.findUnique({
                where: { id },
                select: {
                    id: true,
                    _count: {
                        select: {
                            inventory: true,
                            inventoryMovements: true,
                        },
                    },
                },
            });

            if (!existing) {
                throw new WarehouseServiceError(
                    "Warehouse not found.",
                    "WAREHOUSE_NOT_FOUND",
                    404
                );
            }

            if (
                existing._count.inventory > 0 ||
                existing._count.inventoryMovements > 0
            ) {
                throw new WarehouseServiceError(
                    "This warehouse cannot be deleted because it has inventory records or movement history. Deactivate it instead.",
                    "WAREHOUSE_HAS_DEPENDENCIES",
                    409
                );
            }

            return tx.warehouse.delete({
                where: { id },
                select: {
                    id: true,
                    name: true,
                    code: true,
                },
            });
        }, {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
    } catch (error) {
        if (isKnownRequestError(error, "P2003")) {
            throw new WarehouseServiceError(
                "This warehouse is referenced by other records and cannot be deleted. Deactivate it instead.",
                "WAREHOUSE_HAS_DEPENDENCIES",
                409
            );
        }

        if (isKnownRequestError(error, "P2034")) {
            throw new WarehouseServiceError(
                "The warehouse could not be deleted because of concurrent changes. Please try again.",
                "WAREHOUSE_DELETE_CONFLICT",
                409
            );
        }

        if (isKnownRequestError(error, "P2025")) {
            throw new WarehouseServiceError(
                "Warehouse not found.",
                "WAREHOUSE_NOT_FOUND",
                404
            );
        }

        throw error;
    }
}
