import type { Request, RequestHandler } from "express";
import { isUuid } from "../utils/validation/uuid.js";
import {
    WarehouseServiceError,
    createWarehouse,
    listWarehouses,
    getWarehouseById,
    updateWarehouse,
    updateWarehouseStatus,
    deleteWarehouse,
    type CreateWarehouseInput,
    type UpdateWarehouseInput,
    type WarehouseListQuery,
} from "../services/warehouse.service.js";

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

type ControllerResult = {
    data: unknown;
    message: string;
    statusCode?: number;
};

type ControllerAction = (req: Request) => Promise<ControllerResult>;

function throwValidationError(
    message: string,
    code = "VALIDATION_ERROR"
): never {
    throw new WarehouseServiceError(message, code, 400);
}

function isObject(value: unknown): value is Record<string, unknown> {
    return (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
    );
}

function getRequestBody(req: Request): Record<string, unknown> {
    if (!isObject(req.body)) {
        throwValidationError("Request body must be an object.");
    }

    return req.body;
}

function validateWarehouseId(id: unknown): string {
    if (!isUuid(id)) {
        throwValidationError(
            "A valid warehouse ID is required.",
            "INVALID_WAREHOUSE_ID"
        );
    }

    return id;
}

function validateRequiredText(
    value: unknown,
    fieldName: string,
    maxLength: number
): string {
    if (
        typeof value !== "string" ||
        !value.trim() ||
        value.trim().length > maxLength
    ) {
        throwValidationError(
            `${fieldName} is required and must not exceed ${maxLength} characters.`,
            `INVALID_WAREHOUSE_${fieldName.toUpperCase()}`
        );
    }

    return value.trim();
}

function validateOptionalText(
    value: unknown,
    fieldName: string,
    maxLength: number
): void {
    if (
        value !== undefined &&
        (
            typeof value !== "string" ||
            !value.trim() ||
            value.trim().length > maxLength
        )
    ) {
        throwValidationError(
            `${fieldName} must be a non-empty string with a maximum length of ${maxLength} characters.`,
            `INVALID_WAREHOUSE_${fieldName.toUpperCase()}`
        );
    }
}

function validateOptionalBoolean(
    value: unknown,
    fieldName: string
): void {
    if (value !== undefined && typeof value !== "boolean") {
        throwValidationError(
            `${fieldName} must be a boolean.`,
            `INVALID_WAREHOUSE_${fieldName.toUpperCase()}`
        );
    }
}

function parseQueryBoolean(
    value: unknown,
    fieldName: string
): boolean | undefined {
    if (value === undefined) return undefined;
    if (value === "true") return true;
    if (value === "false") return false;

    throwValidationError(
        `${fieldName} query parameter must be true or false.`,
        `INVALID_${fieldName.toUpperCase()}`
    );
}

function parseQueryInteger(
    value: unknown,
    fieldName: string
): number | undefined {
    if (value === undefined) return undefined;

    if (
        typeof value !== "string" ||
        !/^\d+$/.test(value)
    ) {
        throwValidationError(
            `${fieldName} must be a valid positive integer.`,
            `INVALID_${fieldName.toUpperCase()}`
        );
    }

    const parsed = Number(value);

    if (!Number.isSafeInteger(parsed) || parsed < 1) {
        throwValidationError(
            `${fieldName} must be a positive integer.`,
            `INVALID_${fieldName.toUpperCase()}`
        );
    }

    return parsed;
}

function validateAllowedFields(
    body: Record<string, unknown>,
    allowedFields: string[]
): void {
    const unknownField = Object.keys(body).find(
        (key) => !allowedFields.includes(key)
    );

    if (unknownField) {
        throwValidationError(
            `Unknown warehouse field: ${unknownField}.`,
            "UNKNOWN_WAREHOUSE_FIELD"
        );
    }
}

// -----------------------------------------------------------------------------
// Controller wrapper
// -----------------------------------------------------------------------------

function createController(action: ControllerAction): RequestHandler {
    return async (req, res) => {
        try {
            const result = await action(req);

            res.status(result.statusCode ?? 200).json({
                status: "success",
                message: result.message,
                data: result.data,
            });
        } catch (error) {
            if (error instanceof WarehouseServiceError) {
                res.status(error.statusCode).json({
                    status: "error",
                    message: error.message,
                    code: error.code,
                });

                return;
            }

            console.error("Warehouse controller error:", error);

            res.status(500).json({
                status: "error",
                message: "An unexpected error occurred.",
                code: "INTERNAL_SERVER_ERROR",
            });
        }
    };
}

