import type { Request, RequestHandler } from "express";
import {
    CategoryServiceError,
    createCategory,
    listCategories,
    getCategoryTree,
    getCategoryById,
    updateCategory,
    getCategoryStatusPreview,
    updateCategoryStatus,
    getCategoryDeletePreview,
    deleteCategory,
} from "../services/category.service.js";
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
    throw new CategoryServiceError(message, code, 400);
}

function isObject(value: unknown): value is Record<string, unknown> {
    return (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
    );
}

function isUuid(value: unknown): value is string {
    return (
        typeof value === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            value
        )
    );
}

function validateCategoryId(id: unknown): string {
    if (
        typeof id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    ) {
        throwValidationError(
            "A valid category ID is required.",
            "INVALID_CATEGORY_ID"
        );
    }

    return id;
}

function getRequestBody(req: Request): Record<string, unknown> {
    if (!isObject(req.body)) {
        throwValidationError("Request body must be an object.");
    }

    return req.body;
}

function validateOptionalText(
    value: unknown,
    fieldName: string
): void {
    if (value !== undefined && value !== null && typeof value !== "string") {
        throwValidationError(`${fieldName} must be a string or null.`);
    }
}

function validateParentId(value: unknown): void {
    if (
        value !== undefined &&
        value !== null &&
        !isUuid(value)
    ) {
        throwValidationError(
            "parentId must be a valid UUID or null.",
            "INVALID_PARENT_CATEGORY_ID"
        );
    }
}

function validateBoolean(
    value: unknown,
    fieldName: string
): void {
    if (value !== undefined && typeof value !== "boolean") {
        throwValidationError(`${fieldName} must be a boolean.`);
    }
}

function parseQueryBoolean(value: unknown): boolean | undefined {
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

    if (!Number.isSafeInteger(parsed) || parsed < 1) {
        throwValidationError(
            `${fieldName} must be a positive integer.`
        );
    }

    return parsed;
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
            if (error instanceof CategoryServiceError) {
                res.status(error.statusCode).json({
                    status: "error",
                    message: error.message,
                    code: error.code,
                });

                return;
            }

            console.error("Category controller error:", error);

            res.status(500).json({
                status: "error",
                message: "An unexpected error occurred.",
                code: "INTERNAL_SERVER_ERROR",
            });
        }
    };
}

// -----------------------------------------------------------------------------
// Create category
// -----------------------------------------------------------------------------

export const createCategoryController = createController(
    async (req) => {
        const body = getRequestBody(req);

        const {
            name,
            slug,
            description,
            imageUrl,
            parentId,
            isActive,
        } = body;

        if (
            typeof name !== "string" ||
            !name.trim() ||
            name.trim().length > 255
        ) {
            throwValidationError(
                "Category name is required and must not exceed 255 characters."
            );
        }

        if (
            typeof slug !== "string" ||
            !slug.trim() ||
            slug.trim().length > 180
        ) {
            throwValidationError(
                "Category slug is required and must not exceed 180 characters."
            );
        }

        validateOptionalText(description, "description");
        validateOptionalText(imageUrl, "imageUrl");
        validateParentId(parentId);
        validateBoolean(isActive, "isActive");

        const category = await createCategory({
            name,
            slug,
            description: description as string | null | undefined,
            imageUrl: imageUrl as string | null | undefined,
            parentId: parentId as string | null | undefined,
            isActive: isActive as boolean | undefined,
        });

        return {
            data: category,
            message: "Category created successfully.",
            statusCode: 201,
        };
    }
);

// -----------------------------------------------------------------------------
// List categories
// -----------------------------------------------------------------------------

export const listCategoriesController = createController(
    async (req) => {
        const page = parseQueryInteger(req.query.page, "page");
        const limit = parseQueryInteger(req.query.limit, "limit");
        const isActive = parseQueryBoolean(req.query.isActive);

        const search = req.query.search;

        if (
            search !== undefined &&
            typeof search !== "string"
        ) {
            throwValidationError("search must be a string.");
        }

        if (
            typeof search === "string" &&
            search.length > 255
        ) {
            throwValidationError(
                "search must not exceed 255 characters."
            );
        }

        const parentIdQuery = req.query.parentId;
        let parentId: string | null | undefined;

        if (parentIdQuery === "null") {
            parentId = null;
        } else if (parentIdQuery !== undefined) {
            if (!isUuid(parentIdQuery)) {
                throwValidationError(
                    "parentId must be a valid UUID or null."
                );
            }

            parentId = parentIdQuery;
        }

        const result = await listCategories({
            page,
            limit,
            search,
            parentId,
            isActive,
        });

        return {
            data: result,
            message: "Categories retrieved successfully.",
        };
    }
);

