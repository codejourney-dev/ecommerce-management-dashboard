import { Router } from "express";

import {
    createVariantController,
    listVariantsController,
    getVariantByIdController,
    updateVariantController,
    updateVariantStatusController,
    deleteVariantController,
} from "../controllers/variant.controller.js";

import {
    authenticateAdmin,
} from "../middlewares/authenticate.middleware.js";

import {
    authorize,
} from "../middlewares/authorize.middleware.js";

import {
    verifySessionCsrf,
} from "../middlewares/csrf.middleware.js";

const router = Router({ mergeParams: true });

// -----------------------------------------------------------------------------
// Read product variants
// -----------------------------------------------------------------------------

// GET /api/products/:productId/variants
router.get(
    "/",
    authenticateAdmin,
    authorize("products.view"),
    listVariantsController
);

// GET /api/products/:productId/variants/:id
router.get(
    "/:id",
    authenticateAdmin,
    authorize("products.view"),
    getVariantByIdController
);

// -----------------------------------------------------------------------------
// Create product variant
// -----------------------------------------------------------------------------

// POST /api/products/:productId/variants
router.post(
    "/",
    authenticateAdmin,
    verifySessionCsrf,
    authorize("products.create"),
    createVariantController
);

// -----------------------------------------------------------------------------
// Update product variant
// -----------------------------------------------------------------------------

// PATCH /api/products/:productId/variants/:id
router.patch(
    "/:id",
    authenticateAdmin,
    verifySessionCsrf,
    authorize("products.update"),
    updateVariantController
);

// -----------------------------------------------------------------------------
// Variant active status
// -----------------------------------------------------------------------------

// PATCH /api/products/:productId/variants/:id/status
router.patch(
    "/:id/status",
    authenticateAdmin,
    verifySessionCsrf,
    authorize("products.update"),
    updateVariantStatusController
);

// -----------------------------------------------------------------------------
// Deactivate product variant
// -----------------------------------------------------------------------------

// DELETE /api/products/:productId/variants/:id
router.delete(
    "/:id",
    authenticateAdmin,
    verifySessionCsrf,
    authorize("products.delete"),
    deleteVariantController
);

export default router;
