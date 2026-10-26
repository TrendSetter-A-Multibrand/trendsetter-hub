import { useState } from 'react'
import { Alert, App, Button, Drawer, Input, Radio, Space, Switch } from 'antd'
import { api } from '../../../core/api/index.js'
import { NEWS_COLORS, fromLocalInput, toLocalInput } from '../lib/news.js'
import strings from '../strings.js'
import '../news.css'

const s = strings.editor
const kinds = strings.admin.kinds

function Field({ label, hint, children }) {
  return (
    <label className="news-field">
      <span className="news-field-label">{label}</span>
      {children}
      {hint && <span className="news-field-hint">{hint}</span>}
    </label>
  )
}

const initialOf = (item) => ({
  kind: item?.kind ?? 'news',
  title: item?.title ?? '',
  startsAt: toLocalInput(item?.startsAt),
  endsAt: toLocalInput(item?.endsAt),
  place: item?.place ?? '',
  body: item?.body ?? '',
  pinned: item?.pinned ?? false,
  color: item?.color ?? null,
  rsvpEnabled: item?.rsvpEnabled ?? false,
  rsvpDeadline: toLocalInput(item?.rsvpDeadline),
  rsvpNamesPublic: item?.rsvpNamesPublic ?? false,
})

// Клиентская проверка зеркалит серверную; возвращает текст первой ошибки или null
function validate(f) {
  if (!f.title.trim()) return s.errors.title
  if (f.kind === 'news') return null
  const starts = fromLocalInput(f.startsAt)
  if (starts === null) return s.errors.starts
  const ends = fromLocalInput(f.endsAt)
  if (ends !== null && ends < starts) return s.errors.endsBeforeStart
  const deadline = fromLocalInput(f.rsvpDeadline)
  if (deadline !== null && deadline > starts) return s.errors.deadlineAfterStart
  return null
}

function payloadOf(f) {
  const common = { title: f.title.trim(), body: f.body, pinned: f.pinned, color: f.color }
  if (f.kind === 'news') return common
  return {
    ...common,
    place: f.place.trim() || null,
    startsAt: fromLocalInput(f.startsAt),
    endsAt: fromLocalInput(f.endsAt),
    rsvpEnabled: f.rsvpEnabled,
    rsvpDeadline: fromLocalInput(f.rsvpDeadline),
    rsvpNamesPublic: f.rsvpNamesPublic,
  }
}

// Выбор цвета записи: ряд кружков (первый — «без цвета», null). Радиогруппа с aria-label у каждого кружка.
function ColorPicker({ value, onChange }) {
  const options = [{ key: null, label: s.colorNone }, ...NEWS_COLORS.map((key) => ({ key, label: s.colors[key] }))]
  return (
    <div className="news-field">
      <span className="news-field-label" id="news-color-label">
        {s.fieldColor}
      </span>
      <div className="news-swatches" role="radiogroup" aria-labelledby="news-color-label">
        {options.map(({ key, label }) => (
          <button
            key={key ?? 'none'}
            type="button"
            role="radio"
            aria-checked={value === key}
            aria-label={label}
            title={label}
            className={`news-swatch ${key ?? 'none'}`}
            onClick={() => onChange(key)}
          />
        ))}
      </div>
    </div>
  )
}

// Создание и правка записи. item — null для новой. onSaved() вызывается после успешного сохранения.
export default function NewsEditorDrawer({ item, onClose, onSaved }) {
  const { message } = App.useApp()
  const [form, setForm] = useState(() => initialOf(item))
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const isEvent = form.kind === 'event'
  const published = item?.status === 'published'

  const save = async (publish) => {
    const problem = validate(form)
    setError(problem)
    if (problem) return
    setBusy(true)
    try {
      const body = payloadOf(form)
      if (item) await api.patch(`/modules/news/items/${item.id}`, publish ? { ...body, status: 'published' } : body)
      else await api.post('/modules/news/items', { ...body, kind: form.kind, status: publish ? 'published' : 'draft' })
      message.success(s.saved)
      onSaved()
    } catch (e) {
      message.error(e.message)
      setBusy(false)
    }
  }

  return (
    <Drawer
      open
      size={560}
      title={item ? s.titleEdit : s.titleCreate}
      onClose={onClose}
      footer={
        <Space>
          {published ? (
            <Button type="primary" loading={busy} onClick={() => save(false)}>
              {s.save}
            </Button>
          ) : (
            <>
              <Button type="primary" loading={busy} onClick={() => save(true)}>
                {s.publish}
              </Button>
              <Button loading={busy} onClick={() => save(false)}>
                {s.saveDraft}
              </Button>
            </>
          )}
          <Button onClick={onClose}>{s.cancel}</Button>
        </Space>
      }
    >
      {error && <Alert className="news-error" type="error" showIcon title={error} />}
      {!item && (
        <Field label={s.kind}>
          <Radio.Group value={form.kind} onChange={(e) => set({ kind: e.target.value })} options={Object.entries(kinds).map(([value, label]) => ({ value, label }))} />
        </Field>
      )}
      <Field label={s.fieldTitle}>
        <Input value={form.title} maxLength={200} onChange={(e) => set({ title: e.target.value })} />
      </Field>
      {isEvent && (
        <>
          <Field label={s.fieldStarts}>
            <Input type="datetime-local" value={form.startsAt} onChange={(e) => set({ startsAt: e.target.value })} />
          </Field>
          <Field label={s.fieldEnds} hint={s.fieldEndsHint}>
            <Input type="datetime-local" value={form.endsAt} onChange={(e) => set({ endsAt: e.target.value })} />
          </Field>
          <Field label={s.fieldPlace}>
            <Input value={form.place} maxLength={200} onChange={(e) => set({ place: e.target.value })} />
          </Field>
        </>
      )}
      <Field label={s.fieldBody}>
        <Input.TextArea value={form.body} maxLength={5000} showCount autoSize={{ minRows: 5, maxRows: 16 }} placeholder={s.bodyPlaceholder} onChange={(e) => set({ body: e.target.value })} />
      </Field>
      <ColorPicker value={form.color} onChange={(color) => set({ color })} />
      <div className="news-field inline">
        <Switch checked={form.pinned} onChange={(pinned) => set({ pinned })} aria-label={s.fieldPinned} />
        <span>{s.fieldPinned}</span>
      </div>
      {isEvent && (
        <>
          <div className="news-field inline">
            <Switch checked={form.rsvpEnabled} onChange={(rsvpEnabled) => set({ rsvpEnabled })} aria-label={s.fieldRsvp} />
            <span>{s.fieldRsvp}</span>
          </div>
          <Field label={s.fieldDeadline}>
            <Input type="datetime-local" value={form.rsvpDeadline} onChange={(e) => set({ rsvpDeadline: e.target.value })} />
          </Field>
          <div className="news-field">
            <div className="news-field inline">
              <Switch checked={form.rsvpNamesPublic} onChange={(rsvpNamesPublic) => set({ rsvpNamesPublic })} aria-label={s.fieldNamesPublic} />
              <span>{s.fieldNamesPublic}</span>
            </div>
            <span className="news-field-hint">{s.fieldNamesPublicHint}</span>
          </div>
        </>
      )}
    </Drawer>
  )
}
