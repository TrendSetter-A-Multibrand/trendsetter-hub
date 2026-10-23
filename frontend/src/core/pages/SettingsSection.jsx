import { Descriptions } from 'antd'
import strings from '../strings.js'

const s = strings.profile.settings

// Раздел «Настройки» профиля: данные аккаунта только для чтения. Выход — кнопка в шапке страницы профиля.
export default function SettingsSection({ me }) {
  return (
    <div style={{ maxWidth: 560 }}>
      <Descriptions
        title={s.account}
        column={1}
        bordered
        size="small"
        items={[
          { key: 'name', label: s.fullName, children: me.full_name },
          { key: 'email', label: s.email, children: me.email },
          { key: 'level', label: s.level, children: strings.levels[me.access_level] },
          { key: 'deps', label: s.departments, children: me.departments.map((d) => d.name).join(', ') || strings.dash },
        ]}
      />
      <p style={{ color: 'var(--muted)', marginTop: 16 }}>{s.passwordHint}</p>
    </div>
  )
}
