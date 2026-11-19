import type { Request, RequestHandler } from "express";
import { isUuid } from "../utils/validation/uuid.js";
import {
    VariantServiceError,
    createVariant,
    listVariants,
    getVariantById,
    updateVariant,
    updateVariantStatus,
    deleteVariant,
    type CreateVariantInput,
    type UpdateVariantInput,
    type VariantAttributeValueInput,
    type VariantListQuery,
} from "../services/variant.service.js";

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
    throw new VariantServiceError(message, code, 400);
}

function serializeBigInt<T>(value: T): T {
    if (value === null || value === undefined) {
        return value;
    }

    return JSON.parse(
        JSON.stringify(value, (_key, currentValue: unknown) =>
            typeof currentValue === "bigint"
                ? currentValue.toString()
                : currentValue
        )
    ) as T;
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

function validateVariantId(id: unknown): string {
    if (!isUuid(id)) {
        throwValidationError(
            "A valid variant ID is required.",
            "INVALID_VARIANT_ID"
        );
    }

    return id;
}

function validateProductId(id: unknown): string {
    if (!isUuid(id)) {
        throwValidationError(
            "A valid product ID is required.",
            "INVALID_PRODUCT_ID"
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
            `INVALID_VARIANT_${fieldName.toUpperCase()}`
        );
    }

    return value.trim();
}

function validateOptionalText(
    value: unknown,
    fieldName: string,
    maxLength: number,
    allowNull = false
): void {
    if (
        value !== undefined &&
        !(
            allowNull &&
            value === null
        ) &&
        (
            typeof value !== "string" ||
            !value.trim() ||
            value.trim().length > maxLength
        )
    ) {
        throwValidationError(
            `${fieldName} must be a string with a maximum length of ${maxLength} characters or null.`,
            `INVALID_VARIANT_${fieldName.toUpperCase()}`
        );
    }
}

function validateRialAmount(
    value: unknown,
    fieldName: string,
    required = false,
    nullable = false
): void {
    if (value === undefined) {
        if (required) {
            throwValidationError(
                `${fieldName} is required.`,
                `INVALID_VARIANT_${fieldName.toUpperCase()}`
            );
        }
        return;
    }

    if (value === null && nullable) return;

    const isValidNumber =
        typeof value === "number" &&
        Number.isSafeInteger(value) &&
        value >= 0;

    const isValidString =
        typeof value === "string" &&
        /^\d+$/.test(value.trim());

    if (!isValidNumber && !isValidString) {
        throwValidationError(
            `${fieldName} must be a non-negative integer amount in Rials.`,
            `INVALID_VARIANT_${fieldName.toUpperCase()}`
        );
    }

    if (
        required &&
        (
            (typeof value === "number" && value === 0) ||
            (typeof value === "string" && BigInt(value.trim()) === 0n)
        )
    ) {
        throwValidationError(
            `${fieldName} must be greater than zero.`,
            `INVALID_VARIANT_${fieldName.toUpperCase()}`
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
        `${fieldName} query parameter must be true or false.`
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

    if (!Number.isSafeInteger(parsed) || parsed < 1) {
        throwValidationError(
            `${fieldName} must be a positive integer.`
        );
    }

    return parsed;
}

function validateAttributeValues(
    value: unknown
): VariantAttributeValueInput[] | undefined {
    if (value === undefined) return undefined;

    if (!Array.isArray(value)) {
        throwValidationError("attributeValues must be an array.");
    }

    return value.map((item, index) => {
        if (!isObject(item)) {
            throwValidationError(
                `attributeValues[${index}] must be an object.`
            );
        }

        if (!isUuid(item.categoryAttributeId)) {
            throwValidationError(
                `attributeValues[${index}].categoryAttributeId must be a valid UUID.`,
                "INVALID_CATEGORY_ATTRIBUTE_ID"
            );
        }

        const allowedFields = [
            "categoryAttributeId",
            "textValue",
            "numberValue",
            "booleanValue",
            "dateValue",
            "optionId",
            "optionIds",
        ];

        const unknownField = Object.keys(item).find(
            (key) => !allowedFields.includes(key)
        );

        if (unknownField) {
            throwValidationError(
                `Unknown attribute value field: ${unknownField}.`
            );
        }

        if (
            item.textValue !== undefined &&
            item.textValue !== null &&
            typeof item.textValue !== "string"
        ) {
            throwValidationError(
                `attributeValues[${index}].textValue must be a string or null.`
            );
        }

        if (
            item.numberValue !== undefined &&
            item.numberValue !== null &&
            (
                (typeof item.numberValue !== "number" &&
                    typeof item.numberValue !== "string") ||
                (typeof item.numberValue === "number" &&
                    !Number.isFinite(item.numberValue)) ||
                (typeof item.numberValue === "string" &&
                    item.numberValue.trim() === "")
            )
        ) {
            throwValidationError(
                `attributeValues[${index}].numberValue must be a finite number, numeric string, or null.`
            );
        }

        if (
            item.booleanValue !== undefined &&
            item.booleanValue !== null &&
            typeof item.booleanValue !== "boolean"
        ) {
            throwValidationError(
                `attributeValues[${index}].booleanValue must be a boolean or null.`
            );
        }

        if (
            item.dateValue !== undefined &&
            item.dateValue !== null &&
            typeof item.dateValue !== "string"
        ) {
            throwValidationError(
                `attributeValues[${index}].dateValue must be an ISO date string or null.`
            );
        }

        if (
            item.optionId !== undefined &&
            item.optionId !== null &&
            !isUuid(item.optionId)
        ) {
            throwValidationError(
                `attributeValues[${index}].optionId must be a valid UUID or null.`
            );
        }

        if (item.optionIds !== undefined) {
            if (
                !Array.isArray(item.optionIds) ||
                item.optionIds.some((optionId) => !isUuid(optionId))
            ) {
                throwValidationError(
                    `attributeValues[${index}].optionIds must be an array of valid UUIDs.`
                );
            }
        }

        return item as unknown as VariantAttributeValueInput;
    });
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
                data: serializeBigInt(result.data),
            });
        } catch (error) {
            if (error instanceof VariantServiceError) {
                res.status(error.statusCode).json({
                    status: "error",
                    message: error.message,
                    code: error.code,
                });

                return;
            }

            console.error("Variant controller error:", error);

            res.status(500).json({
                status: "error",
                message: "An unexpected error occurred.",
                code: "INTERNAL_SERVER_ERROR",
            });
        }
    };
}

