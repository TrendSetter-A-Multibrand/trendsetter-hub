import { Checkbox, Select, Space, Typography } from 'antd'
import strings from '../strings.js'

const s = strings.autoChecklist

// Опция автозапуска чек-листа. auto — результат useAutoChecklist(kind); при ошибке загрузки шаблонов опция скрыта.
export default function AutoChecklistOption({ auto }) {
  if (auto.status === 'hidden' || auto.status === 'loading') return null
  if (auto.status === 'none') {
    return (
      <div style={{ marginBottom: 14 }}>
        <Typography.Text type="secondary">{s.none[auto.kind]}</Typography.Text>
      </div>
    )
  }
  return (
    <div style={{ marginBottom: 14, padding: 12, border: '1px solid #e5e5e5', borderRadius: 0 }}>
      <Checkbox checked={auto.enabled} onChange={(e) => auto.setEnabled(e.target.checked)}>
        {s.label[auto.kind](auto.template.title)}
      </Checkbox>
      {auto.templates.length > 1 && (
        <Space style={{ display: 'flex', marginTop: 8 }}>
          <Typography.Text type="secondary">{s.template}</Typography.Text>
          <Select
            style={{ minWidth: 280 }}
            disabled={!auto.enabled}
            value={auto.templateId}
            onChange={auto.setTemplateId}
            options={auto.templates.map((t) => ({ value: t.id, label: t.title }))}
          />
        </Space>
      )}
      {auto.enabled && (
        <div style={{ marginTop: 6 }}>
          <Typography.Text type="secondary">{s.hint(auto.template.items.length)}</Typography.Text>
        </div>
      )}
    </div>
  )
}
