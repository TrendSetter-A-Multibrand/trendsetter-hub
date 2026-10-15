import { useEffect, useRef, useSyncExternalStore } from 'react'
import { subscribe, getVersion } from '../store.js'

// Перерисовка по изменению состояния склада (состояние живёт в store.js, как в исходном приложении)
export const useStore = () => useSyncExternalStore(subscribe, getVersion)

// Нативный <dialog>: открывается/закрывается по флагу open
export function useDialog(open, onEsc) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])
  return { ref, onCancel: (e) => { e.preventDefault(); onEsc() } }
}
