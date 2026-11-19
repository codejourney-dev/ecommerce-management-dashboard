import type { RequestHandler } from "express";
import multer from "multer";
import { fileTypeFromFile } from "file-type";
import { randomUUID } from "node:crypto";
import {
    ensureProductImageTempDirectory,
    PRODUCT_IMAGE_TEMP_DIRECTORY,
    removeTemporaryProductImage,
} from "../utils/storage/image-storage.js";

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

const ALLOWED_IMAGE_MIME_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
]);

const storage = multer.diskStorage({
    destination: (_req, _file, callback) => {
        ensureProductImageTempDirectory()
            .then(() => callback(null, PRODUCT_IMAGE_TEMP_DIRECTORY))
            .catch((error: Error) => callback(error, PRODUCT_IMAGE_TEMP_DIRECTORY));
    },

    filename: (_req, _file, callback) => {
        callback(null, `${randomUUID()}.upload`);
    },
});

const upload = multer({
    storage,
    limits: {
        fileSize: MAX_IMAGE_SIZE,
        files: 1,
        fields: 10,
        parts: 12,
    },
}).single("image");

async function removeTemporaryFile(filePath?: string): Promise<void> {
    if (!filePath) return;

    try {
        await removeTemporaryProductImage(filePath);
    } catch {
        // Cleanup is best-effort; do not hide the original upload error.
    }
}

function sendUploadError(
    res: Parameters<RequestHandler>[1],
    statusCode: number,
    message: string,
    code: string,
): void {
    res.status(statusCode).json({
        status: "error",
        message,
        code,
    });
}

/**
 * Accepts one multipart file under the field name "image".
 *
 * After Multer stores the file temporarily, its actual file signature is
 * inspected with file-type. On success, req.file.mimetype is replaced with
 * the verified MIME type so the controller can safely pass it to the service.
 */
export const uploadProductImageMiddleware: RequestHandler = (
    req,
    res,
    next,
) => {
    upload(req, res, async (uploadError) => {
        if (uploadError) {
            await removeTemporaryFile(req.file?.path);

            if (uploadError instanceof multer.MulterError) {
                if (uploadError.code === "LIMIT_FILE_SIZE") {
                    sendUploadError(
                        res,
                        413,
                        "Image size must not exceed 5 MB.",
                        "PRODUCT_IMAGE_FILE_TOO_LARGE",
                    );
                    return;
                }

                if (uploadError.code === "LIMIT_UNEXPECTED_FILE") {
                    sendUploadError(
                        res,
                        400,
                        'Only one file is allowed, using the field name "image".',
                        "PRODUCT_IMAGE_UNEXPECTED_FILE",
                    );
                    return;
                }

                sendUploadError(
                    res,
                    400,
                    "The uploaded file could not be processed.",
                    "PRODUCT_IMAGE_UPLOAD_INVALID",
                );
                return;
            }

            sendUploadError(
                res,
                500,
                "An error occurred while receiving the uploaded file.",
                "PRODUCT_IMAGE_UPLOAD_FAILED",
            );
            return;
        }

        if (!req.file) {
            sendUploadError(
                res,
                400,
                'An image file is required in the "image" field.',
                "PRODUCT_IMAGE_FILE_REQUIRED",
            );
            return;
        }

        try {
            const detectedType = await fileTypeFromFile(req.file.path);

            if (
                !detectedType ||
                !ALLOWED_IMAGE_MIME_TYPES.has(detectedType.mime)
            ) {
                await removeTemporaryFile(req.file.path);

                sendUploadError(
                    res,
                    415,
                    "Only valid JPEG, PNG, and WebP image files are supported.",
                    "PRODUCT_IMAGE_INVALID_FILE_TYPE",
                );
                return;
            }

            // Do not trust the MIME type supplied by the client.
            req.file.mimetype = detectedType.mime;

            next();
        } catch {
            await removeTemporaryFile(req.file.path);

            sendUploadError(
                res,
                400,
                "The uploaded file is invalid or could not be inspected.",
                "PRODUCT_IMAGE_FILE_INSPECTION_FAILED",
            );
        }
    });
};
