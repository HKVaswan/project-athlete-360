import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./routes/auth";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Health check (Render pings this)
app.get("/", (_, res) => {
  res.status(200).send("✅ Project Athlete 360 Backend is running!");
});

// API routes
app.use("/api/auth", authRoutes);

// 404 fallback
app.use((_, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

// Convert PORT to number safely
const PORT = Number(process.env.PORT) || 10000;

// Listen on 0.0.0.0 (important for Render)
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running and listening on port ${PORT}`);
});
