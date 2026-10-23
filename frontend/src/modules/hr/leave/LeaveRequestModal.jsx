import { useState } from 'react'
import { Alert, App, DatePicker, Form, Input, Modal, Select } from 'antd'
import { countDays, formatDate, todayIso } from '../../../core/dates.js'
import coreStrings from '../../../core/strings.js'
import strings from '../strings.js'

const s = strings.leave.request
const DATE_FORMAT = 'YYYY-MM-DD'
const MESSAGE_LIMIT = 500

// Модалка «Выбрать отпуск». onSubmit({ kind, start, end, message }) — запрос делает родитель (сотрудник: POST /me/leave/requests,
// HR: заявка за сотрудника); при ошибке бросает, текст показывается здесь. balance/policy/approver — из GET /me/leave.
// allowPast — разрешить прошедшие даты (HR оформляет задним числом); texts — переопределение title/send/sent/messageHint.
// fixedRange { start, end } — даты заданы извне (заявка из планового периода): выбор дат скрыт, onSubmit получает эти даты.
export default function LeaveRequestModal({ balance, approver, onSubmit, onClose, allowPast = false, texts, fixedRange }) {
  const t = { ...s, ...texts }
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const range = Form.useWatch('range', form)
  const kind = Form.useWatch('kind', form)

  // Нельзя выбрать прошедшие даты и (для ежегодного) даты до возникновения права на отпуск
  const minDate = allowPast ? '' : kind === 'annual' && balance?.availableFrom && balance.availableFrom > todayIso() ? balance.availableFrom : todayIso()
  const days = fixedRange
    ? countDays(fixedRange.start, fixedRange.end)
    : range?.[0] && range?.[1]
      ? countDays(range[0].format(DATE_FORMAT), range[1].format(DATE_FORMAT))
      : null
  const left = days !== null && kind === 'annual' && balance ? Math.round((balance.available - days) * 100) / 100 : null

  const submit = async (values) => {
    setSaving(true)
    try {
      await onSubmit({
        kind: values.kind,
        start: fixedRange ? fixedRange.start : values.range[0].format(DATE_FORMAT),
        end: fixedRange ? fixedRange.end : values.range[1].format(DATE_FORMAT),
        message: (values.message ?? '').trim(),
      })
      message.success(t.sent)
      onClose()
    } catch (e) {
      message.error(e.message)
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      title={t.title}
      okText={t.send}
      cancelText={coreStrings.cancel}
      confirmLoading={saving}
      onCancel={onClose}
      onOk={() => form.submit()}
    >
      <Form form={form} layout="vertical" onFinish={submit} initialValues={{ kind: 'annual', message: '' }}>
        <Form.Item name="kind" label={s.kind}>
          <Select options={Object.entries(strings.leave.kinds).map(([value, label]) => ({ value, label }))} />
        </Form.Item>
        {fixedRange ? (
          <Form.Item label={s.period} extra={[t.fixedPeriod, days !== null ? s.daysPreview(days, left) : null].filter(Boolean).join('. ')}>
            <Input readOnly value={`${formatDate(fixedRange.start)} — ${formatDate(fixedRange.end)}`} />
          </Form.Item>
        ) : (
          <Form.Item
            name="range"
            label={s.period}
            rules={[{ required: true, message: s.periodRequired }]}
            extra={days !== null ? s.daysPreview(days, left) : undefined}
          >
            <DatePicker.RangePicker
              style={{ width: '100%' }}
              format="DD.MM.YYYY"
              disabledDate={(current) => Boolean(current) && current.format(DATE_FORMAT) < minDate}
            />
          </Form.Item>
        )}
        <Form.Item
          name="message"
          label={s.message}
          extra={t.messageHint}
          rules={[{ max: MESSAGE_LIMIT, message: strings.errors.messageTooLong }]}
        >
          <Input.TextArea rows={4} placeholder={s.messagePlaceholder} />
        </Form.Item>
        {approver !== undefined && <Alert type="info" showIcon title={approver ? s.approver(approver.name) : s.approverHr} />}
      </Form>
    </Modal>
  )
}
