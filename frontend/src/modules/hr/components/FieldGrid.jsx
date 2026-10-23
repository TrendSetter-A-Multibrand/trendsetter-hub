import { useState } from 'react'
import { Input, InputNumber, Select, Typography } from 'antd'
import { formatDate } from '../../../core/dates.js'
import strings from '../strings.js'
import { parseRuDate } from '../lib/dossier.js'

// Поле даты ДД.ММ.ГГГГ. value — ISO или null; пока текст не разобран, наружу уходит сырой текст (buildPatch отметит его как invalid).
function DateInput({ value, onChange }) {
  const [text, setText] = useState(value ? formatDate(value) : '')
  const invalid = text.trim() !== '' && parseRuDate(text) === null
  return (
    <Input
      value={text}
      maxLength={10}
      placeholder={strings.person.datePlaceholder}
      status={invalid ? 'error' : undefined}
      onChange={(e) => {
        const next = e.target.value
        setText(next)
        onChange(next.trim() === '' ? null : (parseRuDate(next) ?? next))
      }}
    />
  )
}

function Control({ field, value, onChange }) {
  if (field.kind === 'textarea') return <Input.TextArea rows={3} value={value} onChange={(e) => onChange(e.target.value)} />
  if (field.kind === 'date') return <DateInput value={value} onChange={onChange} />
  if (field.kind === 'select') {
    return <Select allowClear style={{ width: '100%' }} value={value} onChange={(v) => onChange(v ?? null)} options={field.options} />
  }
  if (field.kind === 'number') {
    return (
      <InputNumber
        style={{ width: '100%' }}
        min={field.min}
        max={field.max}
        precision={field.precision}
        value={value}
        onChange={(v) => onChange(v ?? null)}
      />
    )
  }
  return <Input value={value} onChange={(e) => onChange(e.target.value)} />
}

// Сетка полей формы: fields — FILE_FIELDS/MONEY_FIELDS, draft — buildDraft, onChange(key, value)
export default function FieldGrid({ fields, draft, onChange }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 12 }}>
      {fields.map((f) => (
        <div key={f.key} style={{ gridColumn: f.wide ? '1 / -1' : undefined, marginBottom: 14 }}>
          <div style={{ marginBottom: 4 }}>
            <Typography.Text strong>{f.label}</Typography.Text>
          </div>
          <Control field={f} value={draft[f.key]} onChange={(v) => onChange(f.key, v)} />
          {f.hint && <Typography.Text type="secondary">{f.hint}</Typography.Text>}
        </div>
      ))}
    </div>
  )
}
