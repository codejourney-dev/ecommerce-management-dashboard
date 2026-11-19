import type { Request, RequestHandler } from "express";
import { ProductStatus } from "../../generated/prisma/client.js";
import { isUuid } from "../utils/validation/uuid.js";
import {
    ProductServiceError,
    createProduct,
    listProducts,
    getProductById,
    updateProduct,
    updateProductStatus,
    deleteProduct,
    type CreateProductInput,
    type UpdateProductInput,
    type ProductAttributeValueInput,
    type ProductListQuery,
} from "../services/product.service.js";

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
    throw new ProductServiceError(message, code, 400);
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
            `INVALID_PRODUCT_${fieldName.toUpperCase()}`
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
            `${fieldName} must be a non-empty string with a maximum length of ${maxLength} characters.`
        );
    }
}

function validateUuidOrNull(
    value: unknown,
    fieldName: string
): void {
    if (
        value !== undefined &&
        value !== null &&
        !isUuid(value)
    ) {
        throwValidationError(
            `${fieldName} must be a valid UUID or null.`,
            `INVALID_${fieldName.toUpperCase()}`
        );
    }
}

function validateUuidArray(
    value: unknown,
    fieldName: string,
    required = false
): string[] | undefined {
    if (value === undefined && !required) return undefined;

    if (!Array.isArray(value)) {
        throwValidationError(`${fieldName} must be an array of UUIDs.`);
    }

    if (
        value.some((item) => !isUuid(item))
    ) {
        throwValidationError(
            `${fieldName} must contain only valid UUIDs.`,
            `INVALID_${fieldName.toUpperCase()}`
        );
    }

    return value as string[];
}

function validateProductStatus(value: unknown): value is ProductStatus {
    return (
        typeof value === "string" &&
        Object.values(ProductStatus).includes(value as ProductStatus)
    );
}

function parseQueryBoolean(
    value: unknown,
    fieldName: string
): boolean | undefined {
    if (value === undefined) return undefined;
    if (value === "true") return true;
    if (value === "false") return false;

    throwValidationError(`${fieldName} query parameter must be true or false.`);
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
        throwValidationError(`${fieldName} must be a positive integer.`);
    }

    return parsed;
}

function validateAttributeValues(
    value: unknown
): ProductAttributeValueInput[] | undefined {
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

        return item as unknown as ProductAttributeValueInput;
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
                data: result.data,
            });
        } catch (error) {
            if (error instanceof ProductServiceError) {
                res.status(error.statusCode).json({
                    status: "error",
                    message: error.message,
                    code: error.code,
                });

                return;
            }

            console.error("Product controller error:", error);

            res.status(500).json({
                status: "error",
                message: "An unexpected error occurred.",
                code: "INTERNAL_SERVER_ERROR",
            });
        }
    };
}

// -----------------------------------------------------------------------------
// Create product
// -----------------------------------------------------------------------------

export const createProductController = createController(
    async (req) => {
        const body = getRequestBody(req);

        const name = validateRequiredText(body.name, "name", 255);
        const slug = validateRequiredText(body.slug, "slug", 180);
        const description = validateRequiredText(
            body.description,
            "description",
            10000
        );

        validateUuidOrNull(body.brandId, "brandId");

        if (
            body.status !== undefined &&
            !validateProductStatus(body.status)
        ) {
            throwValidationError(
                "A valid product status is required.",
                "INVALID_PRODUCT_STATUS"
            );
        }

        const categoryIds = validateUuidArray(
            body.categoryIds,
            "categoryIds",
            true
        )!;

        const attributeValues = validateAttributeValues(body.attributeValues);

        const input: CreateProductInput = {
            name,
            slug,
            description,
            brandId: body.brandId as string | null | undefined,
            status: body.status as ProductStatus | undefined,
            categoryIds,
            attributeValues,
        };

        const product = await createProduct(input);

        return {
            data: product,
            message: "Product created successfully.",
            statusCode: 201,
        };
    }
);

// -----------------------------------------------------------------------------
// List products
// -----------------------------------------------------------------------------

