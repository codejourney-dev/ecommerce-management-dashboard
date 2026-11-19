import { Router } from "express";

import {
    createProductController,
    listProductsController,
    getProductByIdController,
    updateProductController,
    updateProductStatusController,
    deleteProductController,
} from "../controllers/product.controller.js";

import {
    authenticateAdmin,
} from "../middlewares/authenticate.middleware.js";

import {
    authorize,
} from "../middlewares/authorize.middleware.js";

import {
    verifySessionCsrf,
} from "../middlewares/csrf.middleware.js";

const router = Router();

// -----------------------------------------------------------------------------
// Read products
// -----------------------------------------------------------------------------

// GET /api/products
router.get(
    "/",
    authenticateAdmin,
    authorize("products.view"),
    listProductsController
);

// GET /api/products/:id
router.get(
    "/:id",
    authenticateAdmin,
    authorize("products.view"),
    getProductByIdController
);

// -----------------------------------------------------------------------------
// Create product
// -----------------------------------------------------------------------------

// POST /api/products
router.post(
    "/",
    authenticateAdmin,
    verifySessionCsrf,
    authorize("products.create"),
    createProductController
);

// -----------------------------------------------------------------------------
// Update product
// -----------------------------------------------------------------------------

// PATCH /api/products/:id
router.patch(
    "/:id",
    authenticateAdmin,
    verifySessionCsrf,
    authorize("products.update"),
    updateProductController
);

// -----------------------------------------------------------------------------
// Product status
// -----------------------------------------------------------------------------

// PATCH /api/products/:id/status
router.patch(
    "/:id/status",
    authenticateAdmin,
    verifySessionCsrf,
    authorize("products.update"),
    updateProductStatusController
);

// -----------------------------------------------------------------------------
// Delete product (soft delete)
// -----------------------------------------------------------------------------

// DELETE /api/products/:id
router.delete(
    "/:id",
    authenticateAdmin,
    verifySessionCsrf,
    authorize("products.delete"),
    deleteProductController
);

export default router;
