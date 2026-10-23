import { useRef, useState } from 'react'
import { Avatar, Button, Typography } from 'antd'
import { UserOutlined } from '@ant-design/icons'
import { resizePhoto } from '../../../core/lib/resizePhoto.js'
import strings from '../strings.js'

const s = strings.form

// Выбор фото: уменьшает в браузере и отдаёт { full, thumb } (data-URL). current — превью уже сохранённого фото.
export default function PhotoInput({ value, current, onChange }) {
  const inputRef = useRef(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const pick = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      onChange(await resizePhoto(file))
      setError(null)
    } catch (err) {
      setError(err.message === 'size' ? s.photoSize : s.photoDecode)
    } finally {
      setBusy(false)
    }
  }

  const preview = value?.thumb ?? current ?? null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <Avatar size={64} src={preview} icon={<UserOutlined />} />
      <div>
        <input ref={inputRef} type="file" accept="image/*" hidden onChange={pick} />
        <Button loading={busy} onClick={() => inputRef.current?.click()}>
          {preview ? s.photoChange : s.photoChoose}
        </Button>
        <div>
          <Typography.Text type="secondary">{s.photoHint}</Typography.Text>
        </div>
        {error && (
          <div>
            <Typography.Text type="danger">{error}</Typography.Text>
          </div>
        )}
      </div>
    </div>
  )
}
