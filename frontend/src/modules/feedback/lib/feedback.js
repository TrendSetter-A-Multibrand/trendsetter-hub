// Чистые функции модуля «Обратная связь». Без React.
import { canSeeData } from '../../../core/access.js'

export const FEEDBACK_KINDS = ['thanks', 'idea', 'complaint', 'other']
export const FEEDBACK_STATUSES = ['new', 'in_progress', 'closed']
export const BODY_LIMIT = 3000
export const NOTE_LIMIT = 2000

// Зеркала бэкенда (modules/feedback/service.py): отправитель — view/run (viewer — нет); читатель — «Ответственный» или администратор.
// module_access читателем не делает: superuser и особые права view/run не дают доступа к чужим сообщениям.
export const canSendFeedback = (me) => canSeeData(me?.module_access?.feedback)
// TODO(Q-FB3): superuser без явного права не читатель
export const isFeedbackReader = (me) => me?.module_responsible?.feedback === true || me?.can_manage_users === true

// Тело POST /modules/feedback/messages из значений формы
export function buildPayload(form) {
  const anonymous = Boolean(form.anonymous)
  return {
    kind: form.kind,
    body: String(form.body ?? '').trim(),
    anonymous,
    contactOk: anonymous ? false : Boolean(form.contactOk),
    recipientId: form.kind === 'thanks' ? (form.recipientId ?? null) : null,
  }
}
