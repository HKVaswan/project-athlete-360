import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import * as path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // ✅ Use relative base for static hosting on Render
  base: './',
  server: {
    port: 5173, // optional, Vite default is 5173
    open: true, // automatically opens browser on dev
    proxy: {
      // Local dev proxy to backend
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api/, '/api'),
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true, // optional, helpful for debugging production
  },
});