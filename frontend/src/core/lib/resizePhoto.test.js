import test from 'node:test'
import assert from 'node:assert/strict'
import { dataUrlBytes, fitSize } from './resizePhoto.js'

test('fitSize: уменьшает по большей стороне и не увеличивает', () => {
  assert.deepEqual(fitSize(2048, 1024, 512), { width: 512, height: 256 })
  assert.deepEqual(fitSize(1000, 4000, 512), { width: 128, height: 512 })
  assert.deepEqual(fitSize(300, 200, 512), { width: 300, height: 200 })
})

test('dataUrlBytes: считает байты base64 с учётом паддинга', () => {
  const url = (n) => `data:image/jpeg;base64,${Buffer.alloc(n, 1).toString('base64')}`
  for (const n of [1, 2, 3, 100, 1001]) assert.equal(dataUrlBytes(url(n)), n)
})
