// Code128 для этикеток 58×40. Перенесено из Index.html без изменений.
const P128 =
  '212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112'.split(
    ' ',
  )

export function c128codes(s) {
  const codes = []
  let mode = null
  let i = 0
  const isD = (c) => c >= '0' && c <= '9'
  const run = (k) => {
    let n = 0
    while (k + n < s.length && isD(s[k + n])) n++
    return n
  }
  while (i < s.length) {
    const r = run(i)
    const useC = r >= 4 || (mode === 'C' && r >= 2) || (mode === null && r >= 2 && r === s.length - i && r % 2 === 0)
    if (useC) {
      if (r % 2 === 1 && mode !== 'C') {
        if (mode === null) {
          codes.push(104)
          mode = 'B'
        }
        codes.push(s.charCodeAt(i) - 32)
        i++
        continue
      }
      const n = r - (r % 2)
      if (mode === null) {
        codes.push(105)
        mode = 'C'
      } else if (mode !== 'C') {
        codes.push(99)
        mode = 'C'
      }
      for (let k = 0; k < n; k += 2) codes.push(parseInt(s.substr(i + k, 2), 10))
      i += n
    } else {
      if (mode === null) {
        codes.push(104)
        mode = 'B'
      } else if (mode !== 'B') {
        codes.push(100)
        mode = 'B'
      }
      const cc = s.charCodeAt(i)
      if (cc < 32 || cc > 127) throw new Error('Недопустимый символ')
      codes.push(cc - 32)
      i++
    }
  }
  let sum = codes[0]
  for (let j = 1; j < codes.length; j++) sum += codes[j] * j
  codes.push(sum % 103)
  codes.push(106)
  return codes
}

export function c128svg(s, quiet) {
  const w = c128codes(s)
    .map((c) => P128[c])
    .join('')
  const q = quiet || 10
  let x = q
  let rects = ''
  for (let i = 0; i < w.length; i++) {
    const m = +w[i]
    if (i % 2 === 0) rects += `<rect x="${x}" y="0" width="${m}" height="50"/>`
    x += m
  }
  return `<svg viewBox="0 0 ${x + q} 50" preserveAspectRatio="none" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg"><g fill="#000">${rects}</g></svg>`
}
