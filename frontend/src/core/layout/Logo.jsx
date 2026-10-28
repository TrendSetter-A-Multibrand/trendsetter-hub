import { Link } from 'react-router-dom'
import logoSvg from './logo.svg?raw'
import strings from '../strings.js'

// Логотип — оригинальный вектор из дизайн-системы (01 Атомы, trendsetter_logo), не перерисован и не набран текстом.
// Цвет — currentColor: Red в светлой теме, White в тёмной (официальные варианты логотипа).
export default function Logo() {
  return (
    <Link to="/" className="brand-logo" aria-label={strings.brand}>
      <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: logoSvg }} />
    </Link>
  )
}
