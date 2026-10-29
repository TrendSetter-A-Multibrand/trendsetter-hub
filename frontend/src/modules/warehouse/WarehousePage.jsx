import { useEffect } from 'react'
import { Alert } from 'antd'
import { canRun, canSeeData } from '../../core/access.js'
import NoDataAccess from '../../core/pages/NoDataAccess.jsx'
import { S, boot, flush, refreshPalCache, pollPlan, focusScan } from './store.js'
import strings from './strings.js'
import Header from './components/Header.jsx'
import PlanPanel from './components/PlanPanel.jsx'
import Target, { Counters, ScanInput } from './components/ScanArea.jsx'
import SidePanel from './components/SidePanel.jsx'
import ClosedTable from './components/ClosedTable.jsx'
import Dialogs from './components/Dialogs.jsx'
import { useStore } from './components/useStore.js'
import './warehouse.css'

const u = strings.page

function Receiving({ module }) {
  useStore()
  const { cfg } = S
  useEffect(() => {
    boot()
    const iFlush = setInterval(flush, 3000)
    const iPal = setInterval(refreshPalCache, 30000)
    const iPlan = setInterval(pollPlan, 30000)
    const dialogOpen = () => Boolean(S.ui.ask || S.ui.choose || S.ui.receipts || S.ui.more || S.ui.sectors || S.wb)
    // любая печатная клавиша возвращает фокус в поле сканера, как в исходном приложении
    const onKey = (e) => {
      const a = document.activeElement
      if (dialogOpen()) return
      if (!(a && (a.tagName === 'SELECT' || a.tagName === 'INPUT')) && e.key.length === 1 && !e.ctrlKey && !e.altKey) focusScan()
    }
    const onClick = (e) => {
      if (!['SELECT', 'INPUT', 'OPTION', 'BUTTON'].includes(e.target.tagName)) setTimeout(focusScan, 0)
    }
    const onUnload = (e) => {
      if (S.q.length) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('click', onClick)
    window.addEventListener('beforeunload', onUnload)
    focusScan()
    return () => {
      clearInterval(iFlush)
      clearInterval(iPal)
      clearInterval(iPlan)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('click', onClick)
      window.removeEventListener('beforeunload', onUnload)
    }
  }, [])

  return (
    <div className={`wh${cfg.cz ? ' cz' : ''}${cfg.noCz ? ' nocz' : ''}`}>
      <Header module={module} />
      <div className="wh-czbar">{u.czBar}</div>
      <div className="wh-noczbar">{u.noCzBar}</div>
      <PlanPanel />
      <ScanInput />
      <Counters />
      <div className="wh-main">
        <Target />
        <SidePanel />
      </div>
      <ClosedTable />
      <Dialogs />
    </div>
  )
}

export default function WarehousePage({ module, access }) {
  if (!canSeeData(access)) return <NoDataAccess />
  if (!canRun(access)) return <Alert type="info" showIcon title={u.noRun} />
  return <Receiving module={module} />
}
