import { Input, Radio, Switch } from 'antd'
import { NEWS_COLORS } from '../lib/news.js'
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

// Общие поля записи для боковой панели редактора и окна предложения автора.
// value — состояние формы (initialOf из lib/news.js), onChange(patch) — частичное обновление;
// withPinned — поле «Закрепить» (только у редактора); isNew — выбор типа (только при создании).
export default function NewsForm({ value, onChange, withPinned, isNew }) {
  const isEvent = value.kind === 'event'
  return (
    <>
      {isNew && (
        <Field label={s.kind}>
          <Radio.Group value={value.kind} onChange={(e) => onChange({ kind: e.target.value })} options={Object.entries(kinds).map(([k, label]) => ({ value: k, label }))} />
        </Field>
      )}
      <Field label={s.fieldTitle}>
        <Input value={value.title} maxLength={200} onChange={(e) => onChange({ title: e.target.value })} />
      </Field>
      {isEvent && (
        <>
          <Field label={s.fieldStarts}>
            <Input type="datetime-local" value={value.startsAt} onChange={(e) => onChange({ startsAt: e.target.value })} />
          </Field>
          <Field label={s.fieldEnds} hint={s.fieldEndsHint}>
            <Input type="datetime-local" value={value.endsAt} onChange={(e) => onChange({ endsAt: e.target.value })} />
          </Field>
          <Field label={s.fieldPlace}>
            <Input value={value.place} maxLength={200} onChange={(e) => onChange({ place: e.target.value })} />
          </Field>
        </>
      )}
      <Field label={s.fieldBody}>
        <Input.TextArea value={value.body} maxLength={5000} showCount autoSize={{ minRows: 5, maxRows: 16 }} placeholder={s.bodyPlaceholder} onChange={(e) => onChange({ body: e.target.value })} />
      </Field>
      <ColorPicker value={value.color} onChange={(color) => onChange({ color })} />
      {withPinned && (
        <div className="news-field inline">
          <Switch checked={value.pinned} onChange={(pinned) => onChange({ pinned })} aria-label={s.fieldPinned} />
          <span>{s.fieldPinned}</span>
        </div>
      )}
      {isEvent && (
        <>
          <div className="news-field inline">
            <Switch checked={value.rsvpEnabled} onChange={(rsvpEnabled) => onChange({ rsvpEnabled })} aria-label={s.fieldRsvp} />
            <span>{s.fieldRsvp}</span>
          </div>
          <Field label={s.fieldDeadline}>
            <Input type="datetime-local" value={value.rsvpDeadline} onChange={(e) => onChange({ rsvpDeadline: e.target.value })} />
          </Field>
          <div className="news-field">
            <div className="news-field inline">
              <Switch checked={value.rsvpNamesPublic} onChange={(rsvpNamesPublic) => onChange({ rsvpNamesPublic })} aria-label={s.fieldNamesPublic} />
              <span>{s.fieldNamesPublic}</span>
            </div>
            <span className="news-field-hint">{withPinned ? s.fieldNamesPublicHint : s.fieldNamesPublicHintAuthor}</span>
          </div>
        </>
      )}
    </>
  )
}
