import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./routes/auth";

dotenv.config();

const app = express();

// ✅ Allow frontend domain explicitly (Render safe CORS setup)
app.use(cors({
  origin: [
    "https://project-athlete-360-fd.onrender.com", // frontend
    "http://localhost:5173" // local dev
  ],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
}));

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

// ✅ Convert PORT to number safely and listen on 0.0.0.0
const PORT = Number(process.env.PORT) || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running and listening on port ${PORT}`);
});