export const listProductsController = createController(
    async (req) => {
        const page = parseQueryInteger(req.query.page, "page");
        const limit = parseQueryInteger(req.query.limit, "limit");
        const includeDeleted = parseQueryBoolean(
            req.query.includeDeleted,
            "includeDeleted"
        );

        const search = req.query.search;

        if (search !== undefined && typeof search !== "string") {
            throwValidationError("search must be a string.");
        }

        if (typeof search === "string" && search.length > 255) {
            throwValidationError("search must not exceed 255 characters.");
        }

        const statusQuery = req.query.status;
        let status: ProductStatus | undefined;

        if (statusQuery !== undefined) {
            if (!validateProductStatus(statusQuery)) {
                throwValidationError(
                    "A valid product status query parameter is required.",
                    "INVALID_PRODUCT_STATUS"
                );
            }

            status = statusQuery;
        }

        const categoryId = req.query.categoryId;
        if (categoryId !== undefined && !isUuid(categoryId)) {
            throwValidationError(
                "categoryId must be a valid UUID.",
                "INVALID_CATEGORY_ID"
            );
        }

        const brandId = req.query.brandId;
        if (brandId !== undefined && !isUuid(brandId)) {
            throwValidationError(
                "brandId must be a valid UUID.",
                "INVALID_BRAND_ID"
            );
        }

        const query: ProductListQuery = {
            page,
            limit,
            search,
            status,
            categoryId,
            brandId,
            includeDeleted,
        };

        const result = await listProducts(query);

        return {
            data: result,
            message: "Products retrieved successfully.",
        };
    }
);

// -----------------------------------------------------------------------------
// Get product by ID
// -----------------------------------------------------------------------------

export const getProductByIdController = createController(
    async (req) => {
        const id = validateProductId(req.params.id);
        const product = await getProductById(id);

        return {
            data: product,
            message: "Product retrieved successfully.",
        };
    }
);

// -----------------------------------------------------------------------------
// Update product
// -----------------------------------------------------------------------------

export const updateProductController = createController(
    async (req) => {
        const id = validateProductId(req.params.id);
        const body = getRequestBody(req);

        const allowedFields = [
            "name",
            "slug",
            "description",
            "brandId",
            "categoryIds",
            "attributeValues",
        ];

        const hasAllowedField = allowedFields.some(
            (field) => Object.hasOwn(body, field)
        );

        if (!hasAllowedField) {
            throwValidationError(
                "At least one valid product field must be provided."
            );
        }

        validateOptionalText(body.name, "name", 255);
        validateOptionalText(body.slug, "slug", 180);
        validateOptionalText(body.description, "description", 10000);
        validateUuidOrNull(body.brandId, "brandId");

        const categoryIds = validateUuidArray(
            body.categoryIds,
            "categoryIds"
        );
        const attributeValues = validateAttributeValues(body.attributeValues);

        const input: UpdateProductInput = {
            name: body.name as string | undefined,
            slug: body.slug as string | undefined,
            description: body.description as string | undefined,
            brandId: body.brandId as string | null | undefined,
            categoryIds,
            attributeValues,
        };

        const product = await updateProduct(id, input);

        return {
            data: product,
            message: "Product updated successfully.",
        };
    }
);

// -----------------------------------------------------------------------------
// Update product status
// -----------------------------------------------------------------------------

export const updateProductStatusController = createController(
    async (req) => {
        const id = validateProductId(req.params.id);
        const body = getRequestBody(req);

        if (!validateProductStatus(body.status)) {
            throwValidationError(
                "status is required and must be a valid product status.",
                "INVALID_PRODUCT_STATUS"
            );
        }

        const product = await updateProductStatus(id, body.status);

        return {
            data: product,
            message: "Product status updated successfully.",
        };
    }
);

// -----------------------------------------------------------------------------
// Soft delete product
// -----------------------------------------------------------------------------

export const deleteProductController = createController(
    async (req) => {
        const id = validateProductId(req.params.id);
        const result = await deleteProduct(id);

        return {
            data: result,
            message: "Product deleted successfully.",
        };
    }
);
