import { useRef } from 'react'
import { S, ask, setCfg, showTarget, loadFile, startLoad, openReceipts, focusScan } from '../store.js'
import strings from '../strings.js'
import { useStore } from './useStore.js'

const u = strings.header

export default function Header() {
  useStore()
  const { cfg, st, q, lastErr } = S
  const fileRef = useRef(null)

  const toggleCz = async () => {
    const on = !cfg.cz
    if (!(await ask(on ? u.czOnConfirm : u.czOffConfirm))) return
    setCfg({ cz: on, noCz: on ? false : cfg.noCz })
    showTarget('idle', on ? u.czOnBig : u.czOffBig, on ? u.czOnSub : u.czOffSub)
    focusScan()
  }
  const toggleNoCz = async () => {
    const on = !cfg.noCz
    if (!(await ask(on ? u.noCzOnConfirm : u.noCzOffConfirm))) return
    setCfg({ noCz: on, cz: on ? false : cfg.cz })
    showTarget('idle', on ? u.noCzOnBig : u.noCzOffBig, on ? u.noCzOnSub : u.noCzOffSub)
    focusScan()
  }
  const dupOn = cfg.dupGuard || cfg.noCz
  const syncCls = lastErr ? 'bad' : q.length ? '' : 'ok'
  const syncText = lastErr ? u.syncBad(q.length) : q.length ? u.syncSending(q.length) : u.syncOk

  return (
    <header className="wh-header">
      <h1>{u.title}</h1>
      <label>
        {u.worker}
        <input
          ref={(el) => (S.workerEl = el)}
          className="wh-worker"
          maxLength={40}
          autoComplete="off"
          placeholder={u.workerPlaceholder}
          defaultValue={cfg.worker}
          onChange={(e) => setCfg({ worker: e.target.value.trim().replace(/\s+/g, ' ') })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              focusScan()
            }
          }}
        />
      </label>
      <label>
        <input type="checkbox" checked={cfg.autoprint} onChange={(e) => { setCfg({ autoprint: e.target.checked }); focusScan() }} /> {u.autoprint}
      </label>
      <label title={u.palLabelTitle}>
        <input type="checkbox" checked={cfg.palLabel} onChange={(e) => { setCfg({ palLabel: e.target.checked }); focusScan() }} /> {u.palLabel}
      </label>
      <button type="button" className={`wh-toggle${cfg.cz ? ' on' : ''}`} title={u.czTitle} onClick={toggleCz}>
        {u.cz}: {cfg.cz ? u.on : u.off}
      </button>
      <button type="button" className={`wh-toggle nocz${cfg.noCz ? ' on' : ''}`} title={u.noCzTitle} onClick={toggleNoCz}>
        {u.noCz}: {cfg.noCz ? u.on : u.off}
      </button>
      <button
        type="button"
        className={`wh-toggle dup${dupOn ? ' on' : ''}`}
        disabled={cfg.cz || cfg.noCz}
        title={cfg.noCz ? u.dupTitleNoCz : cfg.cz ? u.dupTitleCz : u.dupTitle}
        onClick={() => {
          if (cfg.noCz) return
          setCfg({ dupGuard: !cfg.dupGuard })
          focusScan()
        }}
      >
        {u.dup}: {cfg.noCz ? u.dupOnForced : cfg.dupGuard ? u.on : u.off}
      </button>
      <span className="wh-sp" />
      <span className="wh-who">{u.localMode}</span>
      <span className={`wh-sync ${syncCls}`} title={lastErr || ''}>
        {syncText}
      </span>
      <button type="button" onClick={() => showTarget('err msg', u.sheetOffTitle, u.sheetOffSub)}>
        {u.sheet}
      </button>
      <button type="button" className="wh-primary" onClick={() => startLoad(() => { fileRef.current.value = ''; fileRef.current.click() })}>
        {u.loadExcel}
      </button>
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.xlsm,.csv" hidden onChange={(e) => loadFile(e.target.files[0])} />
      <button type="button" className={`wh-primary wh-rcpt${st.receipt ? ' set' : ''}`} title={st.receipt || ''} onClick={() => openReceipts()}>
        {st.receipt ? u.receiptPrefix + st.receipt : u.chooseReceipt}
      </button>
    </header>
  )
}
