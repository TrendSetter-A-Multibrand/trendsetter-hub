import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Avatar from './Avatar.jsx'
import strings from '../strings.js'
import { cardState, isOpen } from '../lib/tree.js'
import { layoutScheme, zoomAt } from '../lib/scheme.js'

const s = strings.scheme
const pn = strings.panel
const RED = '#A22325'
const LINE = '#D3CCC9'
const clampZoom = (z) => Math.min(1.5, Math.max(0.3, Math.round(z * 10) / 10))
const canFullscreen = typeof document !== 'undefined' && !!document.documentElement.requestFullscreen

export default function SchemeView({ idx, selectedId, matches, path, collapsed, forceOpen, dirFilter, onSelect, onToggle, children }) {
  const { by, ceoId, assistantIds, dirs } = idx
  const [zoom, setZoom] = useState(0.8)
  const scrollRef = useRef(null)
  const wrapRef = useRef(null)
  const zoomRef = useRef(zoom)
  const pendingScroll = useRef(null)
  const [isFull, setIsFull] = useState(false)
  const drag = useRef(null)

  // раскладка зависит только от данных/сворачивания/фильтра, не от выделения
  const layout = useMemo(
    () => layoutScheme({ by, ceoId, assistantIds, dirs, dirFilter, open: (id) => isOpen(id, collapsed, forceOpen) }),
    [by, ceoId, assistantIds, dirs, dirFilter, collapsed, forceOpen],
  )
  const layoutRef = useRef(layout)
  useLayoutEffect(() => {
    layoutRef.current = layout
  }, [layout])

  const fit = useCallback(() => {
    const el = scrollRef.current
    const { rawW, ceoCx } = layoutRef.current
    if (!el || !rawW) return
    const z = Math.round(Math.max(0.55, Math.min(1, (el.clientWidth - 40) / rawW)) * 100) / 100
    setZoom(z)
    requestAnimationFrame(() => {
      el.scrollLeft = Math.max(0, ceoCx * z - el.clientWidth / 2)
      el.scrollTop = 0
    })
  }, [])

  useLayoutEffect(() => {
    zoomRef.current = zoom
    const el = scrollRef.current
    const p = pendingScroll.current
    if (el && p) {
      el.scrollLeft = p.left
      el.scrollTop = p.top
    }
    pendingScroll.current = null
  }, [zoom])

  // авто-подбор масштаба при входе в схему и при смене фильтра направления
  useLayoutEffect(() => {
    fit()
  }, [fit, dirFilter])

  // полный экран: при входе и выходе пересчитываем масштаб под новую ширину контейнера
  useEffect(() => {
    const onChange = () => {
      setIsFull(document.fullscreenElement === wrapRef.current)
      requestAnimationFrame(fit)
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [fit])

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.()
    else wrapRef.current?.requestFullscreen?.()
  }

  // Ctrl+колесо / pinch: масштаб схемы к курсору, масштаб страницы браузера не меняется
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return undefined
    const onWheel = (e) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const next = zoomAt({
        zoom: zoomRef.current,
        delta: e.deltaY < 0 ? 0.1 : -0.1,
        scrollLeft: el.scrollLeft,
        scrollTop: el.scrollTop,
        px: e.clientX - r.left,
        py: e.clientY - r.top,
      })
      if (next.zoom === zoomRef.current) return
      pendingScroll.current = { left: next.scrollLeft, top: next.scrollTop }
      setZoom(next.zoom)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    const move = (e) => {
      const el = scrollRef.current
      const d = drag.current
      if (!d || !el) return
      const dx = e.clientX - d.x
      const dy = e.clientY - d.y
      if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true
      el.scrollLeft = d.sl - dx
      el.scrollTop = d.st - dy
    }
    const up = () => {
      const el = scrollRef.current
      if (el) el.style.cursor = ''
      // moved сбрасываем после click, который придёт следом за mouseup
      setTimeout(() => {
        drag.current = null
      }, 0)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [])

  const onPanStart = (e) => {
    const el = scrollRef.current
    if (e.button !== 0 || !el) return
    drag.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop, moved: false }
    el.style.cursor = 'grabbing'
  }

  const state = { selectedId, matches, path }
  const edges = useMemo(() => {
    const withOn = layout.edges.map((e) => ({ ...e, on: path.has(e.to) }))
    // красные рисуются последними, поверх общих стволов
    return [...withOn.filter((e) => !e.on), ...withOn.filter((e) => e.on)]
  }, [layout, path])
  const { rawW, rawH } = layout

  return (
    <div className="tm-scheme-wrap" ref={wrapRef}>
      <div
        className="tm-scheme"
        ref={scrollRef}
        onMouseDown={onPanStart}
        onClickCapture={(e) => {
          if (drag.current?.moved) e.stopPropagation()
        }}
      >
        <div className="tm-scheme-size" style={{ width: Math.ceil(rawW * zoom), height: Math.ceil(rawH * zoom) }}>
          <div className="tm-scheme-layer" style={{ width: rawW, height: rawH, transform: `scale(${zoom})` }}>
            {layout.zones.map((z) => (
              <div key={z.id} className="tm-zone" style={{ left: z.x, top: z.y, width: z.w, height: z.h, background: z.bg, border: `1px solid ${z.border}` }}>
                <div className="mono tm-zone-label">
                  <span className="tm-zone-bar" style={{ background: z.color }} />
                  <span className="tm-zone-name">{z.label}</span>
                  <span className="tm-zone-count">{z.count}</span>
                </div>
              </div>
            ))}
            <svg className="tm-edges" width={rawW} height={rawH}>
              {edges.map((e) => {
                const color = e.on ? RED : LINE
                return (
                  <g key={`${e.from}-${e.to}`}>
                    <path d={e.d} style={{ fill: 'none', stroke: color, strokeWidth: e.on ? 2 : 1.5, strokeLinejoin: 'round' }} />
                    <path d={e.a} style={{ fill: color }} />
                  </g>
                )
              })}
            </svg>
            {layout.assistants.map((a) => (
              <div key={a.id}>
                <div className="tm-asst-line" style={{ left: a.lx, top: a.ly, width: a.lw }} />
                <span className="mono tm-asst-cap" style={{ left: a.lx, top: a.ty, width: a.lw }}>
                  {strings.hero.assistant}
                </span>
              </div>
            ))}
            {layout.nodes.map((n) => {
              const p = by[n.id]
              const cs = cardState(n.id, state)
              return (
                <div
                  key={n.id}
                  className={`tm-sn${cs.mark ? ` is-${cs.mark}` : ''}${cs.dim ? ' is-dim' : ''}`}
                  style={{ left: n.x, top: n.y, '--c': p.av.bg }}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(n.id)}
                  onKeyDown={(e) => {
                    if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault()
                      onSelect(n.id)
                    }
                  }}
                >
                  <Avatar person={p} size={32} font={11} />
                  <div className="tm-sn-text">
                    <span className="tm-sn-name">{p.name}</span>
                    <span className="tm-sn-title">{p.title}</span>
                  </div>
                  {n.expandable && (
                    <button
                      type="button"
                      className="mono tm-sn-toggle"
                      title={n.open ? pn.collapse : pn.expand}
                      aria-label={n.open ? pn.collapse : pn.expand}
                      aria-expanded={n.open}
                      onClick={(e) => {
                        e.stopPropagation()
                        onToggle(n.id)
                      }}
                    >
                      {n.open ? `${p.total} ▾` : `+${p.total} ▸`}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
      <div className="tm-zoom" role="group" aria-label={s.zoomLabel}>
        <button type="button" className="tm-zoom-step" aria-label={s.zoomOut} onClick={() => setZoom((z) => clampZoom(z - 0.1))}>
          −
        </button>
        <span className="mono tm-zoom-val">{Math.round(zoom * 100)}%</span>
        <button type="button" className="tm-zoom-step" aria-label={s.zoomIn} onClick={() => setZoom((z) => clampZoom(z + 0.1))}>
          +
        </button>
        {canFullscreen && (
          <button type="button" className="tm-zoom-fit" onClick={toggleFullscreen}>
            {isFull ? s.exitFullscreen : s.fullscreen}
          </button>
        )}
      </div>
      {children}
    </div>
  )
}
