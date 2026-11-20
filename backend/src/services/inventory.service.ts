import { randomUUID } from "node:crypto";
import { Prisma, MovementType } from "../../generated/prisma/client.js";
import { prisma } from "../config/prisma.js";

type TransactionClient = Prisma.TransactionClient;

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_NOTE_LENGTH = 5000;
const MAX_REFERENCE_TYPE_LENGTH = 30;

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class InventoryServiceError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly statusCode: number = 400
    ) {
        super(message);
        this.name = "InventoryServiceError";
    }
}

export interface InventoryListQuery {
    page?: number;
    limit?: number;
    search?: string;
    warehouseId?: string;
    variantId?: string;
    productId?: string;
    lowStock?: boolean;
    isWarehouseActive?: boolean;
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

export interface InventoryOperationInput {
    variantId: string;
    warehouseId: string;
    quantity: number;
    note?: string;
    referenceType?: string;
    referenceId?: string;
    createdBy?: string;
}

export interface InventoryAdjustmentInput {
    variantId: string;
    warehouseId: string;
    quantityDelta: number;
    note: string;
    referenceType?: string;
    referenceId?: string;
    createdBy?: string;
}

export interface InventoryTransferInput {
    variantId: string;
    sourceWarehouseId: string;
    destinationWarehouseId: string;
    quantity: number;
    note?: string;
    referenceId?: string;
    createdBy?: string;
}

export interface UpdateReorderLevelInput {
    reorderLevel: number;
}

interface PaginationInput {
    page?: number;
    limit?: number;
}

function normalizeUuid(value: unknown, fieldName: string): string {
    if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
        throw new InventoryServiceError(
            `${fieldName} must be a valid UUID.`,
            "INVALID_UUID",
            400
        );
    }

    return value;
}

function normalizePositiveInteger(
    value: unknown,
    fieldName: string
): number {
    if (
        typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value <= 0 ||
        value > 2_147_483_647
    ) {
        throw new InventoryServiceError(
            `${fieldName} must be a positive safe integer.`,
            `INVALID_${fieldName.replace(/([A-Z])/g, "_$1").toUpperCase()}`,
            400
        );
    }

    return value;
}

function normalizeNonNegativeInteger(
    value: unknown,
    fieldName: string
): number {
    if (
        typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value < 0 ||
        value > 2_147_483_647
    ) {
        throw new InventoryServiceError(
            `${fieldName} must be a non-negative safe integer.`,
            `INVALID_${fieldName.replace(/([A-Z])/g, "_$1").toUpperCase()}`,
            400
        );
    }

    return value;
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
        maxLength = MAX_NOTE_LENGTH,
        defaultValue = "",
    } = options;

    if (value === undefined || value === null) {
        if (required) {
            throw new InventoryServiceError(
                `${fieldName} is required.`,
                `INVALID_${fieldName.replace(/([A-Z])/g, "_$1").toUpperCase()}`,
                400
            );
        }

        return defaultValue;
    }

    if (typeof value !== "string") {
        throw new InventoryServiceError(
            `${fieldName} must be a string.`,
            `INVALID_${fieldName.replace(/([A-Z])/g, "_$1").toUpperCase()}`,
            400
        );
    }

    const normalized = value.trim();

    if (required && normalized.length === 0) {
        throw new InventoryServiceError(
            `${fieldName} cannot be empty.`,
            `INVALID_${fieldName.replace(/([A-Z])/g, "_$1").toUpperCase()}`,
            400
        );
    }

    if (normalized.length > maxLength) {
        throw new InventoryServiceError(
            `${fieldName} cannot exceed ${maxLength} characters.`,
            `INVALID_${fieldName.replace(/([A-Z])/g, "_$1").toUpperCase()}`,
            400
        );
    }

    return normalized;
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

