import { useState } from 'react'
import { App, Button } from 'antd'
import { api } from '../../../core/api/index.js'
import { downloadBase64 } from '../../../core/lib/files.js'
import strings from '../strings.js'
import { DOC_MIME } from '../lib/documents.js'

// Кнопка «Экспорт в Excel»: GET path -> { fileName, dataBase64 } -> скачивание. Без деталей файла на экране (деньги и документы в экспорт не входят).
export default function ExportButton({ path, disabled }) {
  const { message } = App.useApp()
  const [busy, setBusy] = useState(false)

  const run = async () => {
    setBusy(true)
    try {
      const file = await api.get(path)
      downloadBase64({ fileName: file.fileName, mime: DOC_MIME.xlsx, dataBase64: file.dataBase64 })
    } catch (e) {
      message.error(e.message || strings.exportXlsx.failed)
    }
    setBusy(false)
  }

  return (
    <Button loading={busy} disabled={disabled} title={strings.exportXlsx.hint} onClick={run}>
      {strings.exportXlsx.button}
    </Button>
  )
}
