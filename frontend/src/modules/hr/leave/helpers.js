import { formatDate, todayIso } from '../../../core/dates.js'

// Отозвать можно свою pending или будущую approved (правило ТЗ, раздел «Заявка на отпуск»)
export const canCancelRequest = (r) => r.status === 'pending' || (r.status === 'approved' && r.start >= todayIso())

export const periodText = (r) => `${formatDate(r.start)} — ${formatDate(r.end)}`