function normalizePagination(query: PaginationInput) {
    const page = query.page ?? DEFAULT_PAGE;
    const requestedLimit = query.limit ?? DEFAULT_LIMIT;

    if (!Number.isSafeInteger(page) || page < 1) {
        throw new InventoryServiceError(
            "page must be a positive integer.",
            "INVALID_PAGE",
            400
        );
    }

    if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
        throw new InventoryServiceError(
            "limit must be a positive integer.",
            "INVALID_LIMIT",
            400
        );
    }

    return {
        page,
        limit: Math.min(requestedLimit, MAX_LIMIT),
        skip: (page - 1) * Math.min(requestedLimit, MAX_LIMIT),
    };
}

function normalizeDate(value: Date | string | undefined, fieldName: string) {
    if (value === undefined) return undefined;

    const date = value instanceof Date ? value : new Date(value);

    if (Number.isNaN(date.getTime())) {
        throw new InventoryServiceError(
            `${fieldName} must be a valid date.`,
            `INVALID_${fieldName.toUpperCase()}`,
            400
        );
    }

    return date;
}

function normalizeMovementMetadata(input: {
    note?: string;
    referenceType?: string;
    referenceId?: string;
    createdBy?: string;
}) {
    return {
        note: normalizeText(input.note, "note", {
            required: false,
            maxLength: MAX_NOTE_LENGTH,
        }),
        referenceType: normalizeText(
            input.referenceType ?? "MANUAL",
            "referenceType",
            {
                required: true,
                maxLength: MAX_REFERENCE_TYPE_LENGTH,
            }
        ),
        referenceId: normalizeOptionalUuid(
            input.referenceId,
            "referenceId"
        ),
        createdBy: normalizeOptionalUuid(input.createdBy, "createdBy"),
    };
}

function throwPrismaError(error: unknown): never {
    if (error instanceof InventoryServiceError) {
        throw error;
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2002") {
            throw new InventoryServiceError(
                "A conflicting inventory record already exists.",
                "INVENTORY_CONFLICT",
                409
            );
        }

        if (error.code === "P2003") {
            throw new InventoryServiceError(
                "The operation references a related record that does not exist or cannot be changed.",
                "INVENTORY_RELATION_CONFLICT",
                409
            );
        }

        if (error.code === "P2025") {
            throw new InventoryServiceError(
                "The requested inventory record was not found.",
                "INVENTORY_NOT_FOUND",
                404
            );
        }

        if (error.code === "P2034") {
            throw new InventoryServiceError(
                "The inventory changed during this operation. Please retry the request.",
                "INVENTORY_CONCURRENT_MODIFICATION",
                409
            );
        }
    }

    throw error;
}

async function assertVariantExists(
    tx: TransactionClient,
    variantId: string,
    requireActive = false
) {
    const variant = await tx.productVariant.findFirst({
        where: {
            id: variantId,
            product: {
                is: {
                    deletedAt: null,
                },
            },
        },
        select: {
            id: true,
            isActive: true,
            productId: true,
        },
    });

    if (!variant) {
        throw new InventoryServiceError(
            "The product variant was not found.",
            "VARIANT_NOT_FOUND",
            404
        );
    }

    if (requireActive && !variant.isActive) {
        throw new InventoryServiceError(
            "Inventory cannot be reserved or dispatched for an inactive variant.",
            "VARIANT_INACTIVE",
            409
        );
    }

    return variant;
}

async function assertWarehouseExists(
    tx: TransactionClient,
    warehouseId: string,
    requireActive = true
) {
    const warehouse = await tx.warehouse.findUnique({
        where: { id: warehouseId },
        select: {
            id: true,
            isActive: true,
        },
    });

    if (!warehouse) {
        throw new InventoryServiceError(
            "The warehouse was not found.",
            "WAREHOUSE_NOT_FOUND",
            404
        );
    }

    if (requireActive && !warehouse.isActive) {
        throw new InventoryServiceError(
            "This warehouse is inactive and cannot receive new inventory operations.",
            "WAREHOUSE_INACTIVE",
            409
        );
    }

    return warehouse;
}

async function getInventoryRecord(
    tx: TransactionClient,
    variantId: string,
    warehouseId: string
) {
    return tx.inventory.findUnique({
        where: {
            variantId_warehouseId: {
                variantId,
                warehouseId,
            },
        },
    });
}

