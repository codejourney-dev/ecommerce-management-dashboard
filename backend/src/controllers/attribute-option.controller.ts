
import type { Request, RequestHandler } from "express";
import { isUuid } from "../utils/validation/uuid.js";

import {
    AttributeOptionServiceError,
    createAttributeOption,
    listAttributeOptions,
    getAttributeOptionById,
    updateAttributeOption,
    updateAttributeOptionStatus,
    reorderAttributeOptions,
    deleteAttributeOption,
} from "../services/attribute-option.service.js";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type ControllerResult = {
    data: unknown;
    message: string;
    statusCode?: number;
};

type ControllerAction = (
    req: Request
) => Promise<ControllerResult>;

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function throwValidationError(
    message: string,
    code = "VALIDATION_ERROR"
): never {
    throw new AttributeOptionServiceError(message, code, 400);
}

function isObject(
    value: unknown
): value is Record<string, unknown> {
    return (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
    );
}

// function isUuid(value: unknown): value is string {
//     return (
//         typeof value === "string" &&
//         /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
//             value
//         )
//     );
// }

function validateId(
    value: unknown,
    fieldName: string
): string {
    if (!isUuid(value)) {
        throwValidationError(
            `A valid ${fieldName} is required.`,
            `INVALID_${fieldName.toUpperCase()}`
        );
    }

    return value;
}

function getRequestBody(
    req: Request
): Record<string, unknown> {
    if (!isObject(req.body)) {
        throwValidationError(
            "Request body must be an object."
        );
    }

    return req.body;
}

function validateText(
    value: unknown,
    fieldName: string
): string {
    if (
        typeof value !== "string" ||
        !value.trim() ||
        value.trim().length > 150
    ) {
        throwValidationError(
            `${fieldName} must be a non-empty string with a maximum length of 150 characters.`,
            `INVALID_OPTION_${fieldName.toUpperCase()}`
        );
    }

    return value.trim();
}

function validatePosition(value: unknown): number {
    if (
        typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value < 0
    ) {
        throwValidationError(
            "position must be a non-negative integer.",
            "INVALID_OPTION_POSITION"
        );
    }

    return value;
}

function validateBoolean(
    value: unknown,
    fieldName: string
): void {
    if (
        value !== undefined &&
        typeof value !== "boolean"
    ) {
        throwValidationError(
            `${fieldName} must be a boolean.`
        );
    }
}

function validateOptionIds(value: unknown): string[] {
    if (
        !Array.isArray(value) ||
        !value.every(isUuid)
    ) {
        throwValidationError(
            "optionIds must be an array of valid UUIDs.",
            "INVALID_OPTION_IDS"
        );
    }

    return value;
}

// -----------------------------------------------------------------------------
// Controller wrapper
// -----------------------------------------------------------------------------

function createController(
    action: ControllerAction
): RequestHandler {
    return async (req, res) => {
        try {
            const result = await action(req);

            res.status(result.statusCode ?? 200).json({
                status: "success",
                message: result.message,
                data: result.data,
            });
        } catch (error) {
            if (error instanceof AttributeOptionServiceError) {
                res.status(error.statusCode).json({
                    status: "error",
                    message: error.message,
                    code: error.code,
                });

                return;
            }

            console.error(
                "Attribute option controller error:",
                error
            );

            res.status(500).json({
                status: "error",
                message: "An unexpected error occurred.",
                code: "INTERNAL_SERVER_ERROR",
            });
        }
    };
}

// -----------------------------------------------------------------------------
// Create Option
// -----------------------------------------------------------------------------

export const createAttributeOptionController = createController(
    async (req) => {
        const attributeId = validateId(
            req.params.attributeId,
            "attributeId"
        );

        const body = getRequestBody(req);

        const label = validateText(body.label, "label");
        const value = validateText(body.value, "value");

        const position =
            body.position === undefined
                ? undefined
                : validatePosition(body.position);

        validateBoolean(body.isActive, "isActive");

        const option = await createAttributeOption(
            attributeId,
            {
                label,
                value,
                position,
                isActive: body.isActive as boolean | undefined,
            }
        );

        return {
            data: option,
            message: "Attribute option created successfully.",
            statusCode: 201,
        };
    }
);

