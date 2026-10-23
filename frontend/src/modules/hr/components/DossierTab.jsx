import { useState } from 'react'
import { Alert, App, Button, Space, Switch, Typography } from 'antd'
import { api } from '../../../core/api/index.js'
import strings from '../strings.js'
import { FILE_FIELDS, buildDraft, buildPatch, withBirthdayHidden } from '../lib/dossier.js'
import FieldGrid from './FieldGrid.jsx'

// Базовое досье HrFile. file — из GET people/:id/file; после сохранения reload() перечитывает данные модалки.
export default function DossierTab({ person, file, reload }) {
  const { message } = App.useApp()
  const [draft, setDraft] = useState(() => buildDraft(FILE_FIELDS, file))
  const [hidden, setHidden] = useState(Boolean(file.birthdayHidden))
  const [saving, setSaving] = useState(false)

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
      <FieldGrid fields={FILE_FIELDS} draft={draft} onChange={(key, v) => setDraft((cur) => ({ ...cur, [key]: v }))} />
      <Space align="start" style={{ marginBottom: 14 }}>
        <Switch checked={hidden} onChange={setHidden} aria-label={strings.dossier.birthdayHidden} />
        <div>
          <div>{strings.dossier.birthdayHidden}</div>
          <Typography.Text type="secondary">{strings.dossier.birthdayHiddenHint}</Typography.Text>
        </div>
      </Space>
      <div>
        <Button type="primary" loading={saving} onClick={save}>
          {strings.person.save}
        </Button>
      </div>
    </>
  )
}