// -----------------------------------------------------------------------------
// Create warehouse
// -----------------------------------------------------------------------------

export const createWarehouseController = createController(
    async (req) => {
        const body = getRequestBody(req);

        validateAllowedFields(body, [
            "name",
            "code",
            "address",
            "isActive",
        ]);

        const name = validateRequiredText(body.name, "name", 150);
        const code = validateRequiredText(body.code, "code", 50);
        const address = validateRequiredText(body.address, "address", 10000);

        validateOptionalBoolean(body.isActive, "isActive");

        const input: CreateWarehouseInput = {
            name,
            code,
            address,
            isActive: body.isActive as boolean | undefined,
        };

        const warehouse = await createWarehouse(input);

        return {
            data: warehouse,
            message: "Warehouse created successfully.",
            statusCode: 201,
        };
    }
);

// -----------------------------------------------------------------------------
// List warehouses
// -----------------------------------------------------------------------------

export const listWarehousesController = createController(
    async (req) => {
        const page = parseQueryInteger(req.query.page, "page");
        const limit = parseQueryInteger(req.query.limit, "limit");
        const isActive = parseQueryBoolean(
            req.query.isActive,
            "isActive"
        );

        const search = req.query.search;

        if (search !== undefined && typeof search !== "string") {
            throwValidationError("search must be a string.");
        }

        if (typeof search === "string" && search.length > 255) {
            throwValidationError("search must not exceed 255 characters.");
        }

        const query: WarehouseListQuery = {
            page,
            limit,
            search,
            isActive,
        };

        const result = await listWarehouses(query);

        return {
            data: result,
            message: "Warehouses retrieved successfully.",
        };
    }
);

// -----------------------------------------------------------------------------
// Get warehouse by ID
// -----------------------------------------------------------------------------

export const getWarehouseByIdController = createController(
    async (req) => {
        const id = validateWarehouseId(req.params.id);
        const warehouse = await getWarehouseById(id);

        return {
            data: warehouse,
            message: "Warehouse retrieved successfully.",
        };
    }
);

// -----------------------------------------------------------------------------
// Update warehouse
// -----------------------------------------------------------------------------

export const updateWarehouseController = createController(
    async (req) => {
        const id = validateWarehouseId(req.params.id);
        const body = getRequestBody(req);

        validateAllowedFields(body, [
            "name",
            "code",
            "address",
        ]);

        if (Object.keys(body).length === 0) {
            throwValidationError(
                "At least one warehouse field must be provided.",
                "WAREHOUSE_EMPTY_UPDATE"
            );
        }

        validateOptionalText(body.name, "name", 150);
        validateOptionalText(body.code, "code", 50);
        validateOptionalText(body.address, "address", 10000);

        const input: UpdateWarehouseInput = {
            name: body.name as string | undefined,
            code: body.code as string | undefined,
            address: body.address as string | undefined,
        };

        const warehouse = await updateWarehouse(id, input);

        return {
            data: warehouse,
            message: "Warehouse updated successfully.",
        };
    }
);

// -----------------------------------------------------------------------------
// Update warehouse status
// -----------------------------------------------------------------------------

export const updateWarehouseStatusController = createController(
    async (req) => {
        const id = validateWarehouseId(req.params.id);
        const body = getRequestBody(req);

        validateAllowedFields(body, ["isActive"]);

        if (typeof body.isActive !== "boolean") {
            throwValidationError(
                "isActive is required and must be a boolean.",
                "INVALID_WAREHOUSE_STATUS"
            );
        }

        const warehouse = await updateWarehouseStatus(id, body.isActive);

        return {
            data: warehouse,
            message: "Warehouse status updated successfully.",
        };
    }
);

// -----------------------------------------------------------------------------
// Delete warehouse
// -----------------------------------------------------------------------------

export const deleteWarehouseController = createController(
    async (req) => {
        const id = validateWarehouseId(req.params.id);
        const result = await deleteWarehouse(id);

        return {
            data: result,
            message: "Warehouse deleted successfully.",
        };
    }
);
