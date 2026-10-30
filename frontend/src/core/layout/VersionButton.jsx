import { useState } from 'react'
import { Modal } from 'antd'
import { CHANGELOG, CURRENT_VERSION } from '../changelog.js'
import strings from '../strings.js'

const s = strings.version

const GROUPS = [
  ['added', s.added],
  ['changed', s.changed],
  ['fixed', s.fixed],
]

// Кнопка с версией хаба в верхней строке; по клику — окно «Что нового».
export default function VersionButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="version-btn" aria-label={`${s.title}. ${s.versionLabel(CURRENT_VERSION)}`} onClick={() => setOpen(true)}>
        v {CURRENT_VERSION}
      </button>
      <Modal title={s.title} open={open} onCancel={() => setOpen(false)} footer={null} destroyOnHidden>
        <div className="changelog">
          {CHANGELOG.map((r) => (
            <section key={r.version} className="changelog-release">
              <div className="changelog-head mono">
                <strong>v {r.version}</strong> <span>{r.date}</span>
              </div>
              {GROUPS.filter(([k]) => r[k]?.length).map(([k, label]) => (
                <div key={k}>
                  <div className="changelog-group mono">{label}</div>
                  <ul>
                    {r[k].map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ))}
        </div>
      </Modal>
    </>
  )
}
