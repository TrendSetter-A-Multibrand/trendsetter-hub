// Светлая / тёмная тема. Выбор хранится в браузере (localStorage), по умолчанию — как в системе.
// Тема ставится атрибутом data-theme на <html> (переменные styles.css); antd получает её через ThemeModeProvider.
import { createContext, useContext } from 'react'

export const THEME_KEY = 'hub.theme'
export const ThemeModeContext = createContext({ mode: 'light', toggle: () => {} })
export const useThemeMode = () => useContext(ThemeModeContext)

function systemMode() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

// Сохранённый выбор или системная тема. Хранилище может быть недоступно (приватный режим) — тогда системная.
export function initialMode() {
  try {
    const saved = window.localStorage.getItem(THEME_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // нет доступа к localStorage
  }
  return systemMode()
}

export function saveMode(mode) {
  try {
    window.localStorage.setItem(THEME_KEY, mode)
  } catch {
    // выбор не сохранится между визитами — не страшно
  }
}

export const applyMode = (mode) => {
  document.documentElement.dataset.theme = mode
}
