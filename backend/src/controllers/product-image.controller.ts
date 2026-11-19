import type { RequestHandler, Response } from "express";
import { unlink } from "node:fs/promises";
import { isUuid } from "../utils/validation/uuid.js";
import {
    ProductImageServiceError,
    uploadProductImage,
    listProductImages,
    getProductImageById,
    updateProductImage,
    reorderProductImages,
    setPrimaryProductImage,
    deleteProductImage,
} from "../services/product-image.service.js";

type ControllerResult = {
    statusCode?: number;
    message: string;
    data?: unknown;
};

function sendSuccess(
    res: Response,
    result: ControllerResult,
): void {
    res.status(result.statusCode ?? 200).json({
        status: "success",
        message: result.message,
        data: result.data,
    });
}

function sendServiceError(
    res: Response,
    error: ProductImageServiceError,
): void {
    res.status(error.statusCode).json({
        status: "error",
        message: error.message,
        code: error.code,
    });
}

function sendUnexpectedError(
    res: Response,
    error: unknown,
): void {
    console.error("Product image controller error:", error);

    res.status(500).json({
        status: "error",
        message: "An unexpected error occurred.",
        code: "INTERNAL_SERVER_ERROR",
    });
}

function handleError(
    res: Response,
    error: unknown,
): void {
    if (error instanceof ProductImageServiceError) {
        sendServiceError(res, error);
        return;
    }

    sendUnexpectedError(res, error);
}

async function removeTemporaryUpload(
    req: Parameters<RequestHandler>[0],
): Promise<void> {
    const filePath = req.file?.path;

    if (!filePath) return;

    try {
        await unlink(filePath);
    } catch (error) {
        if (
            !error ||
            typeof error !== "object" ||
            !("code" in error) ||
            error.code !== "ENOENT"
        ) {
            console.error("Failed to remove temporary product image:", error);
        }
    }
}

function getProductId(req: Parameters<RequestHandler>[0]): string | null {
    const productId = req.params.productId;
    return isUuid(productId) ? productId : null;
}

function getImageId(req: Parameters<RequestHandler>[0]): string | null {
    const id = req.params.id;
    return isUuid(id) ? id : null;
}

function parseOptionalBoolean(
    value: unknown,
): boolean | undefined | null {
    if (value === undefined) return undefined;
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    return null;
}

function parseOptionalPosition(
    value: unknown,
): number | undefined | null {
    if (value === undefined) return undefined;

    if (
        typeof value !== "number" &&
        typeof value !== "string"
    ) {
        return null;
    }

    if (typeof value === "string" && value.trim() === "") {
        return null;
    }

    const parsed = Number(value);

    if (!Number.isSafeInteger(parsed) || parsed < 0) {
        return null;
    }

    return parsed;
}

function sendInvalidRequest(
    res: Response,
    message: string,
    code: string,
): void {
    res.status(400).json({
        status: "error",
        message,
        code,
    });
}

/**
 * POST /api/products/:productId/images
 *
 * Expects:
 * - multipart/form-data field "image"
 * - altText (required)
 * - variantId (optional UUID)
 * - position (optional non-negative integer)
 * - isPrimary (optional boolean)
 */
