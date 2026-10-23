import { useEffect, useState } from 'react'
import { App } from 'antd'
import { api } from '../../../core/api/index.js'
import strings from '../strings.js'
import { buildValues, validateProfile } from './profile.js'

const s = strings.profile

// Состояние и действия формы «Моя анкета» (общие для drawer в карте и раздела страницы профиля).
// me — ответ GET /modules/team/me; onChanged() — после отправки/изменения/отзыва; onDone() — дополнительно после успеха (drawer закрывается).
export function useMyProfileForm({ me, onChanged, onDone }) {
  const { message } = App.useApp()
  const [fields, setFields] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [values, setValues] = useState(() => ({ ...me.values }))
  const [photo, setPhoto] = useState(null)
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    api
      .get('/modules/team/fields')
      .then((r) => alive && setFields(r))
      .catch((e) => alive && setLoadError(e.message))
    return () => {
      alive = false
    }
  }, [])

  const pending = me.submission?.status === 'pending'
  // manager_claim нужен только для новой карточки (у существующей руководитель уже назначен)
  const skip = me.person ? ['manager_claim'] : []
  const hasPhoto = Boolean(photo || me.photo || me.person?.hasPhoto)

  const setValue = (key, v) => {
    setValues((cur) => ({ ...cur, [key]: v }))
    setErrors((cur) => (cur[key] ? { ...cur, [key]: undefined } : cur))
  }

  const changePhoto = (v) => {
    setPhoto(v)
    setErrors((cur) => ({ ...cur, photo: undefined }))
  }

  const run = async (action, okText) => {
    setBusy(true)
    try {
      await action()
      message.success(okText)
      onChanged()
      onDone?.()
    } catch (e) {
      message.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  const submit = () => {
    const found = validateProfile(fields, values, { skip, hasPhoto })
    setErrors(found)
    if (Object.values(found).some(Boolean)) return message.error(s.fixErrors)
    const body = { values: buildValues(fields, values, skip), photo: photo ?? null }
    return run(() => (pending ? api.patch('/modules/team/me/submission', body) : api.post('/modules/team/me/submission', body)), pending ? s.updated : s.sent)
  }

  const cancelSubmission = () => run(() => api.post('/modules/team/me/submission/cancel'), s.cancelled)

  return { fields, loadError, values, setValue, photo, changePhoto, errors, busy, pending, skip, submit, cancelSubmission }
}
