import type { Request, Response } from "express";
import { MovementType } from "../../generated/prisma/client.js";
import {
    InventoryServiceError,
    listInventory,
    getInventoryById,
    getVariantInventory,
    updateReorderLevel,
    stockIn,
    stockOut,
    adjustInventory,
    returnStock,
    reserveInventory,
    releaseInventory,
    transferInventory,
    listInventoryMovements,
    getInventoryMovementById,
    type InventoryListQuery,
    type InventoryMovementListQuery,
    type InventoryOperationInput,
    type InventoryAdjustmentInput,
    type InventoryTransferInput,
} from "../services/inventory.service.js";

type ControllerHandler = (
    req: Request,
    res: Response
) => Promise<void>;

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MOVEMENT_TYPES = Object.values(MovementType) as string[];

/**
 * Converts BigInt values to strings before sending API responses.
 *
 * BigInt cannot be serialized by JSON.stringify. Converting it to a string
 * preserves the exact value (important for Rial prices) without the precision
 * loss that could occur if it were converted to Number.
 *
 * Only plain objects and arrays are traversed. Date and Prisma Decimal
 * instances are left intact so their own JSON serialization remains available.
 */
function serializeBigInts(value: unknown): unknown {
    if (typeof value === "bigint") {
        return value.toString();
    }

    if (Array.isArray(value)) {
        return value.map((item) => serializeBigInts(item));
    }

    if (value !== null && typeof value === "object") {
        const prototype = Object.getPrototypeOf(value);

        if (prototype === Object.prototype || prototype === null) {
            return Object.fromEntries(
                Object.entries(value).map(([key, item]) => [
                    key,
                    serializeBigInts(item),
                ])
            );
        }
    }

    return value;
}

function sendSuccess(
    res: Response,
    message: string,
    data: unknown,
    statusCode = 200,
    pagination?: unknown
) {
    res.status(statusCode).json(
        serializeBigInts({
            status: "success",
            message,
            data,
            ...(pagination !== undefined ? { pagination } : {}),
        })
    );
}

function sendError(
    res: Response,
    statusCode: number,
    message: string,
    code: string
) {
    res.status(statusCode).json({
        status: "error",
        message,
        code,
    });
}

function createController(handler: ControllerHandler) {
    return async (req: Request, res: Response): Promise<void> => {
        try {
            await handler(req, res);
        } catch (error) {
            if (error instanceof InventoryServiceError) {
                sendError(
                    res,
                    error.statusCode,
                    error.message,
                    error.code
                );
                return;
            }

            console.error("Inventory controller error:", error);
            sendError(
                res,
                500,
                "An unexpected error occurred.",
                "INTERNAL_SERVER_ERROR"
            );
        }
    };
}

function getAuthenticatedAdminId(req: Request): string {
    const adminUserId = req.adminAuth?.adminUserId;

    if (
        typeof adminUserId !== "string" ||
        !UUID_PATTERN.test(adminUserId)
    ) {
        throw new InventoryServiceError(
            "Authentication required.",
            "AUTHENTICATION_REQUIRED",
            401
        );
    }

    return adminUserId;
}

function getBody(req: Request): Record<string, unknown> {
    if (
        req.body === null ||
        typeof req.body !== "object" ||
        Array.isArray(req.body)
    ) {
        throw new InventoryServiceError(
            "Request body must be a JSON object.",
            "INVALID_REQUEST_BODY",
            400
        );
    }

    return req.body as Record<string, unknown>;
}

function getParam(
    req: Request,
    name: string,
    label = name
): string {
    const value = req.params[name];

    if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
        throw new InventoryServiceError(
            `${label} must be a valid UUID.`,
            `INVALID_${label.replace(/([A-Z])/g, "_$1").toUpperCase()}`,
            400
        );
    }

    return value;
}

