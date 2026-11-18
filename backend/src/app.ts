
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import authRoutes from "./routes/auth.routes.js";
import categoryRoutes from "./routes/category.routes.js";

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

app.use("/api/auth", authRoutes);
app.use("/api/categories", categoryRoutes);

app.get("/", (req, res) => {
    res.status(200).json({
        message: "E-Commerce Dashboard API is running!",
        status: "success",
    });
});

export default app;
