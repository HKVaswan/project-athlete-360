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
  base: '/', // ✅ required for Vercel
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:5000', // only for local dev
        changeOrigin: true,
        secure: false,
      },
    },
  },
});