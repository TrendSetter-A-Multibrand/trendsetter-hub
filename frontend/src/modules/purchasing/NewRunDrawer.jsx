import { useEffect, useRef, useState } from 'react'
import {
  Alert, App, Button, Checkbox, Col, Collapse, Drawer, Dropdown, Form, Input, InputNumber, Radio, Row, Select, Space,
  Spin, Typography,
} from 'antd'
import { api } from '../../core/api/index.js'
import coreStrings from '../../core/strings.js'

// Интерфейс без логики: значения ничего не фильтруют и никуда не отправляются (кроме сохранения набора в мок).
const INITIAL_VALUES = { mode: 'rows', channels: [], shares: {} }
const SECTION_KEYS = ['file', 'channels', 'qty', 'price', 'assortment']
// Значения из файла: сбрасываются при смене файла и в наборы параметров не попадают.
const FILE_KEYS = ['brands', 'sizes', 'categories', 'seasons', 'years']
// Общие параметры, которые входят в набор.
const PRESET_KEYS = [
  'mode', 'channels', 'shares', 'qtyMin', 'qtyMax', 'lotLimit',
  'discount', 'genders',
]
const optionsOf = (labels) => Object.entries(labels).map(([value, label]) => ({ value, label }))
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]))
const numberProps = { style: { width: '100%' }, min: 0 }

// Выбор демо-файла из меню: настоящего выбора файла нет.
function FilePicker({ value, onPick, loading, summary, s }) {
  const menu = {
    items: [
      {
        key: 'demos',
        type: 'group',
        label: s.fileDemoHint,
        children: s.fileDemos.map((name) => ({ key: name, label: name })),
      },
    ],
    onClick: ({ key }) => onPick(key),
  }
  return (
    <Space orientation="vertical" size={4} style={{ width: '100%' }}>
      <div className="dropzone">
        <Dropdown menu={menu} trigger={['click']} disabled={loading}>
          <Button className="btn-pick mono">{s.chooseFile}</Button>
        </Dropdown>
        <span className={`picked${value ? ' has' : ''}`}>{value || s.fileNotChosen}</span>
      </div>
      {loading && (
        <Space>
          <Spin size="small" />
          <Typography.Text type="secondary">{s.inspecting}</Typography.Text>
        </Space>
      )}
      {summary && (
        <Typography.Text type="secondary">
          {s.fileRows}: {summary.rows}
        </Typography.Text>
      )}
    </Space>
  )
}

// Чекбоксы значений из файла с количеством позиций и кнопками «Выбрать все» / «Снять все».
function FileValues({ value = [], onChange, items, chips, s }) {
  if (!items) return <Typography.Text type="secondary">{s.fileFirst}</Typography.Text>
  const options = items.map((x) => ({ value: x.name, label: `${x.name} (${x.count})` }))
  return (
    <Space orientation="vertical" size={8} style={{ width: '100%' }}>
      <Space>
        <Button size="small" onClick={() => onChange(items.map((x) => x.name))}>
          {s.selectAll}
        </Button>
        <Button size="small" onClick={() => onChange([])}>
          {s.clearAll}
        </Button>
      </Space>
      <Checkbox.Group
        value={value}
        onChange={onChange}
        options={options}
        style={chips ? { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 4 } : undefined}
      />
    </Space>
  )
}