// -----------------------------------------------------------------------------
// Get category tree
// -----------------------------------------------------------------------------

export const getCategoryTreeController = createController(
    async () => {
        const tree = await getCategoryTree();

        return {
            data: tree,
            message: "Category tree retrieved successfully.",
        };
    }
);

// -----------------------------------------------------------------------------
// Get category by ID
// -----------------------------------------------------------------------------

export const getCategoryByIdController = createController(
    async (req) => {
        const id = validateCategoryId(req.params.id);

        const category = await getCategoryById(id);

        return {
            data: category,
            message: "Category retrieved successfully.",
        };
    }
);

// -----------------------------------------------------------------------------
// Update category
// -----------------------------------------------------------------------------

export const updateCategoryController = createController(
    async (req) => {
        const id = validateCategoryId(req.params.id);
        const body = getRequestBody(req);

        const allowedFields = [
            "name",
            "slug",
            "description",
            "imageUrl",
            "parentId",
        ];

        const hasAllowedField = allowedFields.some(
            (field) => Object.hasOwn(body, field)
        );

        if (!hasAllowedField) {
            throwValidationError(
                "At least one valid category field must be provided."
            );
        }

        const {
            name,
            slug,
            description,
            imageUrl,
            parentId,
        } = body;

        if (
            name !== undefined &&
            (
                typeof name !== "string" ||
                !name.trim() ||
                name.trim().length > 255
            )
        ) {
            throwValidationError(
                "name must be a non-empty string with a maximum length of 255 characters."
            );
        }

        if (
            slug !== undefined &&
            (
                typeof slug !== "string" ||
                !slug.trim() ||
                slug.trim().length > 180
            )
        ) {
            throwValidationError(
                "slug must be a non-empty string with a maximum length of 180 characters."
            );
        }

        validateOptionalText(description, "description");
        validateOptionalText(imageUrl, "imageUrl");
        validateParentId(parentId);

        const category = await updateCategory(id, {
            name: name as string | undefined,
            slug: slug as string | undefined,
            description: description as string | null | undefined,
            imageUrl: imageUrl as string | null | undefined,
            parentId: parentId as string | null | undefined,
        });

        return {
            data: category,
            message: "Category updated successfully.",
        };
    }
);

// -----------------------------------------------------------------------------
// Category status preview
// -----------------------------------------------------------------------------

export const getCategoryStatusPreviewController = createController(
    async (req) => {
        const id = validateCategoryId(req.params.id);

        const preview = await getCategoryStatusPreview(id);

        return {
            data: preview,
            message: "Category status preview retrieved successfully.",
        };
    }
);

// -----------------------------------------------------------------------------
// Update category status
// -----------------------------------------------------------------------------

export const updateCategoryStatusController = createController(
    async (req) => {
        const id = validateCategoryId(req.params.id);
        const body = getRequestBody(req);

        validateBoolean(body.isActive, "isActive");

        if (typeof body.isActive !== "boolean") {
            throwValidationError(
                "isActive is required and must be a boolean."
            );
        }

        const category = await updateCategoryStatus(
            id,
            body.isActive
        );

        return {
            data: category,
            message: body.isActive
                ? "Category activated successfully."
                : "Category and its descendants deactivated successfully.",
        };
    }
);

// -----------------------------------------------------------------------------
// Category deletion preview
// -----------------------------------------------------------------------------

export const getCategoryDeletePreviewController = createController(
    async (req) => {
        const id = validateCategoryId(req.params.id);

        const preview = await getCategoryDeletePreview(id);

        return {
            data: preview,
            message: "Category deletion preview retrieved successfully.",
        };
    }
);

// -----------------------------------------------------------------------------
// Delete category
// -----------------------------------------------------------------------------

export const deleteCategoryController = createController(
    async (req) => {
        const id = validateCategoryId(req.params.id);

        const result = await deleteCategory(id);

        return {
            data: result,
            message: "Category tree deleted successfully.",
        };
    }
);
