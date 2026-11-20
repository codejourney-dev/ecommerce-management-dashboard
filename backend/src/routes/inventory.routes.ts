import { Router } from "express";
import {
    authenticateAdmin,
} from "../middlewares/authenticate.middleware.js";
import {
    verifySessionCsrf,
} from "../middlewares/csrf.middleware.js";
import { authorize } from "../middlewares/authorize.middleware.js";
import {
    listInventoryController,
    getInventoryByIdController,
    getVariantInventoryController,
    updateReorderLevelController,
    stockInController,
    stockOutController,
    adjustInventoryController,
    returnStockController,
    reserveInventoryController,
    releaseInventoryController,
    transferInventoryController,
    listInventoryMovementsController,
    getInventoryMovementByIdController,
} from "../controllers/inventory.controller.js";

const router = Router();

// Read inventory records and stock summaries.
router.get(
    "/",
    authenticateAdmin,
    authorize("inventory.view"),
    listInventoryController
);

// Keep specific paths before "/:id" to avoid route-parameter collisions.
router.get(
    "/movements",
    authenticateAdmin,
    authorize("inventory.view"),
    listInventoryMovementsController
);

router.get(
    "/movements/:id",
    authenticateAdmin,
    authorize("inventory.view"),
    getInventoryMovementByIdController
);

router.get(
    "/variants/:variantId",
    authenticateAdmin,
    authorize("inventory.view"),
    getVariantInventoryController
);

router.get(
    "/:id",
    authenticateAdmin,
    authorize("inventory.view"),
    getInventoryByIdController
);

// Inventory mutations require an authenticated session, CSRF validation,
// and the inventory.manage permission.
router.patch(
    "/:id/reorder-level",
    authenticateAdmin,
    verifySessionCsrf,
    authorize("inventory.manage"),
    updateReorderLevelController
);

router.post(
    "/stock-in",
    authenticateAdmin,
    verifySessionCsrf,
    authorize("inventory.manage"),
    stockInController
);

router.post(
    "/stock-out",
    authenticateAdmin,
    verifySessionCsrf,
    authorize("inventory.manage"),
    stockOutController
);

router.post(
    "/adjustment",
    authenticateAdmin,
    verifySessionCsrf,
    authorize("inventory.manage"),
    adjustInventoryController
);

router.post(
    "/return",
    authenticateAdmin,
    verifySessionCsrf,
    authorize("inventory.manage"),
    returnStockController
);

router.post(
    "/reserve",
    authenticateAdmin,
    verifySessionCsrf,
    authorize("inventory.manage"),
    reserveInventoryController
);

router.post(
    "/release",
    authenticateAdmin,
    verifySessionCsrf,
    authorize("inventory.manage"),
    releaseInventoryController
);

router.post(
    "/transfer",
    authenticateAdmin,
    verifySessionCsrf,
    authorize("inventory.manage"),
    transferInventoryController
);

export default router;
