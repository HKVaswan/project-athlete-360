import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // allows external access (needed on Replit)
    port: 5000, // keep your frontend on port 5000
    allowedHosts: [
      'localhost',
      '127.0.0.1',
      '.replit.dev'   // 👈 allows all Replit preview subdomains automatically
    ]
  }
})
