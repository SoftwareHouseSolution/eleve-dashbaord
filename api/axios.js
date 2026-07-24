import axios from 'axios';
import { getPublicApiBaseUrl } from '../lib/publicEnv';
const BASE_URL = getPublicApiBaseUrl();

const api = axios.create({
  baseURL: BASE_URL,
  headers: {},
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('eleve_token');
  if (token) {
    config.headers.Authorization = `Token ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('eleve_token');
      localStorage.removeItem('eleve_user');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
