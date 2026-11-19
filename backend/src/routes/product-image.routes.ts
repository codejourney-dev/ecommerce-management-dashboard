import { Router } from "express";

import {
    uploadProductImageController,
    listProductImagesController,
    getProductImageController,
    updateProductImageController,
    reorderProductImagesController,
    setPrimaryProductImageController,
    deleteProductImageController,
} from "../controllers/product-image.controller.js";

import {
    uploadProductImageMiddleware,
} from "../middlewares/upload.middleware.js";

import {
    authenticateAdmin,
} from "../middlewares/authenticate.middleware.js";

import {
    authorize,
} from "../middlewares/authorize.middleware.js";

import {
    verifySessionCsrf,
} from "../middlewares/csrf.middleware.js";

/**
 * Product image routes.
 *
 * Mounted at:
 * /api/products/:productId/images
 *
 * mergeParams is required because productId is defined by the parent route.
 */
const router = Router({ mergeParams: true });

// -----------------------------------------------------------------------------
// Read product images
// -----------------------------------------------------------------------------

// GET /api/products/:productId/images
router.get(
    "/",
    authenticateAdmin,
    authorize("products.view"),
    listProductImagesController
);

// GET /api/products/:productId/images/:id
router.get(
    "/:id",
    authenticateAdmin,
    authorize("products.view"),
    getProductImageController
);

// -----------------------------------------------------------------------------
// Upload a product image
// -----------------------------------------------------------------------------

// POST /api/products/:productId/images
// multipart/form-data field: "image"
router.post(
    "/",
    authenticateAdmin,
    verifySessionCsrf,
    authorize("products.update"),
    uploadProductImageMiddleware,
    uploadProductImageController
);

// -----------------------------------------------------------------------------
// Reorder product images
// -----------------------------------------------------------------------------

// PATCH /api/products/:productId/images/reorder
// Keep this route before PATCH "/:id" so "reorder" is not treated as an image ID.
router.patch(
    "/reorder",
    authenticateAdmin,
    verifySessionCsrf,
    authorize("products.update"),
    reorderProductImagesController
);

// -----------------------------------------------------------------------------
// Set primary image
// -----------------------------------------------------------------------------

// PATCH /api/products/:productId/images/:id/primary
router.patch(
    "/:id/primary",
    authenticateAdmin,
    verifySessionCsrf,
    authorize("products.update"),
    setPrimaryProductImageController
);

// -----------------------------------------------------------------------------
// Update image metadata
// -----------------------------------------------------------------------------

// PATCH /api/products/:productId/images/:id
router.patch(
    "/:id",
    authenticateAdmin,
    verifySessionCsrf,
    authorize("products.update"),
    updateProductImageController
);

// -----------------------------------------------------------------------------
// Delete product image
// -----------------------------------------------------------------------------

// DELETE /api/products/:productId/images/:id
router.delete(
    "/:id",
    authenticateAdmin,
    verifySessionCsrf,
    authorize("products.update"),
    deleteProductImageController
);

export default router;