function parseBoolean(
    value: unknown,
    fieldName: string,
    defaultValue?: boolean
): boolean | undefined {
    if (value === undefined || value === null || value === "") {
        return defaultValue;
    }

    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;

    throw new InventoryServiceError(
        `${fieldName} must be true or false.`,
        `INVALID_${fieldName.replace(/([A-Z])/g, "_$1").toUpperCase()}`,
        400
    );
}

function parsePositiveInteger(
    value: unknown,
    fieldName: string,
    defaultValue?: number
): number | undefined {
    if (value === undefined || value === null || value === "") {
        return defaultValue;
    }

    const parsed =
        typeof value === "number"
            ? value
            : typeof value === "string" && /^\d+$/.test(value)
              ? Number(value)
              : Number.NaN;

    if (
        !Number.isSafeInteger(parsed) ||
        parsed <= 0 ||
        parsed > 2_147_483_647
    ) {
        throw new InventoryServiceError(
            `${fieldName} must be a positive integer.`,
            `INVALID_${fieldName.replace(/([A-Z])/g, "_$1").toUpperCase()}`,
            400
        );
    }

    return parsed;
}

function parseNonNegativeInteger(
    value: unknown,
    fieldName: string,
    defaultValue?: number
): number | undefined {
    if (value === undefined || value === null || value === "") {
        return defaultValue;
    }

    const parsed =
        typeof value === "number"
            ? value
            : typeof value === "string" && /^\d+$/.test(value)
              ? Number(value)
              : Number.NaN;

    if (
        !Number.isSafeInteger(parsed) ||
        parsed < 0 ||
        parsed > 2_147_483_647
    ) {
        throw new InventoryServiceError(
            `${fieldName} must be a non-negative integer.`,
            `INVALID_${fieldName.replace(/([A-Z])/g, "_$1").toUpperCase()}`,
            400
        );
    }

    return parsed;
}

function parseRequiredText(
    value: unknown,
    fieldName: string,
    maxLength: number
): string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new InventoryServiceError(
            `${fieldName} is required.`,
            `INVALID_${fieldName.replace(/([A-Z])/g, "_$1").toUpperCase()}`,
            400
        );
    }

    const normalized = value.trim();

    if (normalized.length > maxLength) {
        throw new InventoryServiceError(
            `${fieldName} cannot exceed ${maxLength} characters.`,
            `INVALID_${fieldName.replace(/([A-Z])/g, "_$1").toUpperCase()}`,
            400
        );
    }

    return normalized;
}

function parseOptionalText(
    value: unknown,
    fieldName: string,
    maxLength: number
): string | undefined {
    if (value === undefined || value === null) return undefined;

    if (typeof value !== "string") {
        throw new InventoryServiceError(
            `${fieldName} must be a string.`,
            `INVALID_${fieldName.replace(/([A-Z])/g, "_$1").toUpperCase()}`,
            400
        );
    }

    const normalized = value.trim();

    if (normalized.length > maxLength) {
        throw new InventoryServiceError(
            `${fieldName} cannot exceed ${maxLength} characters.`,
            `INVALID_${fieldName.replace(/([A-Z])/g, "_$1").toUpperCase()}`,
            400
        );
    }

    return normalized;
}

function parseOptionalUuid(
    value: unknown,
    fieldName: string
): string | undefined {
    if (value === undefined || value === null || value === "") {
        return undefined;
    }

    if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
        throw new InventoryServiceError(
            `${fieldName} must be a valid UUID.`,
            `INVALID_${fieldName.replace(/([A-Z])/g, "_$1").toUpperCase()}`,
            400
        );
    }

    return value;
}

function parseInventoryOperationBody(
    body: Record<string, unknown>,
    createdBy: string
): InventoryOperationInput {
    return {
        variantId: parseRequiredText(body.variantId, "variantId", 36),
        warehouseId: parseRequiredText(body.warehouseId, "warehouseId", 36),
        quantity: parsePositiveInteger(body.quantity, "quantity")!,
        note: parseOptionalText(body.note, "note", 5000),
        referenceType: parseOptionalText(
            body.referenceType,
            "referenceType",
            30
        ),
        referenceId: parseOptionalUuid(body.referenceId, "referenceId"),
        createdBy,
    };
}

