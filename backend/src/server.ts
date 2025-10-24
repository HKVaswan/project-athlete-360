import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./routes/auth";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Health check route for Render (MUST respond quickly)
app.get("/", (_, res) => {
  res.status(200).send("✅ Project Athlete 360 Backend is running!");
});

// API routes
app.use("/api/auth", authRoutes);

// Graceful fallback for unmatched routes
app.use((_, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

// Render requires this dynamic port
const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running and listening on port ${PORT}`);
});
