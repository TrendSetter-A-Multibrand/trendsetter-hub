import strings from '../strings.js'
import { formatDateTime } from '../../../core/format.js'

const s = strings.audit

// Группы фильтра «Тип действия» -> точные названия action (docs/TZ-security.md). Единственное место маппинга.
// Новое действие на сервере: добавить сюда (или в UNGROUPED) и подпись в strings.audit.labels — тест следит за этим.
export const ACTION_GROUPS = {
  money: [
    'hr.sensitive_view', 'hr.sensitive_update', 'hr.compensation_view', 'hr.documents_list',
    'hr.document_upload', 'hr.document_download', 'hr.document_update', 'hr.document_delete',
  ],
  dossier: [
    'hr.file_update', 'hr.history_add', 'hr.history_delete', 'hr.equipment_add', 'hr.equipment_update', 'hr.equipment_delete',
    'team.person_create', 'team.person_update', 'team.person_archive', 'team.field_create', 'team.field_update',
    'team.submit', 'team.approve', 'team.reject', 'team.cancel', 'team.import_responses',
  ],
  leave: [
    'hr.leave_request', 'hr.leave_approve', 'hr.leave_reject', 'hr.leave_cancel', 'hr.leave_adjust',
    'hr.plan_add', 'hr.plan_cancel', 'hr.plan_convert', 'hr.policy_update',
  ],
  checklists: ['hr.checklist_start', 'hr.checklist_item', 'hr.checklist_close', 'hr.checklist_cancel', 'hr.template_update'],
  access: ['core.user_permission_set', 'core.password_change', 'core.password_reset'],
  export: ['hr.export'],
}

// Служебные действия: видны при «Все действия», в отдельную группу не входят
export const UNGROUPED = ['hr.audit_view', 'hr.reminders_run', 'team.seed_import', 'team.seed_rollback']

export const GROUP_KEYS = Object.keys(ACTION_GROUPS)

// Действия группы для серверного фильтра `action` (список через запятую); нет группы — undefined (без фильтра)
export const actionsOfGroup = (group) => (group ? ACTION_GROUPS[group]?.join(',') : undefined)

// 2026-10-24T11:05:00Z -> «24.10.2026 14:05» (местное время браузера)
export const formatAt = (iso) => formatDateTime(iso).replace(', ', ' ')

const detailValue = (value) => {
  if (typeof value === 'boolean') return value ? s.yes : s.no
  if (Array.isArray(value)) return value.join(', ')
  return String(value)
}

// Компактный текст из details: «документ №5 · категория: contract». person_id не показываем (есть колонка «Чья карточка»).
// Показываем только ключи белого списка с подписью; значения — как пришли (это служебные коды и числа, не данные полей).
export function formatDetails(details) {
  if (!details || typeof details !== 'object') return ''
  return Object.entries(details)
    .filter(([key, value]) => s.detailKeys[key] && value !== null && value !== undefined && value !== '')
    .map(([key, value]) => {
      const label = s.detailKeys[key]
      return label.endsWith('№') ? `${label}${detailValue(value)}` : `${label}: ${detailValue(value)}`
    })
    .join(' · ')
}

// Параметры запроса журнала; пустые фильтры не передаются
export function auditQuery({ personId, action, from, to, limit, offset }) {
  const params = new URLSearchParams()
  if (personId !== null && personId !== undefined) params.set('personId', String(personId))
  if (action) params.set('action', action)
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  params.set('limit', String(limit))
  params.set('offset', String(offset))
  return params.toString()
}
