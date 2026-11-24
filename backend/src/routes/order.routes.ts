
import { Router } from "express";

import {
  getOrders,
  getOrderByIdController,
} from "../controllers/order.controller.js";

import { authenticateAdmin } from "../middlewares/authenticate.middleware.js";
import { authorize } from "../middlewares/authorize.middleware.js";

// --------------------------------------------------
// Router
// --------------------------------------------------

const router = Router();

// --------------------------------------------------
// Order Routes
// --------------------------------------------------

// GET /api/orders
// Get all orders
router.get(
  "/",
  authenticateAdmin,
  authorize("orders.view"),
  getOrders
);

// GET /api/orders/:id
// Get order details
router.get(
  "/:id",
  authenticateAdmin,
  authorize("orders.view"),
  getOrderByIdController
);

export default router;
