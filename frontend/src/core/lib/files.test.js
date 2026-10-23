import test from 'node:test'
import assert from 'node:assert/strict'
import { base64Bytes, checkFile, extensionOf, formatBytes } from './files.js'

test('formatBytes: Б, КБ, МБ', () => {
  assert.equal(formatBytes(512), '512 Б')
  assert.equal(formatBytes(1536), '1,5 КБ')
  assert.equal(formatBytes(8 * 1024 * 1024), '8,0 МБ')
  assert.equal(formatBytes(-1), '—')
})

test('extensionOf: регистр, несколько точек, нет расширения', () => {
  assert.equal(extensionOf('Scan.PDF'), 'pdf')
  assert.equal(extensionOf('a.b.docx'), 'docx')
  assert.equal(extensionOf('noext'), '')
  assert.equal(extensionOf('.hidden'), '')
  assert.equal(extensionOf('end.'), '')
})

test('base64Bytes: считает байты, отвергает мусор', () => {
  for (const n of [1, 2, 3, 100, 1001]) assert.equal(base64Bytes(Buffer.alloc(n, 7).toString('base64')), n)
  assert.equal(base64Bytes(''), null)
  assert.equal(base64Bytes('abc'), null)
  assert.equal(base64Bytes('ab!d'), null)
  assert.equal(base64Bytes(5), null)
})

test('checkFile: расширение, пустой, размер', () => {
  const rules = { extensions: ['pdf', 'png'], maxBytes: 100 }
  assert.equal(checkFile({ name: 'a.PDF', size: 100 }, rules), null)
  assert.equal(checkFile({ name: 'a.exe', size: 1 }, rules), 'ext')
  assert.equal(checkFile({ name: 'a.pdf', size: 101 }, rules), 'size')
  assert.equal(checkFile({ name: 'a.pdf', size: 0 }, rules), 'empty')
})
