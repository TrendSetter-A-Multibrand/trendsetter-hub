import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../../core/api/index.js'
import { useAuth } from '../../core/auth/useAuth.js'
import ForbiddenPage from '../../core/pages/ForbiddenPage.jsx'
import PageHead from '../../core/layout/PageHead.jsx'
import strings from './strings.js'
import SubmissionsTab from './components/SubmissionsTab.jsx'
import PeopleTab from './components/PeopleTab.jsx'
import FieldsTab from './components/FieldsTab.jsx'
import LeavesTab from './components/LeavesTab.jsx'
import PoliciesTab from './components/PoliciesTab.jsx'
import ChecklistTemplatesTab from './components/ChecklistTemplatesTab.jsx'
import AuditTab from './components/AuditTab.jsx'
import PlanTab from './plan/PlanTab.jsx'
import { mergeTabs } from './lib/tabs.js'
import './hr.css'

// Вкладки модуля. Новая вкладка (зарплаты…) = одна запись здесь. Component получает { pending, onChanged, actionsEl }
// (actionsEl — место для кнопок в шапке страницы, вкладка выводит их туда порталом).
// badge: 'pending' — число анкет на проверке, 'leavePending' — число заявок на отпуск, ждущих решения, рядом с названием.
// visible(me): вкладка показывается только при true (нет поля — всем). Журнал: ответственный за HR или администратор.
// badge также может быть функцией (me) => число (вкладки из module.extraTabs: реестр добавляет их перед группой «Безопасность»; groupLabel — подпись их группы).
// group: ключ из strings.groups; вкладки одной группы должны идти подряд (новая группа, например «Зарплата» — новая запись + подпись в strings.groups).
const TABS = [
  { key: 'people', group: 'staff', label: strings.tabs.people, Component: PeopleTab },
  { key: 'checklists', group: 'staff', label: strings.tabs.checklists, Component: ChecklistTemplatesTab },
  { key: 'submissions', group: 'forms', label: strings.tabs.submissions, badge: 'pending', Component: SubmissionsTab },
  { key: 'fields', group: 'forms', label: strings.tabs.fields, Component: FieldsTab },
  { key: 'leave', group: 'leave', label: strings.tabs.leave, badge: 'leavePending', Component: LeavesTab },
  { key: 'plan', group: 'leave', label: strings.tabs.plan, Component: PlanTab },
  { key: 'policies', group: 'leave', label: strings.tabs.policies, Component: PoliciesTab },
  { key: 'audit', group: 'security', label: strings.tabs.audit, Component: AuditTab, visible: (me) => Boolean(me.module_responsible?.hr || me.can_manage_users) },
]

export default function HrPage({ module, access }) {
  const [params, setParams] = useSearchParams()
  const [actionsEl, setActionsEl] = useState(null)
  const { me, syncMe } = useAuth()
  const [pending, setPending] = useState(0)
  const [leavePending, setLeavePending] = useState(0)

  const refreshPending = useCallback(async () => {
    try {
      setPending((await api.get('/modules/team/hr/pending-count')).count)
    } catch {
      // бейдж не критичен: остаётся прежнее число
    }
  }, [])

  // бейдж вкладки «Отпуска» = заявки, ждущие HR (awaitingHr), как и бейдж модуля в меню
  const refreshLeavePending = useCallback(async () => {
    try {
      setLeavePending((await api.get('/modules/hr/leave/requests?status=pending')).filter((r) => r.awaitingHr).length)
    } catch {
      // бейдж не критичен
    }
  }, [])

  useEffect(() => {
    if (access !== 'run') return
    api
      .get('/modules/team/hr/pending-count')
      .then((r) => setPending(r.count))
      .catch(() => {})
    api
      .get('/modules/hr/leave/requests?status=pending')
      .then((r) => setLeavePending(r.filter((x) => x.awaitingHr).length))
      .catch(() => {})
  }, [access])

  // после решения по заявке: число во вкладке и бейдж в меню/хабе (из /core/me)
  const onChanged = useCallback(async () => {
    await Promise.all([refreshPending(), refreshLeavePending()])
    await syncMe()
  }, [refreshPending, refreshLeavePending, syncMe])

  if (access !== 'run') return <ForbiddenPage />

  const badges = { pending, leavePending }
  const tabs = mergeTabs(TABS, module.extraTabs ?? []).filter((t) => !t.visible || t.visible(me))
  const current = tabs.find((t) => t.key === params.get('tab')) ?? tabs[0]
  const groups = tabs.reduce((acc, t) => {
    const last = acc[acc.length - 1]
    if (last?.key === t.group) last.items.push(t)
    else acc.push({ key: t.group, items: [t] })
    return acc
  }, [])
  const { Component } = current
  const pick = (key) => setParams(key === tabs[0].key ? {} : { tab: key })

  return (
    <div className="stack module hr">
      <PageHead module={module} title={module.strings.tool}>
        <div ref={setActionsEl} className="page-actions" />
      </PageHead>
      <nav className="hr-nav" aria-label={strings.navLabel}>
        {groups.map((g) => (
          <div key={g.key} className="hr-nav-group">
            <span className="hr-nav-title">{strings.groups[g.key] ?? g.items[0].groupLabel}</span>
            <div className="hr-nav-items">
              {g.items.map((t) => {
                const on = t.key === current.key
                const count = typeof t.badge === 'function' ? t.badge(me) : t.badge ? badges[t.badge] : 0
                return (
                  <button key={t.key} type="button" className={`hr-nav-item${on ? ' active' : ''}`} aria-current={on ? 'page' : undefined} onClick={() => pick(t.key)}>
                    {on ? (
                      <span>
                        <span className="bracket" aria-hidden="true">[</span>&nbsp;{t.label}&nbsp;<span className="bracket" aria-hidden="true">]</span>
                      </span>
                    ) : (
                      t.label
                    )}
                    {count > 0 && <span className="nav-badge">{count > 99 ? '99+' : count}</span>}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </nav>
      <Suspense fallback={null}>
        <Component key={current.key} pending={pending} onChanged={onChanged} actionsEl={actionsEl} />
      </Suspense>
    </div>
  )
}
