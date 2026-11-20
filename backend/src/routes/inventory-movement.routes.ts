import { Router } from "express";
import {
    authenticateAdmin,
} from "../middlewares/authenticate.middleware.js";
import {
    authorize,
} from "../middlewares/authorize.middleware.js";
import {
    listInventoryMovementsController,
    getInventoryMovementByIdController,
} from "../controllers/inventory-movement.controller.js";

const router = Router();

// Read-only audit history: both endpoints require an authenticated admin
// with the inventory.view permission.
router.get(
    "/",
    authenticateAdmin,
    authorize("inventory.view"),
    listInventoryMovementsController
);

router.get(
    "/:id",
    authenticateAdmin,
    authorize("inventory.view"),
    getInventoryMovementByIdController
);

export default router;
