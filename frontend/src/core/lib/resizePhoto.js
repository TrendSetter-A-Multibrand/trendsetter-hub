// Уменьшение фото в браузере (canvas -> JPEG) перед отправкой: full <= 512px (<= 300 КБ), thumb 128x128 (<= 30 КБ).
// Контракт и лимиты — docs/TZ-team-map.md, решение 8. Сервер проверяет те же лимиты.
export const FULL_MAX_SIDE = 512
export const THUMB_SIDE = 128
export const FULL_MAX_BYTES = 300 * 1024
export const THUMB_MAX_BYTES = 30 * 1024

// Размер с сохранением пропорций так, чтобы большая сторона не превышала max (увеличивать не нужно)
export function fitSize(width, height, max) {
  const k = Math.min(1, max / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) }
}

// Размер декодированных данных base64 data-URL в байтах
export function dataUrlBytes(dataUrl) {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.floor((b64.length * 3) / 4) - pad
}

// Кодирует canvas в JPEG, снижая качество, пока не влезет в лимит; null — не влезло даже при минимальном качестве
function encode(canvas, maxBytes) {
  for (let quality = 0.9; quality >= 0.3; quality -= 0.1) {
    const url = canvas.toDataURL('image/jpeg', quality)
    if (dataUrlBytes(url) <= maxBytes) return url
  }
  return null
}

function draw(bitmap, sx, sy, sw, sh, width, height) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff' // JPEG без прозрачности
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, width, height)
  return canvas
}

// file: File/Blob с картинкой -> { full, thumb } (data:image/jpeg;base64,...). Бросает Error('decode' | 'size').
export async function resizePhoto(file) {
  let bitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('decode')
  }
  const { width: w, height: h } = bitmap
  const fullSize = fitSize(w, h, FULL_MAX_SIDE)
  const full = encode(draw(bitmap, 0, 0, w, h, fullSize.width, fullSize.height), FULL_MAX_BYTES)
  // превью — квадрат по центру (аватар круглый)
  const side = Math.min(w, h)
  const thumb = encode(draw(bitmap, (w - side) / 2, (h - side) / 2, side, side, THUMB_SIDE, THUMB_SIDE), THUMB_MAX_BYTES)
  bitmap.close?.()
  if (!full || !thumb) throw new Error('size')
  return { full, thumb }
}
