import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { Alert, Badge, Button, Spin, Tabs, Typography } from 'antd'
import { api } from '../api/index.js'
import { useAuth } from '../auth/useAuth.js'
import { PROFILE_SECTIONS } from '../../modules/registry.js'
import strings from '../strings.js'

const s = strings.profile

// Раздел ядра: доступен всем активным (включая viewer), первый в списке; остальные приходят из реестра модулей
const SETTINGS_SECTION = {
  id: 'settings',
  label: s.settings.label,
  visible: () => true,
  Component: lazy(() => import('./SettingsSection.jsx')),
}
const SECTIONS = [SETTINGS_SECTION, ...PROFILE_SECTIONS]

const loadSection = (section, me) =>
  section.load ? Promise.resolve(section.load(api, me)).catch(() => null) : Promise.resolve(undefined)

// Личная страница сотрудника. Разделы приходят из реестра модулей (PROFILE_SECTIONS), ядро их содержания не знает.
function Profile() {
  const { me, syncMe, logout } = useAuth()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const [datas, setDatas] = useState(null) // { [sectionId]: данные раздела }; null — первая загрузка

  const meRef = useRef(me)
  useEffect(() => {
    meRef.current = me
  }, [me])

  // Данные перечитываются при каждом переходе на страницу (в т.ч. по ссылке из уведомления), прежние остаются на экране
  useEffect(() => {
    let alive = true
    Promise.all(SECTIONS.map((sec) => loadSection(sec, meRef.current))).then((list) => {
      if (alive) setDatas(Object.fromEntries(SECTIONS.map((sec, i) => [sec.id, list[i]])))
    })
    return () => {
      alive = false
    }
  }, [location.key, me.id])

  // Перечитать один раздел и /core/me (счётчики уведомлений и бейджей)
  const reload = useCallback(
    async (id) => {
      const sec = SECTIONS.find((x) => x.id === id)
      const fresh = await loadSection(sec, meRef.current)
      setDatas((cur) => ({ ...cur, [id]: fresh }))
      await syncMe()
    },
    [syncMe],
  )

  if (datas === null) return <Spin />

  const visible = SECTIONS.filter((sec) => sec.visible(me, datas[sec.id]))
  const requested = params.get('section')
  const active = visible.find((sec) => sec.id === requested) ?? visible[0]

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Typography.Title level={2} style={{ marginTop: 0, marginBottom: 4 }}>
          {s.title}
        </Typography.Title>
        <Button onClick={() => logout()}>{strings.layout.logout}</Button>
      </div>
      <div style={{ color: 'var(--muted)', marginBottom: 20 }}>
        {me.full_name} · {strings.levels[me.access_level]}
      </div>
      {!active ? (
        <Alert type="info" showIcon title={s.noSections} />
      ) : (
        <Tabs
          activeKey={active.id}
          onChange={(key) => setParams({ section: key }, { replace: true })}
          items={visible.map((sec) => {
            const count = sec.badge ? sec.badge(datas[sec.id]) : 0
            return {
              key: sec.id,
              label: count > 0 ? (
                <span>
                  {sec.label} <Badge count={count} overflowCount={99} style={{ marginLeft: 4 }} />
                </span>
              ) : (
                sec.label
              ),
              children: (
                <Suspense fallback={<Spin />}>
                  <sec.Component me={me} data={datas[sec.id]} reload={() => reload(sec.id)} />
                </Suspense>
              ),
            }
          })}
        />
      )}
    </div>
  )
}

// key по пользователю: при смене пользователя (демо-переключатель, повторный вход) состояние разделов не переносится
export default function ProfilePage() {
  const { me } = useAuth()
  return <Profile key={me.id} />
}