async function getOrCreateInventoryRecord(
    tx: TransactionClient,
    variantId: string,
    warehouseId: string
) {
    return tx.inventory.upsert({
        where: {
            variantId_warehouseId: {
                variantId,
                warehouseId,
            },
        },
        create: {
            variantId,
            warehouseId,
            quantityOnHand: 0,
            quantityReserved: 0,
            reorderLevel: 0,
        },
        update: {},
    });
}

async function createMovement(
    tx: TransactionClient,
    input: {
        variantId: string;
        warehouseId: string;
        movementType: MovementType;
        quantityDelta: number;
        referenceType: string;
        referenceId?: string;
        note: string;
        createdBy?: string;
    }
) {
    return tx.inventoryMovement.create({
        data: {
            variantId: input.variantId,
            warehouseId: input.warehouseId,
            movementType: input.movementType,
            quantityDelta: input.quantityDelta,
            referenceType: input.referenceType,
            referenceId: input.referenceId,
            note: input.note,
            createdBy: input.createdBy,
        },
    });
}

function ensureAvailableStock(
    inventory: {
        quantityOnHand: number;
        quantityReserved: number;
    },
    quantity: number
) {
    const available = inventory.quantityOnHand - inventory.quantityReserved;

    if (available < quantity) {
        throw new InventoryServiceError(
            `Insufficient available stock. Available: ${available}, requested: ${quantity}.`,
            "INSUFFICIENT_STOCK",
            409
        );
    }
}

function ensureSafeQuantityResult(value: number, fieldName: string) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new InventoryServiceError(
            `${fieldName} would become invalid.`,
            "INVALID_INVENTORY_RESULT",
            409
        );
    }
}

