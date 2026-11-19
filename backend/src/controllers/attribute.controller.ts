
import type { Request, RequestHandler } from "express";
import { AttributeInputType } from "../../generated/prisma/client.js";
import { isUuid } from "../utils/validation/uuid.js";

import {
    AttributeServiceError,
    createAttribute,
    listAttributes,
    getAttributeById,
    updateAttribute,
    updateAttributeStatus,
    deleteAttribute,
} from "../services/attribute.service.js";

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

type ControllerResult = {
    data: unknown;
    message: string;
    statusCode?: number;
};

type ControllerAction = (
    req: Request
) => Promise<ControllerResult>;

function throwValidationError(
    message: string,
    code = "VALIDATION_ERROR"
): never {
    throw new AttributeServiceError(message, code, 400);
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

function validateAttributeId(id: unknown): string {
    if (!isUuid(id)) {
        throwValidationError(
            "A valid attribute ID is required.",
            "INVALID_ATTRIBUTE_ID"
        );
    }

    return id;
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

function parseQueryBoolean(
    value: unknown
): boolean | undefined {
    if (value === undefined) return undefined;

    if (value === "true") return true;
    if (value === "false") return false;

    throwValidationError(
        "isActive query parameter must be true or false."
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
            `${fieldName} must be a valid positive integer.`
        );
    }

    const parsed = Number(value);

    if (
        !Number.isSafeInteger(parsed) ||
        parsed < 1
    ) {
        throwValidationError(
            `${fieldName} must be a positive integer.`
        );
    }

    return parsed;
}

function validateInputType(
    value: unknown
): value is AttributeInputType {
    return (
        typeof value === "string" &&
        Object.values(AttributeInputType).includes(
            value as AttributeInputType
        )
    );
}

function validateAttributeName(value: unknown): string {
    if (
        typeof value !== "string" ||
        !value.trim() ||
        value.length > 150
    ) {
        throwValidationError(
            "A valid attribute name is required.",
            "INVALID_ATTRIBUTE_NAME"
        );
    }

    return value.trim();
}

function validateAttributeSlug(value: unknown): string {
    if (
        typeof value !== "string" ||
        !value.trim() ||
        value.length > 180
    ) {
        throwValidationError(
            "A valid attribute slug is required.",
            "INVALID_ATTRIBUTE_SLUG"
        );
    }

    return value.trim();
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
            if (error instanceof AttributeServiceError) {
                res.status(error.statusCode).json({
                    status: "error",
                    message: error.message,
                    code: error.code,
                });

                return;
            }

            console.error(
                "Attribute controller error:",
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
// Create attribute
// -----------------------------------------------------------------------------

export const createAttributeController = createController(
    async (req) => {
        const body = getRequestBody(req);

        const {
            name,
            slug,
            inputType,
            isActive,
        } = body;

        const validatedName = validateAttributeName(name);
        const validatedSlug = validateAttributeSlug(slug);

        if (!validateInputType(inputType)) {
            throwValidationError(
                "A valid inputType is required.",
                "INVALID_ATTRIBUTE_INPUT_TYPE"
            );
        }

        validateBoolean(isActive, "isActive");

        const attribute = await createAttribute({
            name: validatedName,
            slug: validatedSlug,
            inputType,
            isActive: isActive as boolean | undefined,
        });

        return {
            data: attribute,
            message: "Attribute created successfully.",
            statusCode: 201,
        };
    }
);

// -----------------------------------------------------------------------------
// List attributes
// -----------------------------------------------------------------------------

export const listAttributesController = createController(
    async (req) => {
        const page = parseQueryInteger(
            req.query.page,
            "page"
        );

        const limit = parseQueryInteger(
            req.query.limit,
            "limit"
        );

        const isActive = parseQueryBoolean(
            req.query.isActive
        );

        const search = req.query.search;

        if (
            search !== undefined &&
            typeof search !== "string"
        ) {
            throwValidationError(
                "search must be a string."
            );
        }

        if (
            typeof search === "string" &&
            search.length > 255
        ) {
            throwValidationError(
                "search must not exceed 255 characters."
            );
        }

        const inputTypeQuery = req.query.inputType;

        let inputType: AttributeInputType | undefined;

        if (inputTypeQuery !== undefined) {
            if (!validateInputType(inputTypeQuery)) {
                throwValidationError(
                    "A valid inputType query parameter is required.",
                    "INVALID_ATTRIBUTE_INPUT_TYPE"
                );
            }

            inputType = inputTypeQuery;
        }

        const result = await listAttributes({
            page,
            limit,
            search,
            inputType,
            isActive,
        });

        return {
            data: result,
            message: "Attributes retrieved successfully.",
        };
    }
);

// -----------------------------------------------------------------------------
// Get attribute by ID
// -----------------------------------------------------------------------------

export const getAttributeByIdController = createController(
    async (req) => {
        const id = validateAttributeId(req.params.id);

        const attribute = await getAttributeById(id);

        return {
            data: attribute,
            message: "Attribute retrieved successfully.",
        };
    }
);

// -----------------------------------------------------------------------------
// Update attribute
// -----------------------------------------------------------------------------

export const updateAttributeController = createController(
    async (req) => {
        const id = validateAttributeId(req.params.id);
        const body = getRequestBody(req);

        const allowedFields = [
            "name",
            "slug",
            "inputType",
        ];

        const hasAllowedField = allowedFields.some(
            (field) => Object.hasOwn(body, field)
        );

        if (!hasAllowedField) {
            throwValidationError(
                "At least one valid attribute field must be provided."
            );
        }

        const {
            name,
            slug,
            inputType,
        } = body;

        if (name !== undefined) {
            validateAttributeName(name);
        }

        if (slug !== undefined) {
            validateAttributeSlug(slug);
        }

        if (
            inputType !== undefined &&
            !validateInputType(inputType)
        ) {
            throwValidationError(
                "A valid inputType is required.",
                "INVALID_ATTRIBUTE_INPUT_TYPE"
            );
        }

        const attribute = await updateAttribute(id, {
            name: name as string | undefined,
            slug: slug as string | undefined,
            inputType: inputType as
                | AttributeInputType
                | undefined,
        });

        return {
            data: attribute,
            message: "Attribute updated successfully.",
        };
    }
);

// -----------------------------------------------------------------------------
// Update attribute status
// -----------------------------------------------------------------------------

export const updateAttributeStatusController = createController(
    async (req) => {
        const id = validateAttributeId(req.params.id);
        const body = getRequestBody(req);

        validateBoolean(body.isActive, "isActive");

        if (typeof body.isActive !== "boolean") {
            throwValidationError(
                "isActive is required and must be a boolean."
            );
        }

        const attribute = await updateAttributeStatus(
            id,
            body.isActive
        );

        return {
            data: attribute,
            message: body.isActive
                ? "Attribute activated successfully."
                : "Attribute deactivated successfully.",
        };
    }
);

// -----------------------------------------------------------------------------
// Delete attribute
// -----------------------------------------------------------------------------

export const deleteAttributeController = createController(
    async (req) => {
        const id = validateAttributeId(req.params.id);

        const attribute = await deleteAttribute(id);

        return {
            data: attribute,
            message: "Attribute deleted successfully.",
        };
    }
);
