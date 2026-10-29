import { useState } from 'react'
import { App, Button, DatePicker, Form, Input, Modal, Popconfirm, Segmented, Select } from 'antd'
import dayjs from 'dayjs'
import { api } from '../../../core/api/index.js'
import coreStrings from '../../../core/strings.js'
import { addDays, countDays } from '../../../core/dates.js'
import { COUNTRIES, KINDS, validateRange } from '../lib/holidays.js'
import strings from '../strings.js'
import '../holidays.css'

const s = strings.admin
const DATE_FORMAT = 'YYYY-MM-DD'
const NAME_LIMIT = 100

// Форма редактора: отметить день или диапазон (≤ 31 дня). initial = { country, start, end, kind, name } (start/end могут быть пустыми);
// rowsByCountry — indexDays() текущего года: по нему решается, показывать ли «Сбросить дни». onDone() — перечитать данные.
export default function DaysModal({ initial, rowsByCountry, onClose, onDone }) {
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const country = Form.useWatch('country', form) ?? initial.country
  const range = Form.useWatch('range', form)

  const bounds = () => (range?.[0] && range?.[1] ? { start: range[0].format(DATE_FORMAT), end: range[1].format(DATE_FORMAT) } : null)
  const picked = bounds()
  const hasRows =
    picked !== null && picked.end >= picked.start && countDays(picked.start, picked.end) <= 400 &&
    Array.from({ length: countDays(picked.start, picked.end) }, (_, i) => addDays(picked.start, i)).some((iso) => rowsByCountry[country].has(iso))

  const send = async (path, body, done) => {
    setSaving(true)
    try {
      await api.post(path, body)
      message.success(done)
      onDone()
      onClose()
    } catch (e) {
      message.error(e.message)
      setSaving(false)
    }
  }

  const submit = (values) => {
    const { start, end } = { start: values.range?.[0]?.format(DATE_FORMAT), end: values.range?.[1]?.format(DATE_FORMAT) }
    const name = (values.name ?? '').trim() || null
    const problem = validateRange({ start, end, kind: values.kind, name })
    if (problem) {
      message.error(problem)
      return
    }
    send('/modules/holidays/days', { country: values.country, start, end, kind: values.kind, name }, s.saved)
  }

  const reset = () => {
    const current = bounds()
    const problem = validateRange({ ...(current ?? {}), kind: 'day_off' })
    if (problem) {
      message.error(problem)
      return
    }
    send('/modules/holidays/days/delete', { country, ...current }, s.removed)
  }

  return (
    <Modal
      open
      centered
      title={s.modalTitle}
      onCancel={onClose}
      footer={
        <>
          {hasRows && (
            <Popconfirm title={s.resetConfirm} okText={s.confirmYes} cancelText={s.confirmNo} onConfirm={reset}>
              <Button danger disabled={saving}>
                {s.reset}
              </Button>
            </Popconfirm>
          )}
          <Button onClick={onClose}>{coreStrings.cancel}</Button>
          <Button type="primary" loading={saving} onClick={() => form.submit()}>
            {coreStrings.save}
          </Button>
        </>
      }
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={submit}
        initialValues={{
          country: initial.country,
          range: initial.start && initial.end ? [dayjs(initial.start), dayjs(initial.end)] : undefined,
          kind: initial.kind ?? 'holiday',
          name: initial.name ?? '',
        }}
      >
        <Form.Item name="country" label={s.country}>
          <Segmented options={COUNTRIES.map((c) => ({ value: c.id, label: strings.countries[c.id] }))} />
        </Form.Item>
        <Form.Item name="range" label={s.period} extra={s.periodHint}>
          <DatePicker.RangePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
        </Form.Item>
        <Form.Item name="kind" label={s.kind}>
          <Select options={KINDS.map((value) => ({ value, label: strings.kinds[value] }))} />
        </Form.Item>
        <Form.Item name="name" label={s.name} extra={s.nameHint}>
          <Input maxLength={NAME_LIMIT} placeholder={s.namePlaceholder} />
        </Form.Item>
        <div className="hc-rules">{s.rules}</div>
      </Form>
    </Modal>
  )
}
