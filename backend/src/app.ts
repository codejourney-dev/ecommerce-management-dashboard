
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";

import authRoutes from "./routes/auth.routes.js";
import categoryRoutes from "./routes/category.routes.js";
import brandRoutes from "./routes/brand.routes.js";
import attributeRoutes from "./routes/attribute.routes.js";
import attributeOptionRoutes from "./routes/attribute-option.routes.js";
import productRoutes from "./routes/product.routes.js";
import variantRoutes from "./routes/variant.routes.js";
import productImageRoutes from "./routes/product-image.routes.js";
import warehouseRoutes from "./routes/warehouse.routes.js";
import inventoryRoutes from "./routes/inventory.routes.js";
import inventoryMovementRoutes from "./routes/inventory-movement.routes.js";
import orderRoutes from "./routes/order.routes.js";

import {
    PRODUCT_IMAGE_PUBLIC_PREFIX,
    PRODUCT_IMAGE_STORAGE_ROOT,
} from "./utils/storage/image-storage.js";

const app = express();

const allowedOrigins = (
    process.env.FRONTEND_ORIGINS ?? ""
).split(",").map((origin) => origin.trim()).filter(Boolean);

app.use(
    cors({
        origin: (origin, callback) => {
            if (!origin) {
                callback(null, true);
                return;
            }
            callback(null, allowedOrigins.includes(origin));
        },
        credentials: true,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: [
            "Content-Type",
            "Authorization",
            "X-CSRF-Token",
        ],
    })
);

app.use(express.json());
app.use(cookieParser());
app.use(
    PRODUCT_IMAGE_PUBLIC_PREFIX,
    express.static(PRODUCT_IMAGE_STORAGE_ROOT, {
        dotfiles: "deny",
        index: false,
        immutable: true,
        maxAge: "7d",
    }),
)

app.use("/api/auth", authRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/brands", brandRoutes);
app.use("/api/attributes", attributeRoutes);
app.use("/api/attributes/:attributeId/options", attributeOptionRoutes);
app.use("/api/products", productRoutes);
app.use("/api/products/:productId/variants", variantRoutes);
app.use("/api/products/:productId/images", productImageRoutes);
app.use("/api/warehouses", warehouseRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/inventory-movements", inventoryMovementRoutes);
app.use("/api/orders", orderRoutes);


app.get("/", (_req, res) => {
    res.status(200).json({
        message: "E-Commerce Dashboard API is running!",
        status: "success",
    });
});

export default app;
