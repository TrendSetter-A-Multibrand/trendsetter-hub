import { useState } from 'react'
import { App, Button, Form, Input, Modal, Table } from 'antd'
import { api } from '../api/index.js'
import strings from '../strings.js'
import { validateDepartmentCode, validateDepartmentName } from './validation.js'

const s = strings.admin.departments

function DepartmentModal({ department, departments, onClose, onSaved }) {
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const isEdit = Boolean(department)

  const submit = async (values) => {
    const nameError = validateDepartmentName(values.name, departments, department?.id)
    const codeError = isEdit ? null : validateDepartmentCode(values.code, departments)
    if (nameError || codeError) {
      form.setFields([
        { name: 'name', errors: nameError ? [nameError] : [] },
        { name: 'code', errors: codeError ? [codeError] : [] },
      ])
      return
    }
    setSaving(true)
    try {
      if (isEdit) {
        await api.patch(`/admin/departments/${department.id}`, { name: values.name })
        message.success(s.renamed)
      } else {
        await api.post('/admin/departments', { name: values.name, code: values.code })
        message.success(s.created)
      }
      await onSaved()
    } catch (e) {
      message.error(e.message)
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      title={isEdit ? s.renameTitle : s.addTitle}
      okText={strings.save}
      cancelText={strings.cancel}
      confirmLoading={saving}
      onCancel={onClose}
      onOk={() => form.submit()}
    >
      <Form form={form} layout="vertical" onFinish={submit} initialValues={department ?? {}}>
        <Form.Item name="name" label={s.name}>
          <Input />
        </Form.Item>
        <Form.Item name="code" label={s.codeLabel}>
          <Input disabled={isEdit} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default function DepartmentsTab({ departments, reload }) {
  const [modal, setModal] = useState(null) // { department? }

  const columns = [
    { title: s.code, dataIndex: 'code' },
    { title: s.name, dataIndex: 'name' },
    { title: s.userCount, dataIndex: 'user_count', align: 'right' },
    {
      title: strings.admin.users.actions,
      render: (_, department) => (
        <Button size="small" onClick={() => setModal({ department })}>
          {s.rename}
        </Button>
      ),
    },
  ]

  return (
    <>
      <Button type="primary" style={{ marginBottom: 16 }} onClick={() => setModal({})}>
        {s.add}
      </Button>
      <Table rowKey="id" columns={columns} dataSource={departments} pagination={false} />
      {modal && (
        <DepartmentModal
          department={modal.department}
          departments={departments}
          onClose={() => setModal(null)}
          onSaved={async () => {
            setModal(null)
            await reload()
          }}
        />
      )}
    </>
  )
}
