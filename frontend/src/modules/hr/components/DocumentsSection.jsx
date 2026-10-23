import { useState } from 'react'
import { Alert, App, Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography, Upload } from 'antd'
import { api } from '../../../core/api/index.js'
import { formatDate } from '../../../core/dates.js'
import { checkFile, downloadBase64, formatBytes, readAsBase64 } from '../../../core/lib/files.js'
import strings from '../strings.js'
import { useLoad } from '../lib/useLoad.js'
import { DOC_CATEGORIES, DOC_EXTENSIONS, DOC_MAX_BYTES, DOC_MAX_COUNT, DOC_TITLE_LIMIT } from '../lib/documents.js'

const t = strings.documents
const extList = DOC_EXTENSIONS.join(', ')
const maxMb = DOC_MAX_BYTES / 1024 / 1024
const categoryOptions = DOC_CATEGORIES.map((value) => ({ value, label: t.categories[value] }))

function UploadModal({ personId, onClose, onDone }) {
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const [file, setFile] = useState(null)
  const [fileError, setFileError] = useState(null)
  const [saving, setSaving] = useState(false)

  const beforeUpload = (f) => {
    const problem = checkFile(f, { extensions: DOC_EXTENSIONS, maxBytes: DOC_MAX_BYTES })
    if (problem) {
      setFile(null)
      setFileError(problem === 'ext' ? t.badExt(extList) : problem === 'size' ? t.tooBig(maxMb) : t.emptyFile)
    } else {
      setFile(f)
      setFileError(null)
      if (!form.getFieldValue('title')) form.setFieldValue('title', f.name.replace(/\.[^.]+$/, '').slice(0, DOC_TITLE_LIMIT))
    }
    return false // не отправлять автоматически
  }

  const submit = async () => {
    const values = await form.validateFields().catch(() => null)
    if (!values) return
    if (!file) return setFileError(t.needFile)
    setSaving(true)
    try {
      const dataBase64 = await readAsBase64(file).catch(() => null)
      if (dataBase64 === null) throw new Error(t.readFailed)
      await api.post(`/modules/hr/people/${personId}/documents`, {
        category: values.category,
        title: values.title.trim(),
        fileName: file.name,
        dataBase64,
      })
      message.success(t.uploaded)
      onDone()
    } catch (e) {
      message.error(e.message)
      setSaving(false)
    }
  }

  return (
    <Modal open title={t.uploadTitle} okText={t.upload} cancelText={t.removeCancel} confirmLoading={saving} onOk={submit} onCancel={onClose} mask={{ closable: false }}>
      <Form form={form} layout="vertical">
        <Form.Item label={t.file} validateStatus={fileError ? 'error' : undefined} help={fileError ?? undefined} required>
          <Upload
            accept={DOC_EXTENSIONS.map((e) => `.${e}`).join(',')}
            maxCount={1}
            beforeUpload={beforeUpload}
            onRemove={() => setFile(null)}
            fileList={file ? [{ uid: '1', name: file.name, status: 'done' }] : []}
          >
            <Button>{t.pick}</Button>
          </Upload>
        </Form.Item>
        <Form.Item name="category" label={t.category} rules={[{ required: true, message: t.needCategory }]}>
          <Select options={categoryOptions} />
        </Form.Item>
        <Form.Item name="title" label={t.docTitle} rules={[{ required: true, whitespace: true, max: DOC_TITLE_LIMIT, message: t.needTitle }]}>
          <Input maxLength={DOC_TITLE_LIMIT} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

// Документы сотрудника. Раздел живёт внутри MoneyTab (только responsible).
export default function DocumentsSection({ person }) {
  const { message } = App.useApp()
  const { data, error, reload } = useLoad(`/modules/hr/people/${person.id}/documents`)
  const [uploading, setUploading] = useState(false)
  const [busyId, setBusyId] = useState(null)

  const download = async (doc) => {
    setBusyId(doc.id)
    try {
      downloadBase64(await api.get(`/modules/hr/documents/${doc.id}`))
    } catch (e) {
      message.error(e.message || t.downloadFailed)
    }
    setBusyId(null)
  }

  const remove = async (doc) => {
    setBusyId(doc.id)
    try {
      await api.post(`/modules/hr/documents/${doc.id}/delete`, {})
      message.success(t.removed)
      reload()
    } catch (e) {
      message.error(e.message)
    }
    setBusyId(null)
  }

  const full = Boolean(data) && data.length >= DOC_MAX_COUNT
  const columns = [
    { title: t.category, dataIndex: 'category', render: (c) => <Tag>{t.categories[c] ?? c}</Tag> },
    { title: t.docTitle, dataIndex: 'title' },
    { title: t.file, dataIndex: 'fileName', ellipsis: true, width: 150 },
    { title: t.size, dataIndex: 'sizeBytes', render: formatBytes },
    { title: t.date, dataIndex: 'uploadedAt', render: (v) => formatDate(v.slice(0, 10)) },
    { title: t.by, dataIndex: 'uploadedBy', render: (v) => v ?? '—' },
    {
      title: '',
      key: 'actions',
      fixed: 'right',
      render: (_, doc) => (
        <Space size="small">
          <Button size="small" loading={busyId === doc.id} onClick={() => download(doc)}>
            {t.download}
          </Button>
          <Popconfirm title={t.removeConfirm} okText={t.removeOk} cancelText={t.removeCancel} onConfirm={() => remove(doc)}>
            <Button size="small" danger disabled={busyId === doc.id}>
              {t.remove}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <section style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 12 }}>
        <Typography.Title level={5} style={{ margin: 0 }}>
          {t.title}
        </Typography.Title>
        <Button type="primary" disabled={!data || full} title={full ? t.limitReached(DOC_MAX_COUNT) : undefined} onClick={() => setUploading(true)}>
          {t.upload}
        </Button>
      </div>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        {t.hint(maxMb, DOC_MAX_COUNT, extList)}
      </Typography.Paragraph>
      {error && !data ? (
        <Alert type="error" showIcon title={t.loadFailed} description={error} />
      ) : (
        <Table
          size="small"
          rowKey="id"
          loading={!data}
          dataSource={data ?? []}
          columns={columns}
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: t.empty }}
        />
      )}
      {uploading && (
        <UploadModal
          personId={person.id}
          onClose={() => setUploading(false)}
          onDone={() => {
            setUploading(false)
            reload()
          }}
        />
      )}
    </section>
  )
}
