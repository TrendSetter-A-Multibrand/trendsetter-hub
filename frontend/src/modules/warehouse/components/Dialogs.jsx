import { useEffect, useRef, useState } from 'react'
import {
  S, setUi, closeReceipts, createReceipt, switchReceipt, finishReceipt, openSectorDlg, closeSectorDlg,
  freePallet, reopenByCode, importOldFile, sectorsApi, closeBox,
} from '../store.js'
import { DEMO_PIN } from '../lib/localBackend.js'
import { API_URL, DEMO_MODE } from '../../../core/config.js'
import { useAuth } from '../../../core/auth/useAuth.js'
import strings from '../strings.js'
import { useStore, useDialog } from './useStore.js'

const d = strings.dialogs

// Ответственный по группе проходит без ПИН; в демо (без сервера) ПИН нужен всегда
const usePinFree = () => {
  const { me } = useAuth()
  return Boolean(API_URL) && me?.module_responsible?.warehouse === true
}

const Msg = ({ m }) => (m ? <span className={m.ok ? 'wh-okmsg' : 'wh-errmsg'}>{m.text}</span> : null)

function AskDialog() {
  const a = S.ui.ask
  const { ref, onCancel } = useDialog(Boolean(a), () => a && a.done(false))
  return (
    <dialog ref={ref} onCancel={onCancel}>
      <p>{a ? a.text : ''}</p>
      <div className="wh-row end">
        <button type="button" onClick={() => a && a.done(false)}>{d.cancel}</button>
        <button type="button" className="wh-dark" autoFocus onClick={() => a && a.done(true)}>{d.yes}</button>
      </div>
    </dialog>
  )
}

function ChooseDialog() {
  const c = S.ui.choose
  const { ref, onCancel } = useDialog(Boolean(c), () => c && c.done(-1))
  return (
    <dialog ref={ref} onCancel={onCancel}>
      <p className="wh-pre">{c ? c.text : ''}</p>
      <div className="wh-row end">
        {c && c.buttons.map((b, i) => (
          <button key={b.text} type="button" className={b.dark ? 'wh-dark' : ''} onClick={() => c.done(i)}>{b.text}</button>
        ))}
      </div>
    </dialog>
  )
}

function ReceiptsDialog() {
  const open = S.ui.receipts
  const { ref, onCancel } = useDialog(open, closeReceipts)
  return (
    <dialog ref={ref} onCancel={onCancel} className="wh-rdlg">
      {open && <ReceiptsBody />}
    </dialog>
  )
}

function ReceiptsBody() {
  const [name, setName] = useState(S.ui.receiptPrefill || '')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)
  useEffect(() => {
    const t = setTimeout(() => inputRef.current && inputRef.current.focus(), 50)
    return () => clearTimeout(t)
  }, [])
  const list = S.receipts.slice()
  if (S.st.receipt && !list.some((r) => r.name === S.st.receipt)) list.unshift({ name: S.st.receipt, created: '', by: '' })
  const create = async () => {
    const n = name.trim().replace(/\s+/g, ' ')
    if (!n) return inputRef.current.focus()
    setBusy(true)
    try {
      await createReceipt(n)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <h3>{d.receiptTitle}</h3>
      <div className="wh-new">
        <input
          ref={inputRef}
          maxLength={80}
          placeholder={d.receiptPlaceholder}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              create()
            }
          }}
        />
        <button type="button" className="wh-dark" disabled={busy} onClick={create}>{d.create}</button>
      </div>
      <div className="wh-hint">{d.receiptHint}</div>
      <div className="wh-rlist">
        {S.receiptsMsg ? (
          <div className="wh-hint">{S.receiptsMsg}</div>
        ) : list.length ? (
          list.map((r) => (
            <div key={r.name} className={`it${r.name === S.st.receipt ? ' cur' : ''}`}>
              <div className="nm">
                {r.name}
                <small>
                  {r.name === S.st.receipt ? d.receiptCurrent : ''}
                  {r.created || ''}
                  {r.by ? ' · ' + r.by : ''}
                </small>
              </div>
              {r.name === S.st.receipt ? null : (
                <button type="button" className="wh-dark" onClick={() => switchReceipt(r.name)}>{d.receiptPick}</button>
              )}
              <button type="button" onClick={() => finishReceipt(r.name)}>{d.receiptFinish}</button>
            </div>
          ))
        ) : (
          <div className="wh-hint">{d.receiptNone}</div>
        )}
      </div>
      <div className="wh-row end">
        <button type="button" onClick={closeReceipts}>{d.close}</button>
      </div>
    </>
  )
}