function parseDateQuery(
    value: unknown,
    fieldName: string
): string | undefined {
    if (value === undefined || value === null || value === "") {
        return undefined;
    }

    if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
        throw new InventoryServiceError(
            `${fieldName} must be a valid date.`,
            `INVALID_${fieldName.toUpperCase()}`,
            400
        );
    }

    return value;
}

export const listInventoryController = createController(
    async (req, res) => {
        const query: InventoryListQuery = {
            page: parsePositiveInteger(req.query.page, "page", 1),
            limit: parsePositiveInteger(req.query.limit, "limit", 20),
            search: parseOptionalText(req.query.search, "search", 150),
            warehouseId: parseOptionalUuid(
                req.query.warehouseId,
                "warehouseId"
            ),
            variantId: parseOptionalUuid(req.query.variantId, "variantId"),
            productId: parseOptionalUuid(req.query.productId, "productId"),
            lowStock: parseBoolean(req.query.lowStock, "lowStock", false),
            isWarehouseActive: parseBoolean(
                req.query.isWarehouseActive,
                "isWarehouseActive"
            ),
        };

        const result = await listInventory(query);

        sendSuccess(
            res,
            "Inventory records retrieved successfully.",
            result.data,
            200,
            result.pagination
        );
    }
);

export const getInventoryByIdController = createController(
    async (req, res) => {
        const id = getParam(req, "id", "inventoryId");
        const result = await getInventoryById(id);

        sendSuccess(
            res,
            "Inventory record retrieved successfully.",
            result
        );
    }
);

export const getVariantInventoryController = createController(
    async (req, res) => {
        const variantId = getParam(req, "variantId");
        const result = await getVariantInventory(variantId);

        sendSuccess(
            res,
            "Variant inventory retrieved successfully.",
            result
        );
    }
);

export const updateReorderLevelController = createController(
    async (req, res) => {
        const id = getParam(req, "id", "inventoryId");
        const body = getBody(req);

        const reorderLevel = parseNonNegativeInteger(
            body.reorderLevel,
            "reorderLevel"
        );

        const result = await updateReorderLevel(id, {
            reorderLevel: reorderLevel!,
        });

        sendSuccess(
            res,
            result.message,
            result.data
        );
    }
);

export const stockInController = createController(async (req, res) => {
    const input = parseInventoryOperationBody(
        getBody(req),
        getAuthenticatedAdminId(req)
    );
    const result = await stockIn(input);

    sendSuccess(res, result.message, result.data, 201);
});

export const stockOutController = createController(async (req, res) => {
    const input = parseInventoryOperationBody(
        getBody(req),
        getAuthenticatedAdminId(req)
    );
    const result = await stockOut(input);

    sendSuccess(res, result.message, result.data, 201);
});

export const adjustInventoryController = createController(
    async (req, res) => {
        const body = getBody(req);

        const input: InventoryAdjustmentInput = {
            variantId: parseRequiredText(body.variantId, "variantId", 36),
            warehouseId: parseRequiredText(
                body.warehouseId,
                "warehouseId",
                36
            ),
            quantityDelta:
                typeof body.quantityDelta === "number"
                    ? body.quantityDelta
                    : typeof body.quantityDelta === "string" &&
                        /^-?\d+$/.test(body.quantityDelta)
                      ? Number(body.quantityDelta)
                      : Number.NaN,
            note: parseRequiredText(body.note, "note", 5000),
            referenceType: parseOptionalText(
                body.referenceType,
                "referenceType",
                30
            ),
            referenceId: parseOptionalUuid(
                body.referenceId,
                "referenceId"
            ),
            createdBy: getAuthenticatedAdminId(req),
        };

        if (
            !Number.isSafeInteger(input.quantityDelta) ||
            input.quantityDelta === 0 ||
            Math.abs(input.quantityDelta) > 2_147_483_647
        ) {
            throw new InventoryServiceError(
                "quantityDelta must be a non-zero integer within the supported range.",
                "INVALID_QUANTITY_DELTA",
                400
            );
        }

        const result = await adjustInventory(input);
        sendSuccess(res, result.message, result.data, 201);
    }
);

