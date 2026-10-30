import { useMemo, useState } from 'react'
import { Button, Popover, Select } from 'antd'
import { SettingOutlined } from '@ant-design/icons'
import strings from '../strings.js'
import { allZones, browserZone, zoneLabel, zoneOffset } from './clocks.js'

const s = strings.hub.home

const buildOptions = (current) => {
  const now = new Date()
  return allZones([current], Intl, s.zones)
    .map((zone) => {
      const name = zoneLabel(zone, s.zones)
      return { value: zone, name, label: `${name} · ${zoneOffset(zone, now)}`, search: `${name} ${zone}`.toLowerCase() }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
}

// Шестерёнка часов: Popover с поиском по любому часовому поясу (по названию и IANA-id) и кнопкой «Определить автоматически».
// index — номер блока (1 или 2), zone — действующая зона, onChange(zone) — выбор.
export default function ZonePicker({ index, zone, onChange, className = '' }) {
  const [open, setOpen] = useState(false)
  // ≈400 вызовов zoneOffset — строим один раз на открытие, не на каждый рендер
  const options = useMemo(() => (open ? buildOptions(zone) : []), [open, zone])
  const auto = browserZone()

  const pick = (value) => {
    onChange(value)
    setOpen(false)
  }

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
        aria-label={s.clockTitle(index)}
        placeholder={s.zonePlaceholder}
        value={zone}
        options={options}
        filterOption={(input, option) => option.search.includes(input.trim().toLowerCase())}
        getPopupContainer={(node) => node.parentNode}
        onChange={pick}
      />
      <Button size="small" className="zone-auto" disabled={!auto} onClick={() => pick(auto)}>
        {s.zoneAuto}
      </Button>
    </div>
  )

  return (
    <Popover trigger="click" placement="bottomRight" title={s.clockTitle(index)} content={content} open={open} onOpenChange={setOpen}>
      <button type="button" className={`city-gear ${className}`.trim()} aria-label={s.clockAria(index)} aria-expanded={open}>
        <SettingOutlined aria-hidden="true" />
      </button>
    </Popover>
  )
}
