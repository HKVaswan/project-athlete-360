// src/services/api.ts
import axios from "axios";

// Use environment variable if available, fallback to default URL
const API_URL = (process.env.REACT_APP_API_URL || "https://project-athlete-360.onrender.com").replace(/\/+$/, "");

const api = axios.create({
  baseURL: API_URL,
  headers: {
    "Content-Type": "application/json",
  },
  timeout: 10000, // optional: 10 seconds timeout for requests
});

// Optional: Add interceptor to attach auth token automatically
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token"); // Or use context/store
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
}, (error) => Promise.reject(error));

export default api;