export default function NewRunDrawer({ open, onClose, s }) {
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const channels = Form.useWatch('channels', form) ?? []
  const supplier = Form.useWatch('supplier', form)
  const file = Form.useWatch('file', form)
  const ready = Boolean(supplier && file)
  const [options, setOptions] = useState(null)
  const [inspect, setInspect] = useState(null)
  const [inspecting, setInspecting] = useState(false)
  const [inspectError, setInspectError] = useState(null)
  const inspectSeq = useRef(0)
  const [loadError, setLoadError] = useState(null)
  const [presetId, setPresetId] = useState(null)
  const [naming, setNaming] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [presetError, setPresetError] = useState(null)
  const [savingPreset, setSavingPreset] = useState(false)

  useEffect(() => {
    if (!open || options) return
    let cancelled = false
    api
      .get('/modules/purchasing/options')
      .then((result) => !cancelled && setOptions(result))
      .catch((e) => !cancelled && setLoadError(e.message || s.loadFailed))
    return () => {
      cancelled = true
    }
  }, [open, options, s.loadFailed])

  const resetNaming = () => {
    setNaming(false)
    setPresetName('')
    setPresetError(null)
  }

  const clearInspect = () => {
    inspectSeq.current += 1 // ответ предыдущего запроса будет отброшен
    setInspect(null)
    setInspecting(false)
    setInspectError(null)
  }

  const pickFile = async (filename) => {
    clearInspect()
    const seq = inspectSeq.current
    form.setFieldsValue({ file: filename, ...Object.fromEntries(FILE_KEYS.map((k) => [k, undefined])) })
    setInspecting(true)
    try {
      const result = await api.post('/modules/purchasing/inspect', { filename })
      if (seq !== inspectSeq.current) return
      setInspect(result)
      // По умолчанию отмечено всё.
      form.setFieldsValue(Object.fromEntries(FILE_KEYS.map((k) => [k, result[k].map((x) => x.name)])))
    } catch (e) {
      if (seq === inspectSeq.current) setInspectError(e.message)
    } finally {
      if (seq === inspectSeq.current) setInspecting(false)
    }
  }

  const reset = () => {
    clearInspect()
    form.resetFields()
    setPresetId(null)
    resetNaming()
  }

  const close = () => {
    reset()
    onClose()
  }

  const applyPreset = (id) => {
    setPresetId(id)
    const preset = options.presets.find((p) => p.id === id)
    if (!preset) return
    // Поставщик, файл и значения из файла в набор не входят — остаются как есть.
    const keep = pick(form.getFieldsValue(true), ['supplier', 'file', ...FILE_KEYS])
    form.resetFields()
    form.setFieldsValue({ ...INITIAL_VALUES, ...pick(preset.values, PRESET_KEYS), ...keep })
  }

  const savePreset = async () => {
    setSavingPreset(true)
    try {
      const values = pick(form.getFieldsValue(true), PRESET_KEYS) // только общие параметры
      const created = await api.post('/modules/purchasing/presets', { name: presetName, values })
      setOptions((prev) => ({ ...prev, presets: [...prev.presets, created] }))
      setPresetId(created.id)
      resetNaming()
      message.success(s.presetSaved)
    } catch (e) {
      setPresetError(e.message)
    } finally {
      setSavingPreset(false)
    }
  }

  const submit = () => {
    message.info(s.accepted)
    close()
  }

  // Пустая группа при выбранном файле отфильтровала бы все строки.
  const nonEmpty = {
    validator: (_, v) => (!inspect || v?.length ? Promise.resolve() : Promise.reject(new Error(s.emptyGroup))),
  }
  const fileGroup = (name, label, { chips = false, required = false } = {}) => (
    <Form.Item name={name} label={label} rules={required ? [nonEmpty] : undefined}>
      <FileValues items={inspect?.[name]} chips={chips} s={s} />
    </Form.Item>
  )

  const heading = (n, title) => (
    <>
      <span className="mono" style={{ fontSize: 11, color: 'var(--red)', marginRight: 12 }}>[{n}]</span>
      {title}
    </>
  )

  const items = [
    {
      key: 'file',
      label: heading('01', s.sections.file),
      children: (
        <>
          <Form.Item name="supplier" label={s.supplier} rules={[{ required: true, message: s.supplierRequired }]}>
            <Select
              placeholder={s.supplierPlaceholder}
              loading={!options && !loadError}
              options={(options?.suppliers ?? []).map((x) => ({ value: x.id, label: x.name }))}
            />
          </Form.Item>
          <Form.Item name="file" label={s.file} rules={[{ required: true, message: s.fileRequired }]}>
            <FilePicker onPick={pickFile} loading={inspecting} summary={inspect} s={s} />
          </Form.Item>
          {inspectError && <Alert type="error" showIcon title={inspectError} style={{ marginBottom: 16 }} />}
          <Form.Item name="mode" label={s.mode}>
            <Radio.Group className="card-options" options={optionsOf(s.modes)} />
          </Form.Item>
        </>
      ),
    },
    {
      key: 'channels',
      label: heading('02', s.sections.channels),
      children: (
        <>
          <Form.Item name="channels" style={{ marginBottom: channels.length ? 16 : 0 }}>
            <Checkbox.Group className="card-options" options={optionsOf(s.channels)} />
          </Form.Item>
          <Row gutter={16}>
            {channels.map((key) => (
              <Col xs={24} sm={8} key={key}>
                <Form.Item name={['shares', key]} label={`${s.channels[key]}: ${s.share}`}>
                  <InputNumber {...numberProps} max={100} />
                </Form.Item>
              </Col>
            ))}
          </Row>
        </>
      ),
    },
    {
      key: 'qty',
      label: heading('03', s.sections.qty),
      children: (
        <Row gutter={16}>
          {['qtyMin', 'qtyMax', 'lotLimit'].map((name) => (
            <Col xs={24} sm={12} key={name}>
              <Form.Item name={name} label={s[name]}>
                <InputNumber {...numberProps} />
              </Form.Item>
            </Col>
          ))}
        </Row>
      ),
    },
    {
      key: 'price',
      label: heading('04', s.sections.price),
      children: (
        <Form.Item name="discount" label={s.discount} style={{ marginBottom: 0 }}>
          <InputNumber {...numberProps} max={100} />
        </Form.Item>
      ),
    },
    {
      key: 'assortment',
      label: heading('05', s.sections.assortment),
      children: (
        <>
          {inspect?.brands.length === 1 ? (
            <Form.Item label={s.brands}>
              <Typography.Text>
                {s.singleBrand}: {inspect.brands[0].name} ({inspect.brands[0].count} {s.itemsShort})
              </Typography.Text>
            </Form.Item>
          ) : (
            fileGroup('brands', s.brands, { required: true })
          )}
          {fileGroup('categories', s.categories, { required: true })}
          {fileGroup('sizes', s.sizes, { chips: true, required: true })}
          <Form.Item name="genders" label={s.gender}>
            <Checkbox.Group options={optionsOf(s.genders)} />
          </Form.Item>
          {fileGroup('seasons', s.season)}
          {fileGroup('years', s.years)}
        </>
      ),
    },
  ]

  return (
    <Drawer
      open={open}
      title={
        <div className="drawer-heading">
          <span className="drawer-eyebrow mono">{s.eyebrow}</span>
          <span className="drawer-title">{s.title}</span>
        </div>
      }
      closable={{ placement: 'end' }}
      size="min(720px, 100vw)"
      placement="right"
      forceRender
      onClose={close}
      footer={
        <div className="drawer-footer">
          <span className={`ready mono${ready ? ' ok' : ''}`}>{ready ? s.readyYes : s.readyNo}</span>
          <Space>
            <Button onClick={close}>{coreStrings.cancel}</Button>
            <Button type="primary" onClick={() => form.submit()}>
              {s.run}
            </Button>
          </Space>
        </div>
      }
    >
      {loadError && <Alert type="error" showIcon title={loadError} style={{ marginBottom: 16 }} />}
      <Space orientation="vertical" size={8} style={{ width: '100%', marginBottom: 16 }}>
        <span className="field-label mono">{s.preset}</span>
        <Space wrap>
          <Select
            style={{ width: 260, maxWidth: '100%' }}
            placeholder={s.presetPlaceholder}
            value={presetId}
            onChange={applyPreset}
            disabled={!options}
            options={(options?.presets ?? []).map((p) => ({ value: p.id, label: p.name }))}
          />
          <Button onClick={() => setNaming(true)} disabled={!options || naming}>
            {s.saveAsPreset}
          </Button>
          <Button type="text" onClick={reset}>
            {s.reset}
          </Button>
        </Space>
        {naming && (
          <>
            <Space.Compact>
              <Input
                autoFocus
                value={presetName}
                placeholder={s.presetNamePlaceholder}
                status={presetError ? 'error' : undefined}
                onChange={(e) => {
                  setPresetName(e.target.value)
                  setPresetError(null)
                }}
                onPressEnter={savePreset}
              />
              <Button type="primary" loading={savingPreset} onClick={savePreset}>
                {coreStrings.save}
              </Button>
              <Button onClick={resetNaming}>{coreStrings.cancel}</Button>
            </Space.Compact>
            {presetError && <Typography.Text type="danger">{presetError}</Typography.Text>}
          </>
        )}
      </Space>
      <Form form={form} layout="vertical" initialValues={INITIAL_VALUES} onFinish={submit}>
        <Collapse
          defaultActiveKey={SECTION_KEYS.slice(0, 2)}
          expandIconPlacement="end"
          expandIcon={({ isActive }) => <span className="mono" style={{ fontSize: 14, color: 'var(--muted)' }}>{isActive ? '−' : '+'}</span>}
           items={items.map((item) => ({ ...item, forceRender: true }))} />
      </Form>
    </Drawer>
  )
}