// -----------------------------------------------------------------------------
// List Options
// -----------------------------------------------------------------------------

export const listAttributeOptionsController = createController(
    async (req) => {
        const attributeId = validateId(
            req.params.attributeId,
            "attributeId"
        );

        const options = await listAttributeOptions(attributeId);

        return {
            data: options,
            message: "Attribute options retrieved successfully.",
        };
    }
);

// -----------------------------------------------------------------------------
// Get Option by ID
// -----------------------------------------------------------------------------

export const getAttributeOptionByIdController = createController(
    async (req) => {
        const attributeId = validateId(
            req.params.attributeId,
            "attributeId"
        );

        const optionId = validateId(
            req.params.optionId,
            "optionId"
        );

        const option = await getAttributeOptionById(
            attributeId,
            optionId
        );

        return {
            data: option,
            message: "Attribute option retrieved successfully.",
        };
    }
);

// -----------------------------------------------------------------------------
// Update Option
// -----------------------------------------------------------------------------

export const updateAttributeOptionController = createController(
    async (req) => {
        const attributeId = validateId(
            req.params.attributeId,
            "attributeId"
        );

        const optionId = validateId(
            req.params.optionId,
            "optionId"
        );

        const body = getRequestBody(req);

        const allowedFields = [
            "label",
            "value",
            "position",
        ];

        const hasAllowedField = allowedFields.some(
            (field) => Object.hasOwn(body, field)
        );

        if (!hasAllowedField) {
            throwValidationError(
                "At least one valid option field must be provided."
            );
        }

        const input: {
            label?: string;
            value?: string;
            position?: number;
        } = {};

        if (body.label !== undefined) {
            input.label = validateText(body.label, "label");
        }

        if (body.value !== undefined) {
            input.value = validateText(body.value, "value");
        }

        if (body.position !== undefined) {
            input.position = validatePosition(body.position);
        }

        const option = await updateAttributeOption(
            attributeId,
            optionId,
            input
        );

        return {
            data: option,
            message: "Attribute option updated successfully.",
        };
    }
);

// -----------------------------------------------------------------------------
// Update Option Status
// -----------------------------------------------------------------------------

export const updateAttributeOptionStatusController =
    createController(async (req) => {
        const attributeId = validateId(
            req.params.attributeId,
            "attributeId"
        );

        const optionId = validateId(
            req.params.optionId,
            "optionId"
        );

        const body = getRequestBody(req);

        if (typeof body.isActive !== "boolean") {
            throwValidationError(
                "isActive is required and must be a boolean."
            );
        }

        const option = await updateAttributeOptionStatus(
            attributeId,
            optionId,
            body.isActive
        );

        return {
            data: option,
            message: body.isActive
                ? "Attribute option activated successfully."
                : "Attribute option deactivated successfully.",
        };
    });

// -----------------------------------------------------------------------------
// Reorder Options
// -----------------------------------------------------------------------------

export const reorderAttributeOptionsController = createController(
    async (req) => {
        const attributeId = validateId(
            req.params.attributeId,
            "attributeId"
        );

        const body = getRequestBody(req);
        const optionIds = validateOptionIds(body.optionIds);

        const options = await reorderAttributeOptions(
            attributeId,
            optionIds
        );

        return {
            data: options,
            message: "Attribute options reordered successfully.",
        };
    }
);

// -----------------------------------------------------------------------------
// Delete Option
// -----------------------------------------------------------------------------

export const deleteAttributeOptionController = createController(
    async (req) => {
        const attributeId = validateId(
            req.params.attributeId,
            "attributeId"
        );

        const optionId = validateId(
            req.params.optionId,
            "optionId"
        );

        const option = await deleteAttributeOption(
            attributeId,
            optionId
        );

        return {
            data: option,
            message: "Attribute option deleted successfully.",
        };
    }
);