function MoreDialog() {
  const open = S.ui.more
  const { ref, onCancel } = useDialog(open, () => setUi({ more: false }))
  return (
    <dialog ref={ref} onCancel={onCancel} className="wh-sdlg">
      {open && <MoreBody />}
    </dialog>
  )
}

function MoreBody() {
  const close = () => setUi({ more: false })
  const [box, setBox] = useState('')
  const [boxMsg, setBoxMsg] = useState(null)
  const [pin, setPin] = useState('')
  const pinFree = usePinFree()
  const [file, setFile] = useState(null)
  const [impMsg, setImpMsg] = useState(null)
  const [pal, setPal] = useState('')
  const [palMsg, setPalMsg] = useState(null)
  const boxRef = useRef(null)
  useEffect(() => {
    const t = setTimeout(() => boxRef.current && boxRef.current.focus(), 50)
    return () => clearTimeout(t)
  }, [])

  const doOpen = async () => {
    setBoxMsg({ text: d.checking, ok: true })
    const r = await reopenByCode(box)
    if (r.error) setBoxMsg({ text: r.error })
  }
  const doImport = async () => {
    const r = await importOldFile(file, pinFree ? '' : pin.trim(), pinFree)
    if (r.error) setImpMsg({ text: r.error })
  }
  const doFree = async () => {
    const r = await freePallet(pal)
    if (r.error) setPalMsg({ text: r.error })
  }
  const onEnter = (fn) => (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      fn()
    }
  }
  return (
    <>
      <h3>{d.moreTitle}</h3>
      <p className="wh-sub"><b>{d.reopenTitle}</b></p>
      <div className="wh-hint">{d.reopenHint}</div>
      <div className="wh-new">
        <input ref={boxRef} maxLength={40} placeholder={d.reopenPlaceholder} value={box} onChange={(e) => setBox(e.target.value)} onKeyDown={onEnter(doOpen)} />
        <button type="button" className="wh-dark" onClick={doOpen}>{d.reopenButton}</button>
      </div>
      <div className="wh-msg"><Msg m={boxMsg} /></div>
      <hr />
      <p className="wh-sub"><b>{d.importTitle}</b></p>
      <div className="wh-hint">{d.importHint}</div>
      <div className="wh-new wrap">
        <input type="file" accept=".csv" onChange={(e) => setFile(e.target.files[0] || null)} />
        {!pinFree && (
          <input className="wh-pin" type="password" inputMode="numeric" maxLength={4} autoComplete="off" placeholder={d.pin} value={pin} onChange={(e) => setPin(e.target.value)} />
        )}
        <button type="button" onClick={doImport}>{d.importButton}</button>
      </div>
      {pinFree && <div className="wh-hint">{d.pinNotNeeded}</div>}
      <div className="wh-msg"><Msg m={impMsg} /></div>
      <hr />
      <p className="wh-sub"><b>{d.sectorsTitle}</b></p>
      <div className="wh-hint">{d.sectorsHint}</div>
      <button type="button" onClick={() => openSectorDlg(null)}>{d.sectorsButton}</button>
      <hr />
      <p className="wh-sub"><b>{d.freeTitle}</b></p>
      <div className="wh-hint">{d.freeHint}</div>
      <div className="wh-new">
        <input maxLength={10} placeholder={d.freePlaceholder} value={pal} onChange={(e) => setPal(e.target.value)} onKeyDown={onEnter(doFree)} />
        <button type="button" onClick={doFree}>{d.freeButton}</button>
      </div>
      <div className="wh-msg"><Msg m={palMsg} /></div>
      {DEMO_MODE && <div className="wh-hint">{d.demoPin(DEMO_PIN)}</div>}
      <div className="wh-row end">
        <button type="button" onClick={close}>{d.close}</button>
      </div>
    </>
  )
}

function SectorsDialog() {
  const open = S.ui.sectors
  const { ref, onCancel } = useDialog(open, closeSectorDlg)
  return (
    <dialog ref={ref} onCancel={onCancel} className="wh-xdlg">
      {open && <SectorsBody retry={S.ui.sectorsRetry} />}
    </dialog>
  )
}

