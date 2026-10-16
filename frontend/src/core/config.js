// Адрес бэкенда. Не задан — работают моки (демо на Vercel без реальных данных).
export const API_URL = import.meta.env.VITE_API_URL ?? ''
// Демо-элементы (баннер, вход без пароля) только на моках: с настоящим бэкендом их нет
export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true' && !API_URL
