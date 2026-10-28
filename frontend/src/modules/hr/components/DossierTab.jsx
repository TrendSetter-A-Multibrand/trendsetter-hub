import { useState } from 'react'
import { Alert, App, Button, Space, Switch, Typography } from 'antd'
import { api } from '../../../core/api/index.js'
import strings from '../strings.js'
import { FILE_FIELDS, buildDraft, buildPatch, withBirthdayHidden } from '../lib/dossier.js'
import FieldGrid from './FieldGrid.jsx'

const DANGER = 'var(--red)'
const DISMISSAL_KEYS = ['dismissedAt', 'dismissalReason']
const mainFields = FILE_FIELDS.filter((f) => !DISMISSAL_KEYS.includes(f.key))
const dismissalFields = FILE_FIELDS.filter((f) => DISMISSAL_KEYS.includes(f.key))

// Базовое досье HrFile. file — из GET people/:id/file; после сохранения reload() перечитывает данные модалки.
export default function DossierTab({ person, file, reload }) {
  const { message } = App.useApp()
  const [draft, setDraft] = useState(() => buildDraft(FILE_FIELDS, file))
  const [hidden, setHidden] = useState(Boolean(file.birthdayHidden))
  const [saving, setSaving] = useState(false)

  const onChange = (key, v) => setDraft((cur) => ({ ...cur, [key]: v }))

  const save = async () => {
    const { patch: base, invalid } = buildPatch(FILE_FIELDS, draft, file)
    if (invalid.length > 0) return message.error(strings.person.dateInvalid)
    const patch = withBirthdayHidden(base, hidden, file)
    if (Object.keys(patch).length === 0) return message.info(strings.person.noChanges)
    setSaving(true)
    try {
      await api.patch(`/modules/hr/people/${person.id}/file`, patch)
      message.success(strings.dossier.saved)
      await reload()
    } catch (e) {
      message.error(e.message)
    }
    setSaving(false)
  }

  return (
    <>
      {person.isArchived && !draft.dismissedAt && <Alert type="warning" showIcon title={strings.dossier.archivedNoDate} style={{ marginBottom: 14 }} />}
      <FieldGrid fields={mainFields} draft={draft} onChange={onChange} />
      <Space align="start" style={{ marginBottom: 14 }}>
        <Switch checked={hidden} onChange={setHidden} aria-label={strings.dossier.birthdayHidden} />
        <div>
          <div>{strings.dossier.birthdayHidden}</div>
          <Typography.Text type="secondary">{strings.dossier.birthdayHiddenHint}</Typography.Text>
        </div>
      </Space>
      <section style={{ border: `1px solid ${DANGER}`, background: 'var(--red-tint)', borderRadius: 0, padding: '12px 14px 2px', margin: '8px 0 18px' }}>
        <Typography.Title level={5} style={{ margin: 0, color: DANGER }}>
          {strings.dossier.dismissalTitle}
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ margin: '2px 0 12px' }}>
          {strings.dossier.dismissalNote}
        </Typography.Paragraph>
        <FieldGrid fields={dismissalFields} draft={draft} onChange={onChange} />
      </section>
      <div>
        <Button type="primary" loading={saving} onClick={save}>
          {strings.person.save}
        </Button>
      </div>
    </>
  )
}