function SectorsBody({ retry }) {
  const [cat, setCat] = useState(retry ? String(+retry || retry) : '')
  const [sec, setSec] = useState('')
  const [pin, setPin] = useState('')
  const pinFree = usePinFree()
  const [msg, setMsg] = useState(null)
  const [list, setList] = useState(null)
  const [busy, setBusy] = useState(false)
  const catRef = useRef(null)
  const secRef = useRef(null)
  useEffect(() => {
    sectorsApi.list().then(setList).catch((e) => setList(e.message))
    const t = setTimeout(() => (retry ? secRef.current : catRef.current)?.focus(), 50)
    return () => clearTimeout(t)
  }, [retry])

  const ok = async () => {
    const c = cat.trim()
    const s = sec.trim()
    const p = pinFree ? '' : pin.trim()
    if (!/^\d{1,3}$/.test(c) || !/^\d{1,3}$/.test(s)) return setMsg({ text: d.sectorsDigits })
    if (!pinFree && !/^\d{4}$/.test(p)) return setMsg({ text: d.sectorsPin })
    setBusy(true)
    try {
      setList(await sectorsApi.add(c, s, p))
      setPin('')
      setMsg({ text: d.sectorsDone(+c, +s), ok: true })
      if (retry && String(+retry) === String(+c)) {
        closeSectorDlg()
        await closeBox(retry, false)
      }
    } catch (e) {
      setMsg({ text: e.message.replace(/^Error:\s*/, '') })
      setPin('')
    } finally {
      setBusy(false)
    }
  }
  const remove = async (c, s) => {
    const p = pinFree ? '' : pin.trim()
    if (!pinFree && !/^\d{4}$/.test(p)) return setMsg({ text: d.sectorsPinRemove })
    try {
      setList(await sectorsApi.remove(c, s, p))
      setMsg({ text: d.sectorsRemoved(+c, +s), ok: true })
    } catch (e) {
      setMsg({ text: e.message })
    }
  }
  const onEnter = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      ok()
    }
  }
  return (
    <>
      <h3>{d.sectorsDlgTitle}</h3>
      <div className="wh-hint">{d.sectorsDlgHint}</div>
      <div className="wh-fields">
        <label>{d.category}<input ref={catRef} inputMode="numeric" maxLength={3} value={cat} onChange={(e) => setCat(e.target.value)} onKeyDown={onEnter} /></label>
        <span className="arrow">→</span>
        <label>{d.section}<input ref={secRef} inputMode="numeric" maxLength={3} value={sec} onChange={(e) => setSec(e.target.value)} onKeyDown={onEnter} /></label>
        {!pinFree && (
          <label>{d.responsiblePin}<input className="wh-pin" type="password" inputMode="numeric" maxLength={4} autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} onKeyDown={onEnter} /></label>
        )}
      </div>
      {pinFree && <div className="wh-hint">{d.pinNotNeeded}</div>}
      <div className="wh-msg"><Msg m={msg} /></div>
      <div className="wh-sublist">
        <b>{d.assigned}</b>
        <div className="wh-rlist">
          {list === null ? (
            <div className="wh-hint">{d.loading}</div>
          ) : typeof list === 'string' ? (
            <div className="wh-hint">{list}</div>
          ) : list.length ? (
            list.map((x) => (
              <div key={x.cat + '|' + x.sector} className="it">
                <span className="nm">
                  {d.category} <b>{+x.cat}</b> → {d.section.toLowerCase()} <b>{+x.sector}</b> <span className="wh-hint">({d.boxesCount(x.boxes)})</span>
                </span>
                <button type="button" onClick={() => remove(x.cat, x.sector)}>{d.remove}</button>
              </div>
            ))
          ) : (
            <div className="wh-hint">{d.noSectors}</div>
          )}
        </div>
      </div>
      <div className="wh-row end">
        <button type="button" onClick={closeSectorDlg}>{d.close}</button>
        <button type="button" className="wh-dark" disabled={busy} onClick={ok}>{d.assign}</button>
      </div>
    </>
  )
}

export default function Dialogs() {
  useStore()
  return (
    <>
      <AskDialog />
      <ChooseDialog />
      <ReceiptsDialog />
      <MoreDialog />
      <SectorsDialog />
    </>
  )
}
