// Этикетки 58×40 (термопринтер). Вёрстка и шрифты намеренно как в исходном приложении: Arial, мм, без веб-шрифтов.
import { esc } from './format.js'
import { c128svg } from './code128.js'

export const PRINT_CSS = `@page{size:58mm 40mm;margin:0}html,body{margin:0;background:#fff}
.label{width:58mm;height:40mm;padding:2mm 3mm;box-sizing:border-box;overflow:hidden;page-break-after:always;break-after:page;display:flex;flex-direction:column;justify-content:space-between;color:#000;font-family:Arial,sans-serif}
.label .l1{display:flex;justify-content:space-between;align-items:baseline;font-size:10pt;font-weight:700}.label .cellno{font-size:24pt;font-weight:900;line-height:1}
.label .nums{display:flex;gap:5mm}.label .nums div{display:flex;flex-direction:column;align-items:center;line-height:1}
.label .nums b{font-size:22pt;font-weight:900}.label .nums span{font-size:6.5pt;font-weight:700;margin-top:1mm}
.label svg{width:52mm}.label .sp{font-size:9pt;font-weight:900;line-height:1.15;text-align:right}
.plabel{width:58mm;height:40mm;padding:1.5mm 1.5mm;box-sizing:border-box;overflow:hidden;page-break-after:always;break-after:page;display:flex;flex-direction:column;justify-content:space-between;color:#000;font-family:Arial,sans-serif}
.plabel .l1{display:flex;justify-content:space-between;font-size:8pt;font-weight:700;padding:0 1.5mm}
.plabel svg{width:55mm;height:13mm;display:block;margin:0 auto}.plabel .hr{text-align:center;font-size:8pt;font-weight:700}
.plabel .tail{text-align:center;font-size:34pt;font-weight:900;line-height:.95}
.plabel .pal{display:flex;align-items:baseline;justify-content:center;gap:3mm;line-height:.9}.plabel .pw{font-size:16pt;font-weight:900}.plabel .pn{font-size:44pt;font-weight:900}
.plabel svg{height:9mm}
.label svg{width:52mm;height:11mm;display:block;margin:0 auto}.label .hr{text-align:center;font-size:8pt;font-weight:700;letter-spacing:.3px}
.label .tail{text-align:center;font-size:36pt;font-weight:900;line-height:.95;letter-spacing:1px}`

// ШК закрытого короба: S01_K01_P1_0014 — секция, категория, палет, номер. Им же короб называется в таблице.
export function labelHTML(r, s) {
  const cnt = r.count != null ? r.count : r.items ? r.items.length : null
  const st = r.storage
  const lc = r.code
  const num = lc.split('_').pop().slice(-4)
  const top = st
    ? `<div class="nums"><div><b>${+st.sector}</b><span>${s.labelSection}</span></div><div><b>${st.pallet}</b><span>${s.labelPallet}</span></div></div>`
    : `<div class="nums"><div><b>${+r.box || esc(r.box)}</b><span>${s.labelCategoryCaps}</span></div><div><b style="font-size:11pt">${s.labelOpen}</b></div></div>`
  return `<div class="label">
    <div class="l1">${top}<span class="sp">${s.labelCategory} ${+r.box || esc(r.box)}<br>${cnt !== null && st ? cnt + ' ' + s.pcs : ''}</span></div>
    ${c128svg(lc, 8)}
    <div class="hr">${esc(lc)}</div>
    <div class="tail">${esc(num)}</div>
  </div>`
}

// Этикетка палета хранения — печатается второй, сразу после этикетки короба
export function storLabelHTML(st, s) {
  return `<div class="plabel">
    <div class="l1"><span>${s.labelSection} ${+st.sector}</span><span>${s.labelPlace(st.pos, st.cap)}</span></div>
    <div class="pal"><span class="pw">${s.labelPallet}</span><span class="pn">${st.pallet}</span></div>
    ${c128svg(st.code, 8)}
    <div class="hr">${esc(st.code)}</div>
  </div>`
}

export function printHTML(html, s, onDone) {
  const w = window.open('', '_blank', 'width=420,height=360')
  if (w) {
    w.document.open()
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${s.labelsTitle}</title><style>${PRINT_CSS}</style></head><body>${html}</body></html>`)
    w.document.close()
    setTimeout(() => {
      w.focus()
      w.print()
      w.close()
      onDone()
    }, 300)
  } else {
    // всплывающие окна запрещены — печатаем прямо со страницы
    let el = document.getElementById('whf-print')
    if (!el) {
      el = document.createElement('div')
      el.id = 'whf-print'
      document.body.appendChild(el)
    }
    el.innerHTML = `<style>#whf-print{display:none}@media print{body>*:not(#whf-print){display:none!important}#whf-print{display:block}${PRINT_CSS}}</style>${html}`
    setTimeout(() => {
      window.print()
      onDone()
    }, 50)
  }
}
