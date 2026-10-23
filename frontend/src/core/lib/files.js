// Файлы в base64: чистые функции (тестируются в Node) и браузерные обёртки (FileReader, Blob, скачивание).

export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n < 1024) return `${n} Б`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1).replace('.', ',')} КБ`
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} МБ`
}

// Расширение в нижнем регистре без точки; нет расширения -> ''
export function extensionOf(fileName) {
  const name = String(fileName ?? '')
  const i = name.lastIndexOf('.')
  return i <= 0 || i === name.length - 1 ? '' : name.slice(i + 1).toLowerCase()
}

// Размер данных (байты) по строке base64 без декодирования; невалидная строка -> null
export function base64Bytes(b64) {
  if (typeof b64 !== 'string' || b64.length === 0 || b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) return null
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return (b64.length / 4) * 3 - padding
}

// null, если файл подходит, иначе код проблемы: 'ext' | 'size' | 'empty'
export function checkFile({ name, size }, { extensions, maxBytes }) {
  if (!extensions.includes(extensionOf(name))) return 'ext'
  if (size === 0) return 'empty'
  if (size > maxBytes) return 'size'
  return null
}

// File -> Promise<строка base64 без префикса data:...>
export function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.readAsDataURL(file)
  })
}

export function base64ToBlob(b64, mime) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime || 'application/octet-stream' })
}

// Скачивание через временную ссылку
export function downloadBase64({ fileName, mime, dataBase64 }) {
  const url = URL.createObjectURL(base64ToBlob(dataBase64, mime))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