export async function listInventory(query: InventoryListQuery = {}) {
    try {
        const { page, limit, skip } = normalizePagination(query);

        const warehouseId = normalizeOptionalUuid(
            query.warehouseId,
            "warehouseId"
        );
        const variantId = normalizeOptionalUuid(
            query.variantId,
            "variantId"
        );
        const productId = normalizeOptionalUuid(
            query.productId,
            "productId"
        );

        const search =
            typeof query.search === "string" ? query.search.trim() : "";

        if (search.length > 150) {
            throw new InventoryServiceError(
                "search cannot exceed 150 characters.",
                "INVALID_SEARCH",
                400
            );
        }

        const where: Prisma.InventoryWhereInput = {
            ...(warehouseId ? { warehouseId } : {}),
            ...(variantId ? { variantId } : {}),
            ...(productId
                ? {
                      productVariants: {
                          is: {
                              productId,
                          },
                      },
                  }
                : {}),
            ...(query.isWarehouseActive !== undefined
                ? {
                      warehouses: {
                          is: {
                              isActive: query.isWarehouseActive,
                          },
                      },
                  }
                : {}),
            ...(query.lowStock
                ? {
                      id: {
                          in: [],
                      },
                  }
                : {}),
            ...(search
                ? {
                      OR: [
                          {
                              productVariants: {
                                  is: {
                                      sku: {
                                          contains: search,
                                          mode: "insensitive",
                                      },
                                  },
                              },
                          },
                          {
                              productVariants: {
                                  is: {
                                      title: {
                                          contains: search,
                                          mode: "insensitive",
                                      },
                                  },
                              },
                          },
                          {
                              productVariants: {
                                  is: {
                                      product: {
                                          is: {
                                              name: {
                                                  contains: search,
                                                  mode: "insensitive",
                                              },
                                          },
                                      },
                                  },
                              },
                          },
                          {
                              warehouses: {
                                  is: {
                                      name: {
                                          contains: search,
                                          mode: "insensitive",
                                      },
                                  },
                              },
                          },
                          {
                              warehouses: {
                                  is: {
                                      code: {
                                          contains: search,
                                          mode: "insensitive",
                                      },
                                  },
                              },
                          },
                      ],
                  }
                : {}),
        };

        if (query.lowStock) {
            const lowStockRows = await prisma.$queryRaw<Array<{ id: string }>>(
                Prisma.sql`
                    SELECT id
                    FROM inventory
                    WHERE quantity_on_hand <= reorder_level
                `
            );

            where.id = {
                in: lowStockRows.map((row) => row.id),
            };
        }

        const [items, total] = await prisma.$transaction([
            prisma.inventory.findMany({
                where,
                include: {
                    productVariants: {
                        include: {
                            product: {
                                select: {
                                    id: true,
                                    name: true,
                                    slug: true,
                                    status: true,
                                },
                            },
                        },
                    },
                    warehouses: true,
                },
                orderBy: [
                    { updatedAt: "desc" },
                    { id: "asc" },
                ],
                skip,
                take: limit,
            }),
            prisma.inventory.count({ where }),
        ]);

        const data = items.map((item) => ({
            ...item,
            quantityAvailable:
                item.quantityOnHand - item.quantityReserved,
            isLowStock: item.quantityOnHand <= item.reorderLevel,
        }));

        return {
            data,
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

export async function getInventoryById(id: string) {
    try {
        const inventoryId = normalizeUuid(id, "inventoryId");

        const inventory = await prisma.inventory.findUnique({
            where: { id: inventoryId },
            include: {
                productVariants: {
                    include: {
                        product: true,
                        attributeValues: {
                            include: {
                                categoryAttribute: {
                                    include: {
                                        attribute: true,
                                    },
                                },
                                option: true,
                                selectedOptions: {
                                    include: {
                                        option: true,
                                    },
                                },
                            },
                        },
                    },
                },
                warehouses: true,
            },
        });

        if (!inventory) {
            throw new InventoryServiceError(
                "The inventory record was not found.",
                "INVENTORY_NOT_FOUND",
                404
            );
        }

        return {
            ...inventory,
            quantityAvailable:
                inventory.quantityOnHand - inventory.quantityReserved,
            isLowStock:
                inventory.quantityOnHand <= inventory.reorderLevel,
        };
    } catch (error) {
        throwPrismaError(error);
    }
}

export async function getVariantInventory(variantId: string) {
    try {
        const normalizedVariantId = normalizeUuid(
            variantId,
            "variantId"
        );

        const variant = await prisma.productVariant.findFirst({
            where: {
                id: normalizedVariantId,
                product: {
                    is: {
                        deletedAt: null,
                    },
                },
            },
            include: {
                product: {
                    select: {
                        id: true,
                        name: true,
                        slug: true,
                        status: true,
                    },
                },
            },
        });

        if (!variant) {
            throw new InventoryServiceError(
                "The product variant was not found.",
                "VARIANT_NOT_FOUND",
                404
            );
        }

        const records = await prisma.inventory.findMany({
            where: {
                variantId: normalizedVariantId,
            },
            include: {
                warehouses: true,
            },
            orderBy: {
                warehouses: {
                    name: "asc",
                },
            },
        });

        const inventory = records.map((record) => ({
            ...record,
            quantityAvailable:
                record.quantityOnHand - record.quantityReserved,
            isLowStock: record.quantityOnHand <= record.reorderLevel,
        }));

        return {
            variant,
            inventory,
            totals: {
                quantityOnHand: inventory.reduce(
                    (sum, item) => sum + item.quantityOnHand,
                    0
                ),
                quantityReserved: inventory.reduce(
                    (sum, item) => sum + item.quantityReserved,
                    0
                ),
                quantityAvailable: inventory.reduce(
                    (sum, item) => sum + item.quantityAvailable,
                    0
                ),
            },
        };
    } catch (error) {
        throwPrismaError(error);
    }
}

export async function updateReorderLevel(
    id: string,
    input: UpdateReorderLevelInput
) {
    try {
        const inventoryId = normalizeUuid(id, "inventoryId");
        const reorderLevel = normalizeNonNegativeInteger(
            input.reorderLevel,
            "reorderLevel"
        );

        const updated = await prisma.inventory.update({
            where: { id: inventoryId },
            data: { reorderLevel },
            include: {
                productVariants: true,
                warehouses: true,
            },
        });

        return {
            message: "Inventory reorder level updated successfully.",
            data: {
                ...updated,
                quantityAvailable:
                    updated.quantityOnHand - updated.quantityReserved,
                isLowStock:
                    updated.quantityOnHand <= updated.reorderLevel,
            },
        };
    } catch (error) {
        throwPrismaError(error);
    }
}

export async function stockIn(input: InventoryOperationInput) {
    try {
        const variantId = normalizeUuid(input.variantId, "variantId");
        const warehouseId = normalizeUuid(
            input.warehouseId,
            "warehouseId"
        );
        const quantity = normalizePositiveInteger(
            input.quantity,
            "quantity"
        );
        const metadata = normalizeMovementMetadata(input);

        return await prisma.$transaction(
            async (tx) => {
                await assertVariantExists(tx, variantId, false);
                await assertWarehouseExists(tx, warehouseId, true);

                const inventory = await getOrCreateInventoryRecord(
                    tx,
                    variantId,
                    warehouseId
                );

                const nextQuantity = inventory.quantityOnHand + quantity;
                ensureSafeQuantityResult(nextQuantity, "quantityOnHand");

                const updated = await tx.inventory.update({
                    where: { id: inventory.id },
                    data: {
                        quantityOnHand: {
                            increment: quantity,
                        },
                    },
                    include: {
                        productVariants: true,
                        warehouses: true,
                    },
                });

                const movement = await createMovement(tx, {
                    variantId,
                    warehouseId,
                    movementType: MovementType.STOCKIN,
                    quantityDelta: quantity,
                    referenceType: metadata.referenceType || "MANUAL",
                    referenceId: metadata.referenceId,
                    note: metadata.note,
                    createdBy: metadata.createdBy,
                });

                return {
                    message: "Stock received successfully.",
                    data: {
                        inventory: {
                            ...updated,
                            quantityAvailable:
                                updated.quantityOnHand -
                                updated.quantityReserved,
                        },
                        movement,
                    },
                };
            },
            {
                isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            }
        );
    } catch (error) {
        throwPrismaError(error);
    }
}

export async function stockOut(input: InventoryOperationInput) {
    try {
        const variantId = normalizeUuid(input.variantId, "variantId");
        const warehouseId = normalizeUuid(
            input.warehouseId,
            "warehouseId"
        );
        const quantity = normalizePositiveInteger(
            input.quantity,
            "quantity"
        );
        const metadata = normalizeMovementMetadata(input);

        return await prisma.$transaction(
            async (tx) => {
                await assertVariantExists(tx, variantId, true);
                await assertWarehouseExists(tx, warehouseId, true);

                const inventory = await getInventoryRecord(
                    tx,
                    variantId,
                    warehouseId
                );

                if (!inventory) {
                    throw new InventoryServiceError(
                        "No inventory record exists for this variant in the selected warehouse.",
                        "INVENTORY_NOT_FOUND",
                        404
                    );
                }

                ensureAvailableStock(inventory, quantity);

                const updated = await tx.inventory.update({
                    where: { id: inventory.id },
                    data: {
                        quantityOnHand: {
                            decrement: quantity,
                        },
                    },
                    include: {
                        productVariants: true,
                        warehouses: true,
                    },
                });

                const movement = await createMovement(tx, {
                    variantId,
                    warehouseId,
                    movementType: MovementType.STOCKOUT,
                    quantityDelta: -quantity,
                    referenceType: metadata.referenceType,
                    referenceId: metadata.referenceId,
                    note: metadata.note,
                    createdBy: metadata.createdBy,
                });

                return {
                    message: "Stock dispatched successfully.",
                    data: {
                        inventory: {
                            ...updated,
                            quantityAvailable:
                                updated.quantityOnHand -
                                updated.quantityReserved,
                        },
                        movement,
                    },
                };
            },
            {
                isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            }
        );
    } catch (error) {
        throwPrismaError(error);
    }
}

export async function adjustInventory(input: InventoryAdjustmentInput) {
    try {
        const variantId = normalizeUuid(input.variantId, "variantId");
        const warehouseId = normalizeUuid(
            input.warehouseId,
            "warehouseId"
        );

        if (
            typeof input.quantityDelta !== "number" ||
            !Number.isSafeInteger(input.quantityDelta) ||
            input.quantityDelta === 0 ||
            Math.abs(input.quantityDelta) > 2_147_483_647
        ) {
            throw new InventoryServiceError(
                "quantityDelta must be a non-zero safe integer.",
                "INVALID_QUANTITY_DELTA",
                400
            );
        }

        const metadata = normalizeMovementMetadata(input);

        return await prisma.$transaction(
            async (tx) => {
                await assertVariantExists(tx, variantId, false);
                await assertWarehouseExists(tx, warehouseId, true);

                const inventory = await getInventoryRecord(
                    tx,
                    variantId,
                    warehouseId
                );

                if (!inventory) {
                    throw new InventoryServiceError(
                        "No inventory record exists for this variant in the selected warehouse.",
                        "INVENTORY_NOT_FOUND",
                        404
                    );
                }

                const nextQuantity =
                    inventory.quantityOnHand + input.quantityDelta;

                ensureSafeQuantityResult(nextQuantity, "quantityOnHand");

                if (nextQuantity < inventory.quantityReserved) {
                    throw new InventoryServiceError(
                        "The adjustment cannot reduce on-hand stock below the reserved quantity.",
                        "ADJUSTMENT_BELOW_RESERVED_STOCK",
                        409
                    );
                }

                const updated = await tx.inventory.update({
                    where: { id: inventory.id },
                    data: {
                        quantityOnHand: {
                            increment: input.quantityDelta,
                        },
                    },
                    include: {
                        productVariants: true,
                        warehouses: true,
                    },
                });

                const movement = await createMovement(tx, {
                    variantId,
                    warehouseId,
                    movementType: MovementType.ADJUSTMENT,
                    quantityDelta: input.quantityDelta,
                    referenceType: metadata.referenceType,
                    referenceId: metadata.referenceId,
                    note: metadata.note,
                    createdBy: metadata.createdBy,
                });

                return {
                    message: "Inventory adjusted successfully.",
                    data: {
                        inventory: {
                            ...updated,
                            quantityAvailable:
                                updated.quantityOnHand -
                                updated.quantityReserved,
                        },
                        movement,
                    },
                };
            },
            {
                isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            }
        );
    } catch (error) {
        throwPrismaError(error);
    }
}

export async function returnStock(input: InventoryOperationInput) {
    try {
        const variantId = normalizeUuid(input.variantId, "variantId");
        const warehouseId = normalizeUuid(
            input.warehouseId,
            "warehouseId"
        );
        const quantity = normalizePositiveInteger(
            input.quantity,
            "quantity"
        );
        const metadata = normalizeMovementMetadata({
            ...input,
            referenceType: input.referenceType ?? "RETURN",
        });

        return await prisma.$transaction(
            async (tx) => {
                await assertVariantExists(tx, variantId, false);
                await assertWarehouseExists(tx, warehouseId, true);

                const inventory = await getOrCreateInventoryRecord(
                    tx,
                    variantId,
                    warehouseId
                );

                const nextQuantity = inventory.quantityOnHand + quantity;
                ensureSafeQuantityResult(nextQuantity, "quantityOnHand");

                const updated = await tx.inventory.update({
                    where: { id: inventory.id },
                    data: {
                        quantityOnHand: {
                            increment: quantity,
                        },
                    },
                    include: {
                        productVariants: true,
                        warehouses: true,
                    },
                });

                const movement = await createMovement(tx, {
                    variantId,
                    warehouseId,
                    movementType: MovementType.RETURN,
                    quantityDelta: quantity,
                    referenceType: metadata.referenceType || "RETURN",
                    referenceId: metadata.referenceId,
                    note: metadata.note,
                    createdBy: metadata.createdBy,
                });

                return {
                    message: "Returned stock recorded successfully.",
                    data: {
                        inventory: {
                            ...updated,
                            quantityAvailable:
                                updated.quantityOnHand -
                                updated.quantityReserved,
                        },
                        movement,
                    },
                };
            },
            {
                isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            }
        );
    } catch (error) {
        throwPrismaError(error);
    }
}

export async function reserveInventory(input: InventoryOperationInput) {
    try {
        const variantId = normalizeUuid(input.variantId, "variantId");
        const warehouseId = normalizeUuid(
            input.warehouseId,
            "warehouseId"
        );
        const quantity = normalizePositiveInteger(
            input.quantity,
            "quantity"
        );
        const metadata = normalizeMovementMetadata(input);

        return await prisma.$transaction(
            async (tx) => {
                await assertVariantExists(tx, variantId, true);
                await assertWarehouseExists(tx, warehouseId, true);

                const inventory = await getInventoryRecord(
                    tx,
                    variantId,
                    warehouseId
                );

                if (!inventory) {
                    throw new InventoryServiceError(
                        "No inventory record exists for this variant in the selected warehouse.",
                        "INVENTORY_NOT_FOUND",
                        404
                    );
                }

                ensureAvailableStock(inventory, quantity);

                const nextReserved = inventory.quantityReserved + quantity;
                ensureSafeQuantityResult(nextReserved, "quantityReserved");

                const updated = await tx.inventory.update({
                    where: { id: inventory.id },
                    data: {
                        quantityReserved: {
                            increment: quantity,
                        },
                    },
                    include: {
                        productVariants: true,
                        warehouses: true,
                    },
                });

                const movement = await createMovement(tx, {
                    variantId,
                    warehouseId,
                    movementType: MovementType.RESERVATION,
                    quantityDelta: quantity,
                    referenceType: metadata.referenceType || "RESERVATION",
                    referenceId: metadata.referenceId,
                    note: metadata.note,
                    createdBy: metadata.createdBy,
                });

                return {
                    message: "Inventory reserved successfully.",
                    data: {
                        inventory: {
                            ...updated,
                            quantityAvailable:
                                updated.quantityOnHand -
                                updated.quantityReserved,
                        },
                        movement,
                    },
                };
            },
            {
                isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            }
        );
    } catch (error) {
        throwPrismaError(error);
    }
}

export async function releaseInventory(input: InventoryOperationInput) {
    try {
        const variantId = normalizeUuid(input.variantId, "variantId");
        const warehouseId = normalizeUuid(
            input.warehouseId,
            "warehouseId"
        );
        const quantity = normalizePositiveInteger(
            input.quantity,
            "quantity"
        );
        const metadata = normalizeMovementMetadata(input);

        return await prisma.$transaction(
            async (tx) => {
                await assertVariantExists(tx, variantId, false);
                await assertWarehouseExists(tx, warehouseId, false);

                const inventory = await getInventoryRecord(
                    tx,
                    variantId,
                    warehouseId
                );

                if (!inventory) {
                    throw new InventoryServiceError(
                        "No inventory record exists for this variant in the selected warehouse.",
                        "INVENTORY_NOT_FOUND",
                        404
                    );
                }

                if (inventory.quantityReserved < quantity) {
                    throw new InventoryServiceError(
                        "The release quantity exceeds the reserved quantity.",
                        "INSUFFICIENT_RESERVED_STOCK",
                        409
                    );
                }

                const updated = await tx.inventory.update({
                    where: { id: inventory.id },
                    data: {
                        quantityReserved: {
                            decrement: quantity,
                        },
                    },
                    include: {
                        productVariants: true,
                        warehouses: true,
                    },
                });

                const movement = await createMovement(tx, {
                    variantId,
                    warehouseId,
                    movementType: MovementType.RESERVATION_RELEASE,
                    quantityDelta: -quantity,
                    referenceType: metadata.referenceType || "RESERVATION",
                    referenceId: metadata.referenceId,
                    note: metadata.note,
                    createdBy: metadata.createdBy,
                });

                return {
                    message: "Inventory reservation released successfully.",
                    data: {
                        inventory: {
                            ...updated,
                            quantityAvailable:
                                updated.quantityOnHand -
                                updated.quantityReserved,
                        },
                        movement,
                    },
                };
            },
            {
                isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            }
        );
    } catch (error) {
        throwPrismaError(error);
    }
}

export async function transferInventory(input: InventoryTransferInput) {
    try {
        const variantId = normalizeUuid(input.variantId, "variantId");
        const sourceWarehouseId = normalizeUuid(
            input.sourceWarehouseId,
            "sourceWarehouseId"
        );
        const destinationWarehouseId = normalizeUuid(
            input.destinationWarehouseId,
            "destinationWarehouseId"
        );
        const quantity = normalizePositiveInteger(
            input.quantity,
            "quantity"
        );

        if (sourceWarehouseId === destinationWarehouseId) {
            throw new InventoryServiceError(
                "Source and destination warehouses must be different.",
                "INVALID_TRANSFER_WAREHOUSES",
                400
            );
        }

        const metadata = normalizeMovementMetadata({
            ...input,
            referenceType: "TRANSFER",
        });
        const transferReferenceId =
            metadata.referenceId ?? randomUUID();

        return await prisma.$transaction(
            async (tx) => {
                await assertVariantExists(tx, variantId, false);
                await assertWarehouseExists(tx, sourceWarehouseId, true);
                await assertWarehouseExists(
                    tx,
                    destinationWarehouseId,
                    true
                );

                const sourceInventory = await getInventoryRecord(
                    tx,
                    variantId,
                    sourceWarehouseId
                );

                if (!sourceInventory) {
                    throw new InventoryServiceError(
                        "No inventory record exists for this variant in the source warehouse.",
                        "SOURCE_INVENTORY_NOT_FOUND",
                        404
                    );
                }

                ensureAvailableStock(sourceInventory, quantity);

                const destinationInventory =
                    await getOrCreateInventoryRecord(
                        tx,
                        variantId,
                        destinationWarehouseId
                    );

                const nextDestinationQuantity =
                    destinationInventory.quantityOnHand + quantity;

                ensureSafeQuantityResult(
                    nextDestinationQuantity,
                    "quantityOnHand"
                );

                const updatedSource = await tx.inventory.update({
                    where: { id: sourceInventory.id },
                    data: {
                        quantityOnHand: {
                            decrement: quantity,
                        },
                    },
                    include: {
                        productVariants: true,
                        warehouses: true,
                    },
                });

                const updatedDestination = await tx.inventory.update({
                    where: { id: destinationInventory.id },
                    data: {
                        quantityOnHand: {
                            increment: quantity,
                        },
                    },
                    include: {
                        productVariants: true,
                        warehouses: true,
                    },
                });

                const sourceMovement = await createMovement(tx, {
                    variantId,
                    warehouseId: sourceWarehouseId,
                    movementType: MovementType.STOCKOUT,
                    quantityDelta: -quantity,
                    referenceType: "TRANSFER",
                    referenceId: transferReferenceId,
                    note: metadata.note || "Inventory transfer out.",
                    createdBy: metadata.createdBy,
                });

                const destinationMovement = await createMovement(tx, {
                    variantId,
                    warehouseId: destinationWarehouseId,
                    movementType: MovementType.STOCKIN,
                    quantityDelta: quantity,
                    referenceType: "TRANSFER",
                    referenceId: transferReferenceId,
                    note: metadata.note || "Inventory transfer in.",
                    createdBy: metadata.createdBy,
                });

                return {
                    message: "Inventory transferred successfully.",
                    data: {
                        referenceId: transferReferenceId,
                        source: {
                            inventory: {
                                ...updatedSource,
                                quantityAvailable:
                                    updatedSource.quantityOnHand -
                                    updatedSource.quantityReserved,
                            },
                            movement: sourceMovement,
                        },
                        destination: {
                            inventory: {
                                ...updatedDestination,
                                quantityAvailable:
                                    updatedDestination.quantityOnHand -
                                    updatedDestination.quantityReserved,
                            },
                            movement: destinationMovement,
                        },
                    },
                };
            },
            {
                isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            }
        );
    } catch (error) {
        throwPrismaError(error);
    }
}

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
            throw new InventoryServiceError(
                "from must be earlier than or equal to to.",
                "INVALID_DATE_RANGE",
                400
            );
        }

        const where: Prisma.InventoryMovementWhereInput = {
            ...(variantId ? { variantId } : {}),
            ...(warehouseId ? { warehouseId } : {}),
            ...(query.movementType
                ? { movementType: query.movementType }
                : {}),
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
            throw new InventoryServiceError(
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
