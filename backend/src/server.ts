import express from "express";

const app = express();

const PORT = 3000;

// Middlewares
app.use(express.json());
// Routes
app.get("/", (req, res) => {
    res.status(200).json({
        message: "E-Commerce Dashboard API is running!",
        status: "success"
    });
});
// Start Server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
})