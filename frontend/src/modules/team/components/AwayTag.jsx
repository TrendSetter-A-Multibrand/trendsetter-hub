import { formatDate } from '../../../core/dates.js'
import strings from '../strings.js'

const s = strings.leave

// Метка «в отпуске» (сегодня попадает в согласованный отпуск). away — { end } из awayMap или undefined.
export default function AwayTag({ away, className = '' }) {
  if (!away) return null
  return (
    <span className={`tm-away ${className}`} title={s.awayUntil(formatDate(away.end))}>
      {s.away}
    </span>
  )
}
