import { useState } from 'react'
import { Button, Popover, Select } from 'antd'
import { SettingOutlined } from '@ant-design/icons'
import strings from '../strings.js'
import { CITY_ZONES } from './myCity.js'

const s = strings.hub.home

const OPTIONS = CITY_ZONES.map((c) => ({ value: c.id, label: s.cities[c.id] }))

// Шестерёнка «Мой город»: Popover с поиском по 17 городам и кнопкой «Убрать город». Выбор для погоды (часы настраиваются отдельно, см. ZonePicker).
export default function CityPicker({ value, onChange, className = '' }) {
  const [open, setOpen] = useState(false)

  const content = (
    <div
      className="city-picker"
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpen(false)
      }}
    >
      <Select
        showSearch
        autoFocus
        className="city-picker-select"
        aria-label={s.myCityTitle}
        placeholder={s.myCityPlaceholder}
        value={value ?? undefined}
        options={OPTIONS}
        optionFilterProp="label"
        getPopupContainer={(node) => node.parentNode}
        onChange={(v) => {
          onChange(v)
          setOpen(false)
        }}
      />
      {value && (
        <Button
          size="small"
          className="city-remove"
          onClick={() => {
            onChange(null)
            setOpen(false)
          }}
        >
          {s.removeCity}
        </Button>
      )}
    </div>
  )

  return (
    <Popover trigger="click" placement="bottomRight" title={s.myCityTitle} content={content} open={open} onOpenChange={setOpen}>
      <button type="button" className={`city-gear ${className}`.trim()} aria-label={s.myCityAria} aria-expanded={open}>
        <SettingOutlined aria-hidden="true" />
      </button>
    </Popover>
  )
}
