import { useState } from 'react'
import { App, Divider, Input, Modal, Select, Switch, Typography } from 'antd'
import { api } from '../../../core/api/index.js'
import coreStrings from '../../../core/strings.js'
import strings from '../strings.js'
import { splitValues, valuesOfPerson } from '../lib/values.js'
import { directionOptions, managerOptions, splitFullName } from '../lib/options.js'
import ProfileForm from '../../team/components/ProfileForm.jsx'

const s = strings.people
// manager_claim — подсказка для HR, в форме HR не показывается
const HR_SKIP = ['manager_claim']

function Labeled({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ marginBottom: 4 }}>
        <Typography.Text strong>{label}</Typography.Text>
      </div>
      {children}
    </div>
  )
}

// Создание/правка карточки HR. person — null для создания; fromUser — режим «Добавить в карту из пользователя» (пользователь обязателен).
export default function PersonModal({ person, fromUser, fields, people, directions, users, onClose, onSaved }) {
  const { message } = App.useApp()
  const isEdit = Boolean(person)
  const activeFields = fields.filter((f) => f.active)
  const [values, setValues] = useState(() => (person ? valuesOfPerson(activeFields, person) : valuesOfPerson(activeFields, {})))
  const [directionId, setDirectionId] = useState(person?.directionId ?? null)
  const [managerId, setManagerId] = useState(person?.managerId ?? null)
  const [tag, setTag] = useState(person?.tag ?? '')
  const [team, setTeam] = useState(person?.team ?? '')
  const [showInMap, setShowInMap] = useState(person?.showInMap ?? true)
  const [userId, setUserId] = useState(null)
  const [photo, setPhoto] = useState(null)
  const [saving, setSaving] = useState(false)

  const freeUsers = users.filter((u) => u.personId === null)
  const setValue = (key, v) => setValues((cur) => ({ ...cur, [key]: v }))

  // выбор пользователя подставляет имя и почту, если они ещё не заполнены
  const pickUser = (id) => {
    setUserId(id ?? null)
    const u = users.find((x) => x.id === id)
    if (!u) return
    const { lastName, firstName } = splitFullName(u.fullName)
    setValues((cur) => ({
      ...cur,
      last_name: cur.last_name || lastName,
      first_name: cur.first_name || firstName,
      email: cur.email || u.email,
    }))
  }

  const submit = async () => {
    const body = splitValues(activeFields, values)
    if (!body.firstName || !body.lastName || !body.title) return message.error(s.nameRequired)
    if (fromUser && !userId) return message.error(s.userRequired)
    if (!directionId) return message.error(s.directionRequired)
    if (managerId === null && !person?.isCeo) return message.error(s.managerRequired)
    const payload = { ...body, directionId, managerId, tag: tag.trim() || null, team: team.trim() || null, showInMap }
    if (photo) payload.photo = photo
    setSaving(true)
    try {
      if (isEdit) {
        await api.patch(`/modules/team/hr/people/${person.id}`, payload)
        message.success(s.updated)
      } else {
        if (userId) payload.userId = userId
        await api.post('/modules/team/hr/people', payload)
        message.success(s.created)
      }
      await onSaved()
    } catch (e) {
      message.error(e.message)
      setSaving(false)
    }
  }

  const title = isEdit ? s.editTitle(person.name) : fromUser ? s.addFromUserTitle : s.addTitle
  return (
    <Modal
      open
      width={640}
      title={title}
      okText={coreStrings.save}
      cancelText={coreStrings.cancel}
      confirmLoading={saving}
      onCancel={onClose}
      onOk={submit}
      styles={{ body: { maxHeight: '70vh', overflowY: 'auto', paddingRight: 8 } }}
    >
      {!isEdit && (
        <Labeled label={fromUser ? s.user : s.userOptional}>
          <Select
            showSearch optionFilterProp="label"
            allowClear={!fromUser}
            style={{ width: '100%' }}
            placeholder={s.userPlaceholder}
            value={userId}
            onChange={pickUser}
            options={freeUsers.map((u) => ({ value: u.id, label: `${u.fullName} · ${u.email}` }))}
          />
        </Labeled>
      )}
      <Divider titlePlacement="start" plain>
        {s.cardSection}
      </Divider>
      <Labeled label={s.direction}>
        <Select style={{ width: '100%' }} value={directionId} onChange={setDirectionId} options={directionOptions(directions)} />
      </Labeled>
      <Labeled label={s.manager}>
        <Select
          showSearch optionFilterProp="label"
          style={{ width: '100%' }}
          disabled={person?.isCeo}
          placeholder={person?.isCeo ? s.managerCeoNone : undefined}
          value={managerId}
          onChange={setManagerId}
          options={managerOptions(people, person ? [person.id] : [])}
        />
      </Labeled>
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <Labeled label={s.tag}>
            <Input value={tag} onChange={(e) => setTag(e.target.value)} />
          </Labeled>
        </div>
        <div style={{ flex: 1 }}>
          <Labeled label={s.team}>
            <Input value={team} onChange={(e) => setTeam(e.target.value)} />
          </Labeled>
        </div>
      </div>
      <Labeled label={strings.submissions.showInMap}>
        <Switch checked={showInMap} onChange={setShowInMap} />
      </Labeled>
      <Divider titlePlacement="start" plain>
        {s.formSection}
      </Divider>
      <ProfileForm fields={fields} values={values} onChange={setValue} photo={photo} onPhoto={setPhoto} currentPhoto={person?.thumb ?? null} skip={HR_SKIP} />
    </Modal>
  )
}
