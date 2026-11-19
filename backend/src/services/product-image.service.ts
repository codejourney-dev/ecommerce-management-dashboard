import {
    Prisma,
} from "../../generated/prisma/client.js";
import { prisma } from "../config/prisma.js";
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import {
    createProductImageLocation,
    moveProductImageFile,
    removeStoredFileIfExists,
    removeTemporaryProductImage,
    resolveProductImagePath,
} from "../utils/storage/image-storage.js";

export class ProductImageServiceError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly statusCode: number = 400,
    ) {
        super(message);
        this.name = "ProductImageServiceError";
    }
}

type DbClient = typeof prisma | Prisma.TransactionClient;

const MIME_EXTENSIONS: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
};

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

export interface ProductImageUploadInput {
    productId: string;
    variantId?: string | null;
    tempFilePath: string;
    mimeType: string;
    fileSize: number;
    altText: string;
    position?: number;
    isPrimary?: boolean;
}

export interface ProductImageListQuery {
    variantId?: string | null;
    includeProductImages?: boolean;
}

export interface UpdateProductImageInput {
    altText?: string;
    position?: number;
}

export interface ReorderProductImagesInput {
    imageIds: string[];
}

function isKnownRequestError(
    error: unknown,
    code: string,
): error is Prisma.PrismaClientKnownRequestError {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

function normalizeAltText(value: string): string {
    const normalized = value.trim();

    if (!normalized) {
        throw new ProductImageServiceError(
            "Image alt text cannot be empty.",
            "PRODUCT_IMAGE_INVALID_ALT_TEXT",
            400,
        );
    }

    if (normalized.length > 255) {
        throw new ProductImageServiceError(
            "Image alt text cannot exceed 255 characters.",
            "PRODUCT_IMAGE_ALT_TEXT_TOO_LONG",
            400,
        );
    }

    return normalized;
}

function normalizePosition(value: number): number {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new ProductImageServiceError(
            "Image position must be a non-negative integer.",
            "PRODUCT_IMAGE_INVALID_POSITION",
            400,
        );
    }

    return value;
}

function getImageExtension(mimeType: string): string {
    const extension = MIME_EXTENSIONS[mimeType];

    if (!extension) {
        throw new ProductImageServiceError(
            "Only JPEG, PNG, and WebP images are supported.",
            "PRODUCT_IMAGE_INVALID_MIME_TYPE",
            415,
        );
    }

    return extension;
}

async function assertProductExists(
    client: DbClient,
    productId: string,
): Promise<void> {
    const product = await client.product.findFirst({
        where: {
            id: productId,
            deletedAt: null,
        },
        select: { id: true },
    });

    if (!product) {
        throw new ProductImageServiceError(
            "Product not found.",
            "PRODUCT_IMAGE_PRODUCT_NOT_FOUND",
            404,
        );
    }
}

async function assertVariantBelongsToProduct(
    client: DbClient,
    productId: string,
    variantId: string | null | undefined,
): Promise<void> {
    if (variantId === undefined || variantId === null) return;

    const variant = await client.productVariant.findFirst({
        where: {
            id: variantId,
            productId,
        },
        select: { id: true },
    });

    if (!variant) {
        throw new ProductImageServiceError(
            "The specified variant does not belong to this product.",
            "PRODUCT_IMAGE_VARIANT_NOT_FOUND",
            404,
        );
    }
}

async function getNextPosition(
    client: DbClient,
    productId: string,
    variantId: string | null,
): Promise<number> {
    const lastImage = await client.productImage.findFirst({
        where: {
            productId,
            variantId,
        },
        orderBy: [{ position: "desc" }, { createdAt: "desc" }],
        select: { position: true },
    });

    return lastImage ? lastImage.position + 1 : 0;
}

async function clearPrimaryImage(
    client: DbClient,
    productId: string,
    variantId: string | null,
): Promise<void> {
    await client.productImage.updateMany({
        where: {
            productId,
            variantId,
            isPrimary: true,
        },
        data: { isPrimary: false },
    });
}

/**
 * Saves a previously uploaded temporary file and creates its ProductImage row.
 *
 * The upload middleware is expected to place the file in a temporary directory
 * and pass its path, MIME type, and size to this service.
 */
