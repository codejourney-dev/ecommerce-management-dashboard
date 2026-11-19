import { copyFile, mkdir, rename, rm, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Permanent image storage:
 *   <project-root>/uploads/products/<productId>/<filename>
 *
 * Public URL:
 *   /uploads/products/<productId>/<filename>
 *
 * Temporary uploads are stored outside the project directory and moved into
 * permanent storage only after file validation and product checks succeed.
 */
export const PRODUCT_IMAGE_STORAGE_ROOT = path.resolve(
    process.cwd(),
    "uploads",
    "products",
);

export const PRODUCT_IMAGE_PUBLIC_PREFIX = "/uploads/products";

export const PRODUCT_IMAGE_TEMP_DIRECTORY = path.join(
    os.tmpdir(),
    "ecommerce-dashboard",
    "product-images",
);

/**
 * Ensures that the permanent storage directory exists.
 */
export async function ensureProductImageStorageDirectory(): Promise<void> {
    await mkdir(PRODUCT_IMAGE_STORAGE_ROOT, { recursive: true });
}

/**
 * Ensures that the temporary upload directory exists.
 */
export async function ensureProductImageTempDirectory(): Promise<void> {
    await mkdir(PRODUCT_IMAGE_TEMP_DIRECTORY, { recursive: true });
}

/**
 * Builds the final disk path and public URL for an uploaded image.
 *
 * `productId` and `filename` are expected to be server-generated/validated
 * values. The containment check is retained as defense in depth.
 */
export function createProductImageLocation(
    productId: string,
    filename: string,
): { absolutePath: string; publicUrl: string } {
    if (
        !productId ||
        productId.includes("/") ||
        productId.includes("\\") ||
        productId === "." ||
        productId === ".."
    ) {
        throw new Error("Invalid product image directory.");
    }

    if (
        !filename ||
        filename.includes("/") ||
        filename.includes("\\") ||
        filename === "." ||
        filename === ".."
    ) {
        throw new Error("Invalid product image filename.");
    }

    const relativePath = path.join(productId, filename);
    const absolutePath = path.resolve(PRODUCT_IMAGE_STORAGE_ROOT, relativePath);

    if (!absolutePath.startsWith(`${PRODUCT_IMAGE_STORAGE_ROOT}${path.sep}`)) {
        throw new Error("Product image path is outside the storage directory.");
    }

    return {
        absolutePath,
        publicUrl: `${PRODUCT_IMAGE_PUBLIC_PREFIX}/${productId}/${filename}`,
    };
}

/**
 * Resolves a database-stored public image URL to its physical disk path.
 * Rejects paths outside the configured image storage directory.
 */
export function resolveProductImagePath(publicUrl: string): string {
    const expectedPrefix = `${PRODUCT_IMAGE_PUBLIC_PREFIX}/`;

    if (
        typeof publicUrl !== "string" ||
        !publicUrl.startsWith(expectedPrefix) ||
        publicUrl.includes("\\") ||
        publicUrl.includes("\0") ||
        publicUrl.includes("?") ||
        publicUrl.includes("#")
    ) {
        throw new Error("Invalid product image storage URL.");
    }

    const relativePath = publicUrl.slice(expectedPrefix.length);

    if (
        !relativePath ||
        relativePath.split("/").some(
            (segment) => !segment || segment === "." || segment === "..",
        )
    ) {
        throw new Error("Invalid product image storage URL.");
    }

    const absolutePath = path.resolve(
        PRODUCT_IMAGE_STORAGE_ROOT,
        ...relativePath.split("/"),
    );

    if (!absolutePath.startsWith(`${PRODUCT_IMAGE_STORAGE_ROOT}${path.sep}`)) {
        throw new Error("Product image path is outside the storage directory.");
    }

    return absolutePath;
}

/**
 * Moves a validated temporary file into permanent storage.
 * Handles EXDEV when source and destination are on different devices.
 */
export async function moveProductImageFile(
    sourcePath: string,
    destinationPath: string,
): Promise<void> {
    await mkdir(path.dirname(destinationPath), { recursive: true });

    try {
        await rename(sourcePath, destinationPath);
    } catch (error) {
        if (
            error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "EXDEV"
        ) {
            await copyFile(sourcePath, destinationPath);
            await unlink(sourcePath);
            return;
        }

        throw error;
    }
}

/**
 * Best-effort cleanup helper. It never hides the original operation error.
 */
export async function removeStoredFileIfExists(filePath: string): Promise<void> {
    try {
        await rm(filePath, { force: true });
    } catch {
        // Cleanup is best-effort; callers should preserve the original error.
    }
}

/**
 * Removes a temporary upload, ignoring the normal "file not found" case.
 */
export async function removeTemporaryProductImage(
    filePath?: string,
): Promise<void> {
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
            throw error;
        }
    }
}
