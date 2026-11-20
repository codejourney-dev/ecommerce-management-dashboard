import type { Request, Response } from "express";
import { MovementType } from "../../generated/prisma/client.js";
import {
    InventoryMovementServiceError,
    listInventoryMovements,
    getInventoryMovementById,
    type InventoryMovementListQuery,
} from "../services/inventory-movement.service.js";

type ControllerHandler = (
    req: Request,
    res: Response
) => Promise<void>;

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MOVEMENT_TYPES = Object.values(MovementType) as string[];

/**
 * BigInt values cannot be serialized by JSON.stringify.
 * Convert them to strings to preserve exact integer values.
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
): void {
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
): void {
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
            if (error instanceof InventoryMovementServiceError) {
                sendError(
                    res,
                    error.statusCode,
                    error.message,
                    error.code
                );
                return;
            }

            console.error("Inventory movement controller error:", error);
            sendError(
                res,
                500,
                "An unexpected error occurred.",
                "INTERNAL_SERVER_ERROR"
            );
        }
    };
}

function invalidField(
    fieldName: string,
    message: string
): InventoryMovementServiceError {
    return new InventoryMovementServiceError(
        message,
        `INVALID_${fieldName.replace(/([A-Z])/g, "_$1").toUpperCase()}`,
        400
    );
}

function parsePositiveInteger(
    value: unknown,
    fieldName: string,
    defaultValue: number
): number {
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
        throw invalidField(
            fieldName,
            `${fieldName} must be a positive integer.`
        );
    }

    return parsed;
}

function parseOptionalUuid(
    value: unknown,
    fieldName: string
): string | undefined {
    if (value === undefined || value === null || value === "") {
        return undefined;
    }

    if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
        throw invalidField(fieldName, `${fieldName} must be a valid UUID.`);
    }

    return value;
}

function parseOptionalText(
    value: unknown,
    fieldName: string,
    maxLength: number
): string | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }

    if (typeof value !== "string") {
        throw invalidField(fieldName, `${fieldName} must be a string.`);
    }

    const normalized = value.trim();

    if (normalized.length === 0) {
        return undefined;
    }

    if (normalized.length > maxLength) {
        throw invalidField(
            fieldName,
            `${fieldName} cannot exceed ${maxLength} characters.`
        );
    }

    return normalized;
}

function parseOptionalDate(
    value: unknown,
    fieldName: "from" | "to"
): string | undefined {
    if (value === undefined || value === null || value === "") {
        return undefined;
    }

    if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
        throw invalidField(fieldName, `${fieldName} must be a valid date.`);
    }

    return value;
}

function parseMovementType(value: unknown): MovementType | undefined {
    if (value === undefined || value === null || value === "") {
        return undefined;
    }

    if (
        typeof value !== "string" ||
        !MOVEMENT_TYPES.includes(value)
    ) {
        throw invalidField("movementType", "movementType is invalid.");
    }

    return value as MovementType;
}

function getMovementId(req: Request): string {
    const id: unknown = req.params.id;

    if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
        throw invalidField("movementId", "movementId must be a valid UUID.");
    }

    return id;
}

export const listInventoryMovementsController = createController(
    async (req, res) => {
        const query: InventoryMovementListQuery = {
            page: parsePositiveInteger(req.query.page, "page", 1),
            limit: parsePositiveInteger(req.query.limit, "limit", 20),
            variantId: parseOptionalUuid(req.query.variantId, "variantId"),
            warehouseId: parseOptionalUuid(
                req.query.warehouseId,
                "warehouseId"
            ),
            movementType: parseMovementType(req.query.movementType),
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
            from: parseOptionalDate(req.query.from, "from"),
            to: parseOptionalDate(req.query.to, "to"),
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
        const id = getMovementId(req);
        const result = await getInventoryMovementById(id);

        sendSuccess(
            res,
            "Inventory movement retrieved successfully.",
            result
        );
    }
);
