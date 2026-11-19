
import { Router } from "express";

import {
    createAttributeController,
    listAttributesController,
    getAttributeByIdController,
    updateAttributeController,
    updateAttributeStatusController,
    deleteAttributeController,
} from "../controllers/attribute.controller.js";

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
// Read attributes
// -----------------------------------------------------------------------------

router.get(
    "/",
    authenticateAdmin,
    authorize("attributes.view"),
    listAttributesController
);

router.get(
    "/:id",
    authenticateAdmin,
    authorize("attributes.view"),
    getAttributeByIdController
);

// -----------------------------------------------------------------------------
// Create attribute
// -----------------------------------------------------------------------------

router.post(
    "/",
    authenticateAdmin,
    verifySessionCsrf,
    authorize("attributes.create"),
    createAttributeController
);

// -----------------------------------------------------------------------------
// Update attribute
// -----------------------------------------------------------------------------

router.patch(
    "/:id",
    authenticateAdmin,
    verifySessionCsrf,
    authorize("attributes.update"),
    updateAttributeController
);

// -----------------------------------------------------------------------------
// Attribute status
// -----------------------------------------------------------------------------

router.patch(
    "/:id/status",
    authenticateAdmin,
    verifySessionCsrf,
    authorize("attributes.update"),
    updateAttributeStatusController
);

// -----------------------------------------------------------------------------
// Delete attribute
// -----------------------------------------------------------------------------

router.delete(
    "/:id",
    authenticateAdmin,
    verifySessionCsrf,
    authorize("attributes.delete"),
    deleteAttributeController
);

export default router;