// -----------------------------------------------------------------------------
// Create variant
// -----------------------------------------------------------------------------

export const createVariantController = createController(
    async (req) => {
        const productId = validateProductId(req.params.productId);
        const body = getRequestBody(req);

        const sku = validateRequiredText(body.sku, "sku", 100);
        const title = validateRequiredText(body.title, "title", 150);

        validateRialAmount(body.priceRial, "priceRial", true);
        validateRialAmount(body.compareAtPriceRial, "compareAtPriceRial", false, true);
        validateRialAmount(body.costPriceRial, "costPriceRial", false, true);
        validateOptionalText(body.barcode, "barcode", 100, true);

        const allowedFields = [
            "sku",
            "title",
            "priceRial",
            "compareAtPriceRial",
            "costPriceRial",
            "barcode",
            "attributeValues",
        ];

        const unknownField = Object.keys(body).find(
            (key) => !allowedFields.includes(key)
        );

        if (unknownField) {
            throwValidationError(`Unknown variant field: ${unknownField}.`);
        }

        const attributeValues = validateAttributeValues(body.attributeValues);

        const input: CreateVariantInput = {
            productId,
            sku,
            title,
            priceRial: body.priceRial as number | string,
            compareAtPriceRial: body.compareAtPriceRial as number | string | null | undefined,
            costPriceRial: body.costPriceRial as number | string | null | undefined,
            barcode: body.barcode as string | null | undefined,
            attributeValues,
        };

        const variant = await createVariant(input);

        return {
            data: variant,
            message: "Variant created successfully.",
            statusCode: 201,
        };
    }
);