export const returnStockController = createController(
    async (req, res) => {
        const input = parseInventoryOperationBody(
            getBody(req),
            getAuthenticatedAdminId(req)
        );
        const result = await returnStock(input);

        sendSuccess(res, result.message, result.data, 201);
    }
);

export const reserveInventoryController = createController(
    async (req, res) => {
        const input = parseInventoryOperationBody(
            getBody(req),
            getAuthenticatedAdminId(req)
        );
        const result = await reserveInventory(input);

        sendSuccess(res, result.message, result.data, 201);
    }
);

export const releaseInventoryController = createController(
    async (req, res) => {
        const input = parseInventoryOperationBody(
            getBody(req),
            getAuthenticatedAdminId(req)
        );
        const result = await releaseInventory(input);

        sendSuccess(res, result.message, result.data);
    }
);

export const transferInventoryController = createController(
    async (req, res) => {
        const body = getBody(req);

        const input: InventoryTransferInput = {
            variantId: parseRequiredText(body.variantId, "variantId", 36),
            sourceWarehouseId: parseRequiredText(
                body.sourceWarehouseId,
                "sourceWarehouseId",
                36
            ),
            destinationWarehouseId: parseRequiredText(
                body.destinationWarehouseId,
                "destinationWarehouseId",
                36
            ),
            quantity: parsePositiveInteger(body.quantity, "quantity")!,
            note: parseOptionalText(body.note, "note", 5000),
            referenceId: parseOptionalUuid(
                body.referenceId,
                "referenceId"
            ),
            createdBy: getAuthenticatedAdminId(req),
        };

        const result = await transferInventory(input);
        sendSuccess(res, result.message, result.data, 201);
    }
);

export const listInventoryMovementsController = createController(
    async (req, res) => {
        let movementType: MovementType | undefined;

        if (req.query.movementType !== undefined) {
            if (
                typeof req.query.movementType !== "string" ||
                !MOVEMENT_TYPES.includes(req.query.movementType)
            ) {
                throw new InventoryServiceError(
                    "movementType is invalid.",
                    "INVALID_MOVEMENT_TYPE",
                    400
                );
            }

            movementType = req.query.movementType as MovementType;
        }

        const query: InventoryMovementListQuery = {
            page: parsePositiveInteger(req.query.page, "page", 1),
            limit: parsePositiveInteger(req.query.limit, "limit", 20),
            variantId: parseOptionalUuid(req.query.variantId, "variantId"),
            warehouseId: parseOptionalUuid(
                req.query.warehouseId,
                "warehouseId"
            ),
            movementType,
            referenceType: parseOptionalText(
                req.query.referenceType,
                "referenceType",
                30
            ),
            referenceId: parseOptionalUuid(
                req.query.referenceId,
                "referenceId"
            ),
            createdBy: parseOptionalUuid(req.query.createdBy, "createdBy"),
            from: parseDateQuery(req.query.from, "from"),
            to: parseDateQuery(req.query.to, "to"),
        };

        const result = await listInventoryMovements(query);

        sendSuccess(
            res,
            "Inventory movements retrieved successfully.",
            result.data,
            200,
            result.pagination
        );
    }
);

export const getInventoryMovementByIdController = createController(
    async (req, res) => {
        const id = getParam(req, "id", "movementId");
        const result = await getInventoryMovementById(id);

        sendSuccess(
            res,
            "Inventory movement retrieved successfully.",
            result
        );
    }
);
