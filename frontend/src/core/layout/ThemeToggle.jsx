import { MoonOutlined, SunOutlined } from '@ant-design/icons'
import { Tooltip } from 'antd'
import { useThemeMode } from '../themeMode.js'
import strings from '../strings.js'

const s = strings.layout

// Переключатель светлой / тёмной темы: иконка показывает, на какую тему переключит нажатие
export default function ThemeToggle() {
  const { mode, toggle } = useThemeMode()
  const label = mode === 'dark' ? s.themeLight : s.themeDark
  return (
    <Tooltip title={label}>
      <button type="button" className="icon-btn" onClick={toggle} aria-label={label}>
        {mode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
      </button>
    </Tooltip>
  )
}
