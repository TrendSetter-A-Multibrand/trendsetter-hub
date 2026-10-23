import { useState } from 'react'
import { Alert, App, Button, Spin } from 'antd'
import { api } from '../../../core/api/index.js'
import strings from '../strings.js'
import { useLoad } from '../lib/useLoad.js'
import { MONEY_FIELDS, buildDraft, buildPatch } from '../lib/dossier.js'
import FieldGrid from './FieldGrid.jsx'
import DocumentsSection from './DocumentsSection.jsx'

function MoneyForm({ person, sensitive, reload }) {
  const { message } = App.useApp()
  const [draft, setDraft] = useState(() => buildDraft(MONEY_FIELDS, sensitive))
  const [saving, setSaving] = useState(false)

  const save = async () => {
    const { patch } = buildPatch(MONEY_FIELDS, draft, sensitive)
    if (Object.keys(patch).length === 0) return message.info(strings.person.noChanges)
    setSaving(true)
    try {
      await api.patch(`/modules/hr/people/${person.id}/sensitive`, patch)
      message.success(strings.money.saved)
      await reload()
    } catch (e) {
      message.error(e.message)
    }
    setSaving(false)
  }

  return (
    <>
      <Alert type="info" showIcon title={strings.money.note} style={{ marginBottom: 14 }} />
      <FieldGrid fields={MONEY_FIELDS} draft={draft} onChange={(key, v) => setDraft((cur) => ({ ...cur, [key]: v }))} />
      <Button type="primary" loading={saving} onClick={save}>
        {strings.person.save}
      </Button>
    </>
  )
}

// Деньги и документы (HrSensitive). Вкладка создаётся только при canSeeSensitive, запрос — при первом открытии вкладки.
export default function MoneyTab({ person }) {
  const { data, error, reload } = useLoad(`/modules/hr/people/${person.id}/sensitive`)
  if (error && !data) return <Alert type="error" showIcon title={strings.person.loadFailed} description={error} />
  if (!data) return <Spin />
  return (
    <>
      <MoneyForm person={person} sensitive={data} reload={reload} />
      <DocumentsSection person={person} />
    </>
  )
}
