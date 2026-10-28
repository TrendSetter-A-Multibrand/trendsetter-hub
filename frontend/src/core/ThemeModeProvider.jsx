import { useCallback, useEffect, useMemo, useState } from 'react'
import { ConfigProvider } from 'antd'
import { getTheme } from './theme.js'
import { ThemeModeContext, applyMode, initialMode, saveMode } from './themeMode.js'

// Светлая / тёмная тема для всего приложения: атрибут data-theme на <html> и тема antd
export default function ThemeModeProvider({ locale, children }) {
  const [mode, setMode] = useState(initialMode)

  useEffect(() => applyMode(mode), [mode])

  const toggle = useCallback(() => {
    setMode((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark'
      saveMode(next)
      return next
    })
  }, [])

  const value = useMemo(() => ({ mode, toggle }), [mode, toggle])
  const antdTheme = useMemo(() => getTheme(mode), [mode])

  return (
    <ThemeModeContext.Provider value={value}>
      <ConfigProvider locale={locale} theme={antdTheme}>
        {children}
      </ConfigProvider>
    </ThemeModeContext.Provider>
  )
}
