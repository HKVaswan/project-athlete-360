import express from "express";
import cors from "cors";
import "express-async-errors";
import routes from "./routes";
import { errorHandler } from "./middleware/error.middleware";

const app = express();

app.use(express.json());
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:5173",
  credentials: true
}));

app.use("/api", routes);

// SPA fallback (if you serve frontend from same host) — frontend expects SPA routing to be supported. :contentReference[oaicite:12]{index=12}
// app.use(express.static("dist"));
// app.get("*", (_, res) => res.sendFile(path.join(__dirname, "dist", "index.html")));

app.use(errorHandler);

export default app;
