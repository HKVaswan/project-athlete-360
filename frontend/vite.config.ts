// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // allow external hosts (Replit, Netlify, etc.)
    strictPort: true,
    port: 5000, // keep consistent
  },
});
