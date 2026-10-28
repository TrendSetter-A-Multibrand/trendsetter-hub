import { useRef, useState } from 'react'
import { App, Button, Input, Modal, Segmented } from 'antd'
import { api } from '../../../core/api/index.js'
import strings from '../strings.js'
import { IMPORT_TEMPLATE_NAME, importTemplate, parseImport } from './xlsx.js'

const s = strings.marking.import
const LISTS = ['withdraw', 'return']

// Загрузка Excel с кодами, уже выведенными из оборота (или возвращёнными) вне хаба. Файл разбирается в браузере,
// на сервер уходит только список «код — номер документа».
export default function ImportModal({ open, onClose, onDone }) {
  const { message } = App.useApp()
  const [list, setList] = useState('withdraw')
  const [file, setFile] = useState(null) // { name, sheets }
  const [fallbackDocument, setFallbackDocument] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef(null)

  const parsed = file ? parseImport(file.sheets, list) : null
  const withoutDocument = parsed ? LISTS.reduce((n, l) => n + parsed[l].filter((r) => !r.document).length, 0) : 0
  const total = parsed ? parsed.withdraw.length + parsed.return.length : 0

  const close = () => {
    setFile(null)
    setFallbackDocument('')
    onClose()
  }

  const pickFile = async (e) => {
    const picked = e.target.files?.[0]
    e.target.value = ''
    if (!picked) return
    try {
      const XLSX = await import('xlsx')
      const book = XLSX.read(new Uint8Array(await picked.arrayBuffer()), { type: 'array' })
      const sheets = book.SheetNames.map((name) => ({
        name,
        rows: XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, raw: false, defval: '' }),
      }))
      setFile({ name: picked.name, sheets })
    } catch {
      message.error(s.unreadable)
    }
  }

  const downloadTemplate = async () => {
    const XLSX = await import('xlsx')
    const book = XLSX.utils.book_new()
    for (const { name, rows } of importTemplate()) {
      const sheet = XLSX.utils.aoa_to_sheet(rows)
      sheet['!cols'] = [{ wch: 36 }, { wch: 28 }, { wch: 28 }]
      XLSX.utils.book_append_sheet(book, sheet, name)
    }
    XLSX.writeFile(book, IMPORT_TEMPLATE_NAME)
  }

  const submit = async () => {
    setBusy(true)
    try {
      let saved = 0
      let skipped = 0
      for (const l of LISTS) {
        if (!parsed[l].length) continue
        const rows = parsed[l].map((r) => ({ km: r.km, document: r.document || fallbackDocument.trim() }))
        const res = await api.post('/modules/wb/marking/import', { list: l, rows })
        saved += res.saved
        skipped += res.skipped
      }
      message.success(s.done(saved, skipped))
      close()
      onDone()
    } catch (err) {
      message.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title={s.title}
      onCancel={close}
      okText={s.submit}
      cancelText={s.cancel}
      okButtonProps={{ disabled: !total || (withoutDocument > 0 && !fallbackDocument.trim()), loading: busy }}
      onOk={submit}
      destroyOnHidden
    >
      <div className="mk-import">
        <p className="mk-muted">{s.hint}</p>
        <div className="mk-file">
          <Button type="link" style={{ padding: 0 }} onClick={downloadTemplate}>
            ↓ {s.template}
          </Button>
          <span className="mk-muted">{s.templateHint}</span>
        </div>
        <Segmented value={list} onChange={setList} options={LISTS.map((l) => ({ value: l, label: strings.marking.lists[l] }))} />
        <div className="mk-file">
          <input ref={input} type="file" accept=".xlsx,.xls,.csv" hidden onChange={pickFile} />
          <Button onClick={() => input.current?.click()}>{file ? s.otherFile : s.pickFile}</Button>
          {file && <span className="mono mk-muted">{file.name}</span>}
        </div>
        {parsed && (
          <div className="mk-import-summary">
            <div>{s.found(parsed.withdraw.length, parsed.return.length)}</div>
            {parsed.skipped > 0 && <div className="mk-muted">{s.ignored(parsed.skipped)}</div>}
            {!total && <div className="mk-missing">{s.nothing}</div>}
          </div>
        )}
        {withoutDocument > 0 && (
          <div className="mk-import-fallback">
            <span>{s.withoutDocument(withoutDocument)}</span>
            <Input
              className="mono"
              placeholder={strings.marking.documentPlaceholder}
              value={fallbackDocument}
              onChange={(e) => setFallbackDocument(e.target.value)}
              style={{ width: 160 }}
            />
          </div>
        )}
      </div>
    </Modal>
  )
}
