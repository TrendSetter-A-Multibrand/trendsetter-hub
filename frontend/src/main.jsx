import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App as AntApp } from 'antd'
import ruRU from 'antd/locale/ru_RU'
import ThemeModeProvider from './core/ThemeModeProvider.jsx'
import { applyMode, initialMode } from './core/themeMode.js'
import './core/styles.css'
import AuthProvider from './core/auth/AuthProvider.jsx'
import AppRoutes from './core/AppRoutes.jsx'

// Тема ставится до первой отрисовки, чтобы не мигал светлый фон
applyMode(initialMode())

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeModeProvider locale={ruRU}>
      <AntApp>
        <BrowserRouter>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </BrowserRouter>
      </AntApp>
    </ThemeModeProvider>
  </StrictMode>,
)
