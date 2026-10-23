import { AutoComplete, Button, Input, Select, Space, Typography } from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import strings from '../strings.js'
import PhotoInput from './PhotoInput.jsx'

const s = strings.form
const MAX_LINKS = 5

function LinksInput({ value, onChange }) {
  const list = value ?? []
  const set = (i, patch) => onChange(list.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  return (
    <div>
      {list.map((l, i) => (
        <Space.Compact key={i} style={{ display: 'flex', marginBottom: 6 }}>
          <Input style={{ width: '35%' }} placeholder={s.linkLabel} value={l.label} onChange={(e) => set(i, { label: e.target.value })} />
          <Input placeholder={s.linkUrl} value={l.url} onChange={(e) => set(i, { url: e.target.value })} />
          <Button icon={<DeleteOutlined />} onClick={() => onChange(list.filter((_, j) => j !== i))} />
        </Space.Compact>
      ))}
      {list.length < MAX_LINKS && (
        <Button size="small" icon={<PlusOutlined />} onClick={() => onChange([...list, { label: '', url: '' }])}>
          {s.addLink}
        </Button>
      )}
    </div>
  )
}

function FieldInput({ field, value, onChange, invalid }) {
  const status = invalid ? 'error' : undefined
  switch (field.kind) {
    case 'textarea':
      return <Input.TextArea rows={3} status={status} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
    case 'select':
      // свой вариант разрешён для всех select (ТЗ, раздел «Данные»)
      return (
        <AutoComplete
          style={{ width: '100%' }}
          status={status}
          placeholder={s.selectPlaceholder}
          value={value ?? ''}
          options={field.options.map((o) => ({ value: o }))}
          onChange={onChange}
        />
      )
    case 'chips':
      return (
        <Select mode="tags" status={status} style={{ width: '100%' }} tokenSeparators={[',']} placeholder={s.chipsPlaceholder} value={value ?? []} onChange={onChange} open={false} />
      )
    case 'links':
      return <LinksInput value={value} onChange={onChange} />
    default:
      return <Input status={status} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
  }
}

// Динамическая форма анкеты по списку полей (GET /fields или /hr/fields). Управляемая: значения хранит родитель.
// fields — Field[]; values — { key: value }; onChange(key, value); photo — { full, thumb } | null (новое фото);
// currentPhoto — data-URL уже сохранённого фото; skip — ключи полей, которые не показывать (напр. manager_claim);
// errors — { key: сообщение } от validateProfile; markRequired — отмечать обязательные поля звёздочкой (сотрудник; у HR нет).
export default function ProfileForm({ fields, values, onChange, photo, onPhoto, currentPhoto, skip = [], errors = {}, markRequired = false }) {
  const visible = fields.filter((f) => f.active && !skip.includes(f.key))
  return (
    <div>
      {visible.map((f) => (
        <div key={f.key} style={{ marginBottom: 14 }}>
          <div style={{ marginBottom: 4 }}>
            <Typography.Text strong>{f.label}</Typography.Text>
            {markRequired && (f.required || f.kind === 'photo') && (
              <Typography.Text type="danger" title={s.requiredMark} style={{ marginLeft: 4 }}>
                *
              </Typography.Text>
            )}
            {f.hint && (
              <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
                {f.hint}
              </Typography.Text>
            )}
          </div>
          {f.kind === 'photo' ? (
            <PhotoInput value={photo} current={currentPhoto} onChange={onPhoto} />
          ) : (
            <FieldInput field={f} value={values[f.key]} onChange={(v) => onChange(f.key, v)} invalid={Boolean(errors[f.key])} />
          )}
          {errors[f.key] && (
            <div>
              <Typography.Text type="danger">{errors[f.key]}</Typography.Text>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
