import { Router } from "express";
import {
    createCategoryController,
    listCategoriesController,
    getCategoryTreeController,
    getCategoryByIdController,
    updateCategoryController,
    getCategoryStatusPreviewController,
    updateCategoryStatusController,
    getCategoryDeletePreviewController,
    deleteCategoryController,
} from "../controllers/category.controller.js";
import {
    authenticateAdmin,
} from "../middlewares/authenticate.middleware.js";
import {
    authorize,
} from "../middlewares/authorize.middleware.js";
import {
    verifySessionCsrf,
} from "../middlewares/csrf.middleware.js";
import {
    createCategoryAttributeController,
    updateCategoryAttributeRequiredController,
} from "../controllers/category-attribute.controller.js";

const router = Router();

// -----------------------------------------------------------------------------
// Read categories
// -----------------------------------------------------------------------------

// GET /api/categories
router.get(
    "/",
    authenticateAdmin,
    authorize("categories.view"),
    listCategoriesController
);

// GET /api/categories/tree
router.get(
    "/tree",
    authenticateAdmin,
    authorize("categories.view"),
    getCategoryTreeController
);

// GET /api/categories/:id
router.get(
    "/:id",
    authenticateAdmin,
    authorize("categories.view"),
    getCategoryByIdController
);

// -----------------------------------------------------------------------------
// Create category
// -----------------------------------------------------------------------------

// POST /api/categories
router.post(
    "/",
    authenticateAdmin,
    verifySessionCsrf,
    authorize("categories.create"),
    createCategoryController
);

// -----------------------------------------------------------------------------
// Update category
// -----------------------------------------------------------------------------

// PATCH /api/categories/:id
router.patch(
    "/:id",
    authenticateAdmin,
    verifySessionCsrf,
    authorize("categories.update"),
    updateCategoryController
);

// -----------------------------------------------------------------------------
// Category status management
// -----------------------------------------------------------------------------

// GET /api/categories/:id/status-preview
router.get(
    "/:id/status-preview",
    authenticateAdmin,
    authorize("categories.update"),
    getCategoryStatusPreviewController
);

// PATCH /api/categories/:id/status
router.patch(
    "/:id/status",
    authenticateAdmin,
    verifySessionCsrf,
    authorize("categories.update"),
    updateCategoryStatusController
);

// -----------------------------------------------------------------------------
// Category Attributes
// -----------------------------------------------------------------------------

// POST /api/categories/:id/attributes
// Assign an attribute to a category as optional.
router.post(
    "/:id/attributes",
    authenticateAdmin,
    verifySessionCsrf,
    authorize("categories.attributes.create"),
    createCategoryAttributeController
);

// PATCH /api/categories/:id/attributes/:categoryAttributeId/required
// Change required status after the service validates existing values.
router.patch(
    "/:id/attributes/:categoryAttributeId/required",
    authenticateAdmin,
    verifySessionCsrf,
    authorize("categories.attributes.update"),
    updateCategoryAttributeRequiredController
);

// -----------------------------------------------------------------------------
// Category deletion
// -----------------------------------------------------------------------------

// GET /api/categories/:id/delete-preview
router.get(
    "/:id/delete-preview",
    authenticateAdmin,
    authorize("categories.delete"),
    getCategoryDeletePreviewController
);

// DELETE /api/categories/:id
router.delete(
    "/:id",
    authenticateAdmin,
    verifySessionCsrf,
    authorize("categories.delete"),
    deleteCategoryController
);

export default router;
