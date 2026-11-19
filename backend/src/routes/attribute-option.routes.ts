
import { Router } from "express";

import {
    createAttributeOptionController,
    listAttributeOptionsController,
    getAttributeOptionByIdController,
    updateAttributeOptionController,
    updateAttributeOptionStatusController,
    reorderAttributeOptionsController,
    deleteAttributeOptionController,
} from "../controllers/attribute-option.controller.js";

import {
    authenticateAdmin,
} from "../middlewares/authenticate.middleware.js";

import {
    authorize,
} from "../middlewares/authorize.middleware.js";

import {
    verifySessionCsrf,
} from "../middlewares/csrf.middleware.js";

const router = Router({
    mergeParams: true,
});

// -----------------------------------------------------------------------------
// Read Options
// -----------------------------------------------------------------------------

router.get(
    "/",
    authenticateAdmin,
    authorize("attributes.options.view"),
    listAttributeOptionsController
);

router.get(
    "/:optionId",
    authenticateAdmin,
    authorize("attributes.options.view"),
    getAttributeOptionByIdController
);

// -----------------------------------------------------------------------------
// Create Option
// -----------------------------------------------------------------------------

router.post(
    "/",
    authenticateAdmin,
    verifySessionCsrf,
    authorize("attributes.options.create"),
    createAttributeOptionController
);

// -----------------------------------------------------------------------------
// Reorder Options
// Keep this route before PATCH /:optionId.
// -----------------------------------------------------------------------------

router.patch(
    "/reorder",
    authenticateAdmin,
    verifySessionCsrf,
    authorize("attributes.options.update"),
    reorderAttributeOptionsController
);

// -----------------------------------------------------------------------------
// Update Option
// -----------------------------------------------------------------------------

router.patch(
    "/:optionId",
    authenticateAdmin,
    verifySessionCsrf,
    authorize("attributes.options.update"),
    updateAttributeOptionController
);

// -----------------------------------------------------------------------------
// Update Option Status
// -----------------------------------------------------------------------------

router.patch(
    "/:optionId/status",
    authenticateAdmin,
    verifySessionCsrf,
    authorize("attributes.options.update"),
    updateAttributeOptionStatusController
);

// -----------------------------------------------------------------------------
// Delete Option
// -----------------------------------------------------------------------------

router.delete(
    "/:optionId",
    authenticateAdmin,
    verifySessionCsrf,
    authorize("attributes.options.delete"),
    deleteAttributeOptionController
);

export default router;