export const uploadProductImageController: RequestHandler = async (
    req,
    res,
) => {
    const productId = getProductId(req);

    if (!productId) {
        await removeTemporaryUpload(req);

        sendInvalidRequest(
            res,
            "A valid product ID is required.",
            "INVALID_PRODUCT_ID",
        );
        return;
    }

    if (!req.file) {
        sendInvalidRequest(
            res,
            "An image file is required.",
            "PRODUCT_IMAGE_FILE_REQUIRED",
        );
        return;
    }

    const { altText, variantId, position, isPrimary } = req.body ?? {};

    if (typeof altText !== "string" || !altText.trim()) {
        await removeTemporaryUpload(req);

        sendInvalidRequest(
            res,
            "Image alt text is required.",
            "PRODUCT_IMAGE_INVALID_ALT_TEXT",
        );
        return;
    }

    if (altText.trim().length > 255) {
        await removeTemporaryUpload(req);

        sendInvalidRequest(
            res,
            "Image alt text cannot exceed 255 characters.",
            "PRODUCT_IMAGE_ALT_TEXT_TOO_LONG",
        );
        return;
    }

    let normalizedVariantId: string | null | undefined;

    if (variantId === undefined || variantId === "") {
        normalizedVariantId = undefined;
    } else if (variantId === "null") {
        normalizedVariantId = null;
    } else if (typeof variantId === "string" && isUuid(variantId)) {
        normalizedVariantId = variantId;
    } else {
        await removeTemporaryUpload(req);

        sendInvalidRequest(
            res,
            "A valid variant ID is required.",
            "INVALID_VARIANT_ID",
        );
        return;
    }

    const normalizedPosition = parseOptionalPosition(position);

    if (normalizedPosition === null) {
        await removeTemporaryUpload(req);

        sendInvalidRequest(
            res,
            "Image position must be a non-negative integer.",
            "PRODUCT_IMAGE_INVALID_POSITION",
        );
        return;
    }

    const normalizedIsPrimary = parseOptionalBoolean(isPrimary);

    if (normalizedIsPrimary === null) {
        await removeTemporaryUpload(req);

        sendInvalidRequest(
            res,
            "isPrimary must be a boolean value.",
            "PRODUCT_IMAGE_INVALID_PRIMARY_VALUE",
        );
        return;
    }

    try {
        const image = await uploadProductImage({
            productId,
            variantId: normalizedVariantId,
            tempFilePath: req.file.path,
            mimeType: req.file.mimetype,
            fileSize: req.file.size,
            altText: altText.trim(),
            ...(normalizedPosition !== undefined
                ? { position: normalizedPosition }
                : {}),
            ...(normalizedIsPrimary !== undefined
                ? { isPrimary: normalizedIsPrimary }
                : {}),
        });

        sendSuccess(res, {
            statusCode: 201,
            message: "Product image uploaded successfully.",
            data: image,
        });
    } catch (error) {
        // The service normally consumes or removes the temporary file.
        // This also covers failures that occur before the service can clean it.
        await removeTemporaryUpload(req);
        handleError(res, error);
    }
};

/**
 * GET /api/products/:productId/images
 *
 * Query:
 * - variantId: UUID or "null"
 * - includeProductImages: true | false
 */
export const listProductImagesController: RequestHandler = async (
    req,
    res,
) => {
    const productId = getProductId(req);

    if (!productId) {
        sendInvalidRequest(
            res,
            "A valid product ID is required.",
            "INVALID_PRODUCT_ID",
        );
        return;
    }

    const rawVariantId = req.query.variantId;
    let variantId: string | null | undefined;

    if (rawVariantId === undefined) {
        variantId = undefined;
    } else if (rawVariantId === "null") {
        variantId = null;
    } else if (typeof rawVariantId === "string" && isUuid(rawVariantId)) {
        variantId = rawVariantId;
    } else {
        sendInvalidRequest(
            res,
            "variantId must be a valid UUID or 'null'.",
            "INVALID_VARIANT_ID",
        );
        return;
    }

    const includeProductImages = parseOptionalBoolean(
        req.query.includeProductImages,
    );

    if (includeProductImages === null) {
        sendInvalidRequest(
            res,
            "includeProductImages must be true or false.",
            "INVALID_INCLUDE_PRODUCT_IMAGES",
        );
        return;
    }

    try {
        const images = await listProductImages(productId, {
            ...(variantId !== undefined ? { variantId } : {}),
            ...(includeProductImages !== undefined
                ? { includeProductImages }
                : {}),
        });

        sendSuccess(res, {
            message: "Product images retrieved successfully.",
            data: images,
        });
    } catch (error) {
        handleError(res, error);
    }
};

/**
 * GET /api/products/:productId/images/:id
 */
export const getProductImageController: RequestHandler = async (
    req,
    res,
) => {
    const productId = getProductId(req);
    const id = getImageId(req);

    if (!productId || !id) {
        sendInvalidRequest(
            res,
            "Valid product and image IDs are required.",
            "INVALID_PRODUCT_IMAGE_ID",
        );
        return;
    }

    try {
        const image = await getProductImageById(productId, id);

        sendSuccess(res, {
            message: "Product image retrieved successfully.",
            data: image,
        });
    } catch (error) {
        handleError(res, error);
    }
};

