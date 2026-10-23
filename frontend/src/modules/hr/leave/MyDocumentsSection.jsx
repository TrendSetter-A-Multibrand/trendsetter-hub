import { useState } from 'react'
import { Alert, App, Button, Table, Tag } from 'antd'
import { api } from '../../../core/api/index.js'
import { formatDate } from '../../../core/dates.js'
import { downloadBase64, formatBytes } from '../../../core/lib/files.js'
import strings from '../strings.js'

const s = strings.myDocs
const t = strings.documents

// Раздел «Мои документы» страницы профиля: только документы, которые HR отметил видимыми сотруднику.
// data — { docs: GET /modules/hr/me/documents, hasCard }; раздел скрыт, если у сотрудника нет карточки.
export default function MyDocumentsSection({ data }) {
  const { message } = App.useApp()
  const [busyId, setBusyId] = useState(null)

  const download = async (doc) => {
    setBusyId(doc.id)
    try {
      downloadBase64(await api.get(`/modules/hr/me/documents/${doc.id}`))
    } catch (e) {
      message.error(e.message || t.downloadFailed)
    }
    setBusyId(null)
  }

  const columns = [
    { title: t.category, dataIndex: 'category', render: (c) => <Tag>{t.categories[c] ?? c}</Tag> },
    { title: t.docTitle, dataIndex: 'title' },
    { title: t.file, dataIndex: 'fileName', ellipsis: true, width: 180 },
    { title: t.size, dataIndex: 'sizeBytes', render: formatBytes },
    { title: t.date, dataIndex: 'uploadedAt', render: (v) => formatDate(v.slice(0, 10)) },
    {
      title: '',
      key: 'actions',
      render: (_, doc) => (
        <Button size="small" loading={busyId === doc.id} onClick={() => download(doc)}>
          {t.download}
        </Button>
      ),
    },
  ]

  return (
    <div style={{ maxWidth: 900 }}>
      <Alert type="info" showIcon title={s.note} style={{ marginBottom: 16 }} />
      <Table size="small" rowKey="id" dataSource={data.docs} columns={columns} pagination={false} scroll={{ x: 'max-content' }} locale={{ emptyText: s.empty }} />
    </div>
  )
}