export async function uploadProductImage(input: ProductImageUploadInput) {
    let altText: string;
    let extension: string;

    try {
        altText = normalizeAltText(input.altText);
        extension = getImageExtension(input.mimeType);

        if (!Number.isSafeInteger(input.fileSize) || input.fileSize <= 0 || input.fileSize > MAX_IMAGE_SIZE) {
            throw new ProductImageServiceError(
                "Image size must be greater than zero and no larger than 5 MB.",
                "PRODUCT_IMAGE_INVALID_SIZE",
                413,
            );
        }

        if (!input.tempFilePath?.trim()) {
            throw new ProductImageServiceError(
                "A temporary uploaded file is required.",
                "PRODUCT_IMAGE_TEMP_FILE_REQUIRED",
                400,
            );
        }
    } catch (error) {
        if (input.tempFilePath?.trim()) {
            await removeStoredFileIfExists(input.tempFilePath);
        }
        throw error;
    }

    let temporaryFileExists = false;

    try {
        const fileInfo = await stat(input.tempFilePath);
        temporaryFileExists = fileInfo.isFile();

        if (!temporaryFileExists) {
            throw new ProductImageServiceError(
                "The uploaded temporary path is not a file.",
                "PRODUCT_IMAGE_TEMP_FILE_INVALID",
                400,
            );
        }

        if (fileInfo.size !== input.fileSize) {
            throw new ProductImageServiceError(
                "The uploaded file size does not match the supplied metadata.",
                "PRODUCT_IMAGE_FILE_SIZE_MISMATCH",
                400,
            );
        }
    } catch (error) {
        if (error instanceof ProductImageServiceError) throw error;

        throw new ProductImageServiceError(
            "The uploaded temporary file could not be accessed.",
            "PRODUCT_IMAGE_TEMP_FILE_NOT_FOUND",
            400,
        );
    }

    const filename = `${randomUUID()}${extension}`;
    const { absolutePath: destinationPath, publicUrl: imageUrl } =
        createProductImageLocation(input.productId, filename);

    try {
        await prisma.$transaction(
            async (tx) => {
                await assertProductExists(tx, input.productId);
                await assertVariantBelongsToProduct(tx, input.productId, input.variantId);

                const position = input.position === undefined
                    ? await getNextPosition(tx, input.productId, input.variantId ?? null)
                    : normalizePosition(input.position);

                await moveProductImageFile(input.tempFilePath, destinationPath);
                temporaryFileExists = false;

                if (input.isPrimary) {
                    await clearPrimaryImage(tx, input.productId, input.variantId ?? null);
                }

                await tx.productImage.create({
                    data: {
                        productId: input.productId,
                        variantId: input.variantId ?? null,
                        imageUrl,
                        altText,
                        position,
                        isPrimary: input.isPrimary ?? false,
                    },
                });
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );

        return prisma.productImage.findFirstOrThrow({
            where: { imageUrl },
        });
    } catch (error) {
        await removeStoredFileIfExists(destinationPath);

        if (temporaryFileExists) {
            await removeStoredFileIfExists(input.tempFilePath);
        }

        if (error instanceof ProductImageServiceError) throw error;

        if (isKnownRequestError(error, "P2003")) {
            throw new ProductImageServiceError(
                "The specified product or variant was not found.",
                "PRODUCT_IMAGE_RELATION_NOT_FOUND",
                404,
            );
        }

        if (isKnownRequestError(error, "P2034")) {
            throw new ProductImageServiceError(
                "The image could not be uploaded because of concurrent changes. Please try again.",
                "PRODUCT_IMAGE_UPLOAD_CONFLICT",
                409,
            );
        }

        throw error;
    }
}

/**
 * Lists images belonging to a product.
 * By default, returns both product-wide and variant-specific images.
 */
export async function listProductImages(
    productId: string,
    query: ProductImageListQuery = {},
) {
    await assertProductExists(prisma, productId);

    const where: Prisma.ProductImageWhereInput = {
        productId,
        ...(query.variantId !== undefined
            ? { variantId: query.variantId }
            : {}),
    };

    const images = await prisma.productImage.findMany({
        where,
        orderBy: [
            { variantId: "asc" },
            { position: "asc" },
            { createdAt: "asc" },
            { id: "asc" },
        ],
    });

    if (query.includeProductImages && query.variantId) {
        const productImages = await prisma.productImage.findMany({
            where: {
                productId,
                variantId: null,
            },
            orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        });

        return [...productImages, ...images];
    }

    return images;
}

/**
 * Gets one image while enforcing its parent product scope.
 */
export async function getProductImageById(productId: string, id: string) {
    const image = await prisma.productImage.findFirst({
        where: {
            id,
            productId,
            product: { deletedAt: null },
        },
    });

    if (!image) {
        throw new ProductImageServiceError(
            "Product image not found.",
            "PRODUCT_IMAGE_NOT_FOUND",
            404,
        );
    }

    return image;
}

/**
 * Updates supported image metadata. File replacement is intentionally handled
 * by the upload flow, not by this metadata endpoint.
 */
export async function updateProductImage(
    productId: string,
    id: string,
    input: UpdateProductImageInput,
) {
    const data: Prisma.ProductImageUpdateManyMutationInput = {};

    if (input.altText !== undefined) {
        data.altText = normalizeAltText(input.altText);
    }

    if (input.position !== undefined) {
        data.position = normalizePosition(input.position);
    }

    if (Object.keys(data).length === 0) {
        throw new ProductImageServiceError(
            "At least one supported field must be provided.",
            "PRODUCT_IMAGE_EMPTY_UPDATE",
            400,
        );
    }

    const existing = await getProductImageById(productId, id);

    await prisma.productImage.updateMany({
        where: { id, productId },
        data,
    });

    return prisma.productImage.findUniqueOrThrow({
        where: { id: existing.id },
    });
}

/**
 * Reorders all images in a product. The payload must contain every image ID
 * exactly once; images are not moved between product/variant scopes.
 */
export async function reorderProductImages(
    productId: string,
    input: ReorderProductImagesInput,
) {
    if (!Array.isArray(input.imageIds) || input.imageIds.length === 0) {
        throw new ProductImageServiceError(
            "A non-empty imageIds array is required.",
            "PRODUCT_IMAGE_INVALID_REORDER",
            400,
        );
    }

    if (input.imageIds.some((id) => typeof id !== "string" || !id.trim())) {
        throw new ProductImageServiceError(
            "Every image ID must be a non-empty string.",
            "PRODUCT_IMAGE_INVALID_REORDER",
            400,
        );
    }

    if (new Set(input.imageIds).size !== input.imageIds.length) {
        throw new ProductImageServiceError(
            "Duplicate image IDs are not allowed.",
            "PRODUCT_IMAGE_DUPLICATE_REORDER_ID",
            400,
        );
    }

    try {
        return await prisma.$transaction(
            async (tx) => {
                await assertProductExists(tx, productId);

                const existingImages = await tx.productImage.findMany({
                    where: { productId },
                    select: { id: true },
                });

                const existingIds = new Set(existingImages.map((image) => image.id));

                if (
                    existingIds.size !== input.imageIds.length ||
                    input.imageIds.some((id) => !existingIds.has(id))
                ) {
                    throw new ProductImageServiceError(
                        "The reorder list must contain every image belonging to this product exactly once.",
                        "PRODUCT_IMAGE_REORDER_SCOPE_MISMATCH",
                        400,
                    );
                }

                for (const [position, id] of input.imageIds.entries()) {
                    await tx.productImage.update({
                        where: { id },
                        data: { position },
                    });
                }

                return tx.productImage.findMany({
                    where: { productId },
                    orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
                });
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
    } catch (error) {
        if (error instanceof ProductImageServiceError) throw error;

        if (isKnownRequestError(error, "P2034")) {
            throw new ProductImageServiceError(
                "The images could not be reordered because of concurrent changes. Please try again.",
                "PRODUCT_IMAGE_REORDER_CONFLICT",
                409,
            );
        }

        throw error;
    }
}

/**
 * Makes an image primary within its own scope:
 * product-wide images (variantId = null) or one specific variant.
 */
export async function setPrimaryProductImage(productId: string, id: string) {
    try {
        return await prisma.$transaction(
            async (tx) => {
                await assertProductExists(tx, productId);

                const image = await tx.productImage.findFirst({
                    where: { id, productId },
                    select: { id: true, variantId: true },
                });

                if (!image) {
                    throw new ProductImageServiceError(
                        "Product image not found.",
                        "PRODUCT_IMAGE_NOT_FOUND",
                        404,
                    );
                }

                await clearPrimaryImage(tx, productId, image.variantId);

                return tx.productImage.update({
                    where: { id },
                    data: { isPrimary: true },
                });
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
    } catch (error) {
        if (error instanceof ProductImageServiceError) throw error;

        if (isKnownRequestError(error, "P2034")) {
            throw new ProductImageServiceError(
                "The primary image could not be changed because of concurrent changes. Please try again.",
                "PRODUCT_IMAGE_PRIMARY_CONFLICT",
                409,
            );
        }

        throw error;
    }
}

/**
 * Deletes the database row first, then removes its physical file.
 * If file cleanup fails, the database row remains deleted and the error is
 * surfaced so the orphaned file can be investigated or cleaned up.
 */
export async function deleteProductImage(productId: string, id: string) {
    const image = await getProductImageById(productId, id);
    let physicalPath: string;

    try {
        physicalPath = resolveProductImagePath(image.imageUrl);
    } catch {
        throw new ProductImageServiceError(
            "The stored image path is invalid.",
            "PRODUCT_IMAGE_INVALID_STORAGE_PATH",
            500,
        );
    }

    await prisma.productImage.delete({
        where: { id: image.id },
    });

    try {
        await removeTemporaryProductImage(physicalPath);
    } catch {
        throw new ProductImageServiceError(
            "The image record was deleted, but its physical file could not be removed.",
            "PRODUCT_IMAGE_FILE_CLEANUP_FAILED",
            500,
        );
    }

    return {
        id: image.id,
        deleted: true,
    };
}
