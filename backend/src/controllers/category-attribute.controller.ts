import type { Request, RequestHandler } from "express";
import { isUuid } from "../utils/validation/uuid.js";

import {
    CategoryAttributeServiceError,
    createCategoryAttribute,
    updateCategoryAttributeRequired,
} from "../services/category-attribute.service.js";

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

type AttributeScope = "PRODUCT" | "VARIANT";

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function throwValidationError(
    message: string,
    code = "VALIDATION_ERROR"
): never {
    throw new CategoryAttributeServiceError(
        message,
        400,
        code
    );
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

function validateScope(
    value: unknown
): value is AttributeScope {
    return (
        value === "PRODUCT" ||
        value === "VARIANT"
    );
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
            `${fieldName} must be a boolean.`,
            `INVALID_${fieldName.toUpperCase()}`
        );
    }
}

function validatePosition(value: unknown): number {
    if (
        typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value < 0
    ) {
        throwValidationError(
            "position must be a non-negative integer.",
            "INVALID_POSITION"
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
            if (
                error instanceof CategoryAttributeServiceError
            ) {
                res.status(error.statusCode).json({
                    status: "error",
                    message: error.message,
                    code: error.code,
                });

                return;
            }

            console.error(
                "Category attribute controller error:",
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
// Create Category Attribute
// -----------------------------------------------------------------------------

export const createCategoryAttributeController =
    createController(async (req) => {
        const categoryId = validateId(
            req.params.id,
            "categoryId"
        );

        const body = getRequestBody(req);

        const attributeId = validateId(
            body.attributeId,
            "attributeId"
        );

        if (!validateScope(body.scope)) {
            throwValidationError(
                "scope must be either PRODUCT or VARIANT.",
                "INVALID_ATTRIBUTE_SCOPE"
            );
        }

        validateBoolean(
            body.isRequired,
            "isRequired"
        );

        const position =
            body.position === undefined
                ? undefined
                : validatePosition(body.position);

        const result = await createCategoryAttribute(
            categoryId,
            {
                attributeId,
                scope: body.scope,
                isRequired: body.isRequired as
                    | boolean
                    | undefined,
                position,
            }
        );

        return {
            data: result,
            message: "Attribute assigned to category successfully.",
            statusCode: 201,
        };
    });

// -----------------------------------------------------------------------------
// Update Category Attribute Required Status
// -----------------------------------------------------------------------------

export const updateCategoryAttributeRequiredController =
    createController(async (req) => {
        const categoryId = validateId(
            req.params.id,
            "categoryId"
        );

        const categoryAttributeId = validateId(
            req.params.categoryAttributeId,
            "categoryAttributeId"
        );

        const body = getRequestBody(req);

        // Unlike the create endpoint, this endpoint requires an explicit
        // boolean because it changes the current required status.
        if (typeof body.isRequired !== "boolean") {
            throwValidationError(
                "isRequired must be a boolean.",
                "INVALID_REQUIRED_VALUE"
            );
        }

        const result = await updateCategoryAttributeRequired(
            categoryId,
            categoryAttributeId,
            body.isRequired
        );

        return {
            data: result,
            message: "Category attribute required status updated successfully.",
        };
    });