/**
 * PATCH /api/products/:productId/images/:id
 *
 * Supports metadata only: altText and position.
 */
export const updateProductImageController: RequestHandler = async (
    req,
    res,
) => {
    const productId = getProductId(req);
    const id = getImageId(req);

    if (!productId || !id) {
        sendInvalidRequest(
            res,
            "Valid product and image IDs are required.",
            "INVALID_PRODUCT_IMAGE_ID",
        );
        return;
    }

    const { altText, position } = req.body ?? {};
    const input: { altText?: string; position?: number } = {};

    if (altText !== undefined) {
        if (typeof altText !== "string" || !altText.trim()) {
            sendInvalidRequest(
                res,
                "Image alt text must be a non-empty string.",
                "PRODUCT_IMAGE_INVALID_ALT_TEXT",
            );
            return;
        }

        if (altText.trim().length > 255) {
            sendInvalidRequest(
                res,
                "Image alt text cannot exceed 255 characters.",
                "PRODUCT_IMAGE_ALT_TEXT_TOO_LONG",
            );
            return;
        }

        input.altText = altText.trim();
    }

    if (position !== undefined) {
        const normalizedPosition = parseOptionalPosition(position);

        if (normalizedPosition === null || normalizedPosition === undefined) {
            sendInvalidRequest(
                res,
                "Image position must be a non-negative integer.",
                "PRODUCT_IMAGE_INVALID_POSITION",
            );
            return;
        }

        input.position = normalizedPosition;
    }

    try {
        const image = await updateProductImage(productId, id, input);

        sendSuccess(res, {
            message: "Product image updated successfully.",
            data: image,
        });
    } catch (error) {
        handleError(res, error);
    }
};

/**
 * PATCH /api/products/:productId/images/reorder
 *
 * Body: { imageIds: string[] }
 */
export const reorderProductImagesController: RequestHandler = async (
    req,
    res,
) => {
    const productId = getProductId(req);

    if (!productId) {
        sendInvalidRequest(
            res,
            "A valid product ID is required.",
            "INVALID_PRODUCT_ID",
        );
        return;
    }

    const { imageIds } = req.body ?? {};

    if (
        !Array.isArray(imageIds) ||
        imageIds.length === 0 ||
        imageIds.some((id: unknown) => typeof id !== "string" || !isUuid(id))
    ) {
        sendInvalidRequest(
            res,
            "imageIds must be a non-empty array of valid UUIDs.",
            "PRODUCT_IMAGE_INVALID_REORDER",
        );
        return;
    }

    try {
        const images = await reorderProductImages(productId, { imageIds });

        sendSuccess(res, {
            message: "Product images reordered successfully.",
            data: images,
        });
    } catch (error) {
        handleError(res, error);
    }
};

/**
 * PATCH /api/products/:productId/images/:id/primary
 */
export const setPrimaryProductImageController: RequestHandler = async (
    req,
    res,
) => {
    const productId = getProductId(req);
    const id = getImageId(req);

    if (!productId || !id) {
        sendInvalidRequest(
            res,
            "Valid product and image IDs are required.",
            "INVALID_PRODUCT_IMAGE_ID",
        );
        return;
    }

    try {
        const image = await setPrimaryProductImage(productId, id);

        sendSuccess(res, {
            message: "Primary product image updated successfully.",
            data: image,
        });
    } catch (error) {
        handleError(res, error);
    }
};

/**
 * DELETE /api/products/:productId/images/:id
 */
export const deleteProductImageController: RequestHandler = async (
    req,
    res,
) => {
    const productId = getProductId(req);
    const id = getImageId(req);

    if (!productId || !id) {
        sendInvalidRequest(
            res,
            "Valid product and image IDs are required.",
            "INVALID_PRODUCT_IMAGE_ID",
        );
        return;
    }

    try {
        const result = await deleteProductImage(productId, id);

        sendSuccess(res, {
            message: "Product image deleted successfully.",
            data: result,
        });
    } catch (error) {
        handleError(res, error);
    }
};