// -----------------------------------------------------------------------------
// List variants for a product
// -----------------------------------------------------------------------------

export const listVariantsController = createController(
    async (req) => {
        const productId = validateProductId(req.params.productId);

        const page = parseQueryInteger(req.query.page, "page");
        const limit = parseQueryInteger(req.query.limit, "limit");
        const includeInactive = parseQueryBoolean(
            req.query.includeInactive,
            "includeInactive"
        );
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

        const query: VariantListQuery = {
            page,
            limit,
            search,
            isActive,
            includeInactive,
        };

        const result = await listVariants(productId, query);

        return {
            data: result,
            message: "Variants retrieved successfully.",
        };
    }
);

// -----------------------------------------------------------------------------
// Get variant by ID
// -----------------------------------------------------------------------------

export const getVariantByIdController = createController(
    async (req) => {
        const id = validateVariantId(req.params.id);
        const variant = await getVariantById(id);

        return {
            data: variant,
            message: "Variant retrieved successfully.",
        };
    }
);

// -----------------------------------------------------------------------------
// Update variant
// -----------------------------------------------------------------------------

export const updateVariantController = createController(
    async (req) => {
        const id = validateVariantId(req.params.id);
        const body = getRequestBody(req);

        const allowedFields = [
            "sku",
            "title",
            "priceRial",
            "compareAtPriceRial",
            "costPriceRial",
            "barcode",
            "attributeValues",
        ];

        const hasAllowedField = allowedFields.some(
            (field) => Object.hasOwn(body, field)
        );

        if (!hasAllowedField) {
            throwValidationError(
                "At least one valid variant field must be provided."
            );
        }

        const unknownField = Object.keys(body).find(
            (key) => !allowedFields.includes(key)
        );

        if (unknownField) {
            throwValidationError(`Unknown variant field: ${unknownField}.`);
        }

        validateOptionalText(body.sku, "sku", 100);
        validateOptionalText(body.title, "title", 150);
        validateRialAmount(body.priceRial, "priceRial", false);
        validateRialAmount(body.compareAtPriceRial, "compareAtPriceRial", false, true);
        validateRialAmount(body.costPriceRial, "costPriceRial", false, true);
        validateOptionalText(body.barcode, "barcode", 100, true);

        const attributeValues = validateAttributeValues(body.attributeValues);

        const input: UpdateVariantInput = {
            sku: body.sku as string | undefined,
            title: body.title as string | undefined,
            priceRial: body.priceRial as number | string | undefined,
            compareAtPriceRial: body.compareAtPriceRial as number | string | null | undefined,
            costPriceRial: body.costPriceRial as number | string | null | undefined,
            barcode: body.barcode as string | null | undefined,
            attributeValues,
        };

        const variant = await updateVariant(id, input);

        return {
            data: variant,
            message: "Variant updated successfully.",
        };
    }
);

// -----------------------------------------------------------------------------
// Update variant active status
// -----------------------------------------------------------------------------

export const updateVariantStatusController = createController(
    async (req) => {
        const id = validateVariantId(req.params.id);
        const body = getRequestBody(req);

        if (typeof body.isActive !== "boolean") {
            throwValidationError(
                "isActive is required and must be a boolean.",
                "INVALID_VARIANT_STATUS"
            );
        }

        const variant = await updateVariantStatus(id, body.isActive);

        return {
            data: variant,
            message: "Variant status updated successfully.",
        };
    }
);

// -----------------------------------------------------------------------------
// Deactivate variant
// -----------------------------------------------------------------------------

export const deleteVariantController = createController(
    async (req) => {
        const id = validateVariantId(req.params.id);
        const result = await deleteVariant(id);

        return {
            data: result,
            message: "Variant deactivated successfully.",
        };
    }
);
