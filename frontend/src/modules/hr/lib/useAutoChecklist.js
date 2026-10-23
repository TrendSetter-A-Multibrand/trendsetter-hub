import { useCallback, useEffect, useState } from 'react'
import { App } from 'antd'
import { api } from '../../../core/api/index.js'
import strings from '../strings.js'
import { activeTemplates, pickTemplateId, startAutoChecklist } from './autoChecklist.js'

// Состояние опции «запустить чек-лист автоматически». kind — 'onboarding' | 'offboarding'; active=false — не грузить шаблоны (правка карточки и т.п.).
// status: 'hidden' (не показывать) | 'loading' | 'none' (нет активного шаблона) | 'ready'.
// run(personId) -> { status: 'started' | 'exists' | 'failed' | 'skipped', checklist? }; запуск вызывать ПОСЛЕ успешного основного действия.
export function useAutoChecklist(kind, { active = true, initialEnabled = true, initialTemplateId = null } = {}) {
  const { message } = App.useApp()
  const [templates, setTemplates] = useState(null)
  const [failed, setFailed] = useState(false)
  const [enabled, setEnabled] = useState(initialEnabled)
  const [chosenId, setTemplateId] = useState(initialTemplateId)

  useEffect(() => {
    if (!active) return undefined
    let alive = true
    api
      .get('/modules/hr/checklist-templates')
      .then((data) => alive && setTemplates(data))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [active])

  const list = templates ? activeTemplates(templates, kind) : []
  const templateId = pickTemplateId(list, chosenId)
  const template = list.find((t) => t.id === templateId) ?? null
  const status = !active || failed ? 'hidden' : templates === null ? 'loading' : list.length === 0 ? 'none' : 'ready'
  const on = status === 'ready' && enabled

  const run = useCallback(
    async (personId) => {
      if (!on || personId === undefined || personId === null) return { status: 'skipped' }
      const result = await startAutoChecklist(api, { personId, templateId, kind, skipIfActive: kind === 'offboarding' })
      if (result.status === 'failed') message.warning(strings.autoChecklist.startFailed)
      return result
    },
    [on, templateId, kind, message],
  )

  return { kind, status, templates: list, template, templateId, enabled, setEnabled, setTemplateId, run }
}
