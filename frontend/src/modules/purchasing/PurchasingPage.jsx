import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Alert, App, Spin, Tooltip } from 'antd'
import { api } from '../../core/api/index.js'
import { canRun, canSeeData } from '../../core/access.js'
import { formatDateTime, formatPrice } from '../../core/format.js'
import NoDataAccess from '../../core/pages/NoDataAccess.jsx'
import coreStrings from '../../core/strings.js'
import NewRunDrawer from './NewRunDrawer.jsx'

const numberFormatter = new Intl.NumberFormat('ru-RU')

export default function PurchasingPage({ module, access }) {
  const s = module.strings
  const { message } = App.useApp()
  const seeData = canSeeData(access)
  const [files, setFiles] = useState(null)
  const [error, setError] = useState(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    if (!seeData) return
    let cancelled = false
    api
      .get('/modules/purchasing/files')
      .then((result) => !cancelled && setFiles(result))
      .catch((e) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [seeData])

  const notYet = () => message.info(s.nextStage)

  const uploadButton = (disabled) => (
    <button type="button" className="btn-primary" disabled={disabled} onClick={() => setDrawerOpen(true)}>
      <span className="plus">+</span> {s.upload}
    </button>
  )

  return (
    <div className="stack module">
      <div className="module-head">
        <div>
          <div className="crumbs mono">
            <Link to="/">{coreStrings.layout.hub}</Link>
            <span>/</span>
            <span className="current">{s.dept}</span>
          </div>
          <h1 className="h1">{s.pageTitle}</h1>
          <div className="subtitle">{s.pageSubtitle}</div>
        </div>
        {seeData && (canRun(access) ? uploadButton(false) : <Tooltip title={s.uploadHint}>{uploadButton(true)}</Tooltip>)}
      </div>

      {!seeData ? (
        <NoDataAccess />
      ) : (
        <>
          <div className="section-head">
            <h2 className="h2">{s.filesTitle}</h2>
            <span className="counter mono">[{String(files?.length ?? 0).padStart(2, '0')}]</span>
          </div>
          {error && <Alert type="error" showIcon title={error} />}
          {!files && !error && <Spin />}
          {files && (
            <div className="files">
              <div className="files-inner">
                <div className="files-row files-head mono">
                  <span>{s.columns.file}</span>
                  <span>{s.columns.supplier}</span>
                  <span>{s.columns.uploadedAt}</span>
                  <span>{s.columns.user}</span>
                  <span className="cell-num">{s.columns.items}</span>
                  <span className="cell-num">{s.columns.qty}</span>
                  <span className="cell-num">{s.columns.rrpTotal}</span>
                  <span />
                </div>
                {files.map((f) => (
                  <div className="files-row" key={f.id}>
                    <span className="cell-ellipsis" style={{ fontWeight: 500 }}>{f.filename}</span>
                    <span className="cell-ellipsis cell-muted">{f.supplier}</span>
                    <span className="cell-date mono">{formatDateTime(f.uploaded_at)}</span>
                    <span className="cell-ellipsis">{f.user_name}</span>
                    <span className="cell-num mono">{numberFormatter.format(f.items)}</span>
                    <span className="cell-num mono">{numberFormatter.format(f.qty)}</span>
                    <span className="cell-num mono">{formatPrice(f.rrp_total)}</span>
                    <button type="button" className="btn-download mono" onClick={notYet}>
                      ↓ {s.download}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
      {canRun(access) && <NewRunDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} s={s.newRun} />}
    </div>
  )
}
