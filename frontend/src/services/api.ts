import axios from 'axios';

const API_URL = 'https://project-athlete-360.onrender.com';

const api = axios.create({
  baseURL: API_URL,
});

export default api;
