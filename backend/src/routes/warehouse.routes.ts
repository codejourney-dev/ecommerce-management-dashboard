import { Router } from "express";

import {
    createWarehouseController,
    listWarehousesController,
    getWarehouseByIdController,
    updateWarehouseController,
    updateWarehouseStatusController,
    deleteWarehouseController,
} from "../controllers/warehouse.controller.js";

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
// Read warehouses
// -----------------------------------------------------------------------------

// GET /api/warehouses
router.get(
    "/",
    authenticateAdmin,
    authorize("inventory.view"),
    listWarehousesController
);

// GET /api/warehouses/:id
router.get(
    "/:id",
    authenticateAdmin,
    authorize("inventory.view"),
    getWarehouseByIdController
);

// -----------------------------------------------------------------------------
// Create warehouse
// -----------------------------------------------------------------------------

// POST /api/warehouses
router.post(
    "/",
    authenticateAdmin,
    verifySessionCsrf,
    authorize("inventory.manage"),
    createWarehouseController
);

// -----------------------------------------------------------------------------
// Update warehouse
// -----------------------------------------------------------------------------

// PATCH /api/warehouses/:id
router.patch(
    "/:id",
    authenticateAdmin,
    verifySessionCsrf,
    authorize("inventory.manage"),
    updateWarehouseController
);

// -----------------------------------------------------------------------------
// Warehouse active status
// -----------------------------------------------------------------------------

// PATCH /api/warehouses/:id/status
router.patch(
    "/:id/status",
    authenticateAdmin,
    verifySessionCsrf,
    authorize("inventory.manage"),
    updateWarehouseStatusController
);

// -----------------------------------------------------------------------------
// Delete warehouse
// -----------------------------------------------------------------------------

// DELETE /api/warehouses/:id
router.delete(
    "/:id",
    authenticateAdmin,
    verifySessionCsrf,
    authorize("inventory.manage"),
    deleteWarehouseController
);

export default router;
