
import { Router } from "express";

import {
    createBrandController,
    listBrandsController,
    getBrandByIdController,
    updateBrandController,
    updateBrandStatusController,
    deleteBrandController,
    setBrandCategoriesController,
    getAvailableBrandsByCategoryController,
} from "../controllers/brand.controller.js";

import { authenticateAdmin } from "../middlewares/authenticate.middleware.js";
import { authorize } from "../middlewares/authorize.middleware.js";
import { verifySessionCsrf } from "../middlewares/csrf.middleware.js";

const router = Router();

// All brand routes require admin authentication.
router.use(authenticateAdmin);

// List available brands for a category.
// Must be declared before /:id.
router.get(
    "/available",
    authorize("brands.view"),
    getAvailableBrandsByCategoryController
);

// List brands.
router.get(
    "/",
    authorize("brands.view"),
    listBrandsController
);

// Create a brand.
router.post(
    "/",
    verifySessionCsrf,
    authorize("brands.create"),
    createBrandController
);

// Get a brand by ID.
router.get(
    "/:id",
    authorize("brands.view"),
    getBrandByIdController
);

// Update brand information.
router.patch(
    "/:id",
    verifySessionCsrf,
    authorize("brands.update"),
    updateBrandController
);

// Activate or deactivate a brand.
router.patch(
    "/:id/status",
    verifySessionCsrf,
    authorize("brands.update"),
    updateBrandStatusController
);

// Replace brand category assignments.
router.put(
    "/:id/categories",
    verifySessionCsrf,
    authorize("brands.update"),
    setBrandCategoriesController
);

// Delete a brand.
router.delete(
    "/:id",
    verifySessionCsrf,
    authorize("brands.delete"),
    deleteBrandController
);

export default router;
