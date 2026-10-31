import { useMemo, useState } from 'react'
import { Button, Popover, Select } from 'antd'
import { SettingOutlined } from '@ant-design/icons'
import strings from '../strings.js'
import { cityById, countryName, searchCities } from './cityCatalog.js'

const s = strings.hub.home

const toOption = (c) => ({ value: c.id, label: `${c.name} · ${countryName(c.cc)}` })

// Шестерёнка «Мой город»: Popover с поиском по справочнику городов (cityCatalog.js) и кнопкой «Убрать город». Выбор для погоды (часы настраиваются отдельно, см. ZonePicker).
export default function CityPicker({ value, onChange, className = '' }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  // найденные города; выбранный город всегда есть в опциях, иначе Select покажет сырой id
  const options = useMemo(() => {
    const found = searchCities(query).map(toOption)
    const current = cityById(value)
    return current && !found.some((o) => o.value === current.id) ? [...found, toOption(current)] : found
  }, [query, value])

  const close = () => {
    setOpen(false)
    setQuery('')
  }

  const content = (
    <div
      className="city-picker"
      onKeyDown={(e) => {
        if (e.key === 'Escape') close()
      }}
    >
      <Select
        showSearch
        autoFocus
        className="city-picker-select"
        aria-label={s.myCityTitle}
        placeholder={s.myCityPlaceholder}
        value={value ?? undefined}
        options={options}
        filterOption={false}
        searchValue={query}
        onSearch={setQuery}
        notFoundContent={s.cityNotFound}
        popupMatchSelectWidth={false}
        getPopupContainer={(node) => node.parentNode}
        onChange={(v) => {
          onChange(v)
          close()
        }}
      />
      {value && (
        <Button
          size="small"
          className="city-remove"
          onClick={() => {
            onChange(null)
            close()
          }}
        >
          {s.removeCity}
        </Button>
      )}
      <a className="city-source" href="https://www.geonames.org/" target="_blank" rel="noreferrer">
        {s.citiesSource}
      </a>
    </div>
  )

  return (
    <Popover trigger="click" placement="bottomRight" title={s.myCityTitle} content={content} open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <button type="button" className={`city-gear ${className}`.trim()} aria-label={s.myCityAria} aria-expanded={open}>
        <SettingOutlined aria-hidden="true" />
      </button>
    </Popover>
  )
}
