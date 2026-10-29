import { useRef } from 'react'
import { S, ask, setCfg, showTarget, loadFile, startLoad, openReceipts, focusScan, shared } from '../store.js'
import { useAuth } from '../../../core/auth/useAuth.js'
import strings from '../strings.js'
import { useStore } from './useStore.js'
import PageHead from '../../../core/layout/PageHead.jsx'
import SectionHead from '../../../core/layout/SectionHead.jsx'

const u = strings.header

export default function Header({ module }) {
  useStore()
  const { me } = useAuth()
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
  const syncText = lastErr ? u.syncBad(q.length) : q.length ? u.syncSending(q.length) : shared ? u.syncOkShared : u.syncOk

  const sw = (checked, label, onClick, opts = {}) => (
    <button type="button" role="switch" aria-checked={checked} className="sq-switch" title={opts.title} disabled={opts.disabled} onClick={onClick}>
      <span className="sq-switch-track" aria-hidden="true">
        <span className="sq-switch-knob" />
      </span>
      {label}
    </button>
  )

  return (
    <>
      <PageHead module={module} title={module.strings.tool}>
        <span className={`wh-sync ${syncCls}`} title={lastErr || (shared ? me.email : u.localMode)}>
          {syncText}
        </span>
        <button type="button" className="wh-btn" onClick={() => startLoad(() => { fileRef.current.value = ''; fileRef.current.click() })}>
          {u.loadExcel}
        </button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.xlsm,.csv" hidden onChange={(e) => loadFile(e.target.files[0])} />
        <button type="button" className={`wh-btn wh-primary wh-rcpt${st.receipt ? ' set' : ''}`} title={st.receipt || ''} onClick={() => openReceipts()}>
          {st.receipt ? u.receiptPrefix + st.receipt : u.chooseReceipt}
        </button>
      </PageHead>

      <section className="section" aria-labelledby="wh-shift">
        <SectionHead id="wh-shift" title={u.shiftTitle} />
        <div className="wh-shift">
          <label className="wh-field">
            <span className="wh-label">{u.worker}</span>
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
          {sw(cfg.autoprint, u.autoprint, () => { setCfg({ autoprint: !cfg.autoprint }); focusScan() })}
          {sw(cfg.palLabel, u.palLabel, () => { setCfg({ palLabel: !cfg.palLabel }); focusScan() }, { title: u.palLabelTitle })}
          {sw(cfg.cz, u.cz, toggleCz, { title: u.czTitle })}
          {sw(cfg.noCz, u.noCz, toggleNoCz, { title: u.noCzTitle })}
          {sw(dupOn, cfg.noCz ? `${u.dup} · ${u.dupOnForced}` : u.dup, () => {
            if (cfg.noCz) return
            setCfg({ dupGuard: !cfg.dupGuard })
            focusScan()
          }, { title: cfg.noCz ? u.dupTitleNoCz : cfg.cz ? u.dupTitleCz : u.dupTitle, disabled: cfg.cz || cfg.noCz })}
        </div>
      </section>
    </>
  )
}
