export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true'
// Адрес бэкенда. Не задан — работают моки (демо на Vercel без реальных данных).
export const API_URL = import.meta.env.VITE_API_URL ?? ''
