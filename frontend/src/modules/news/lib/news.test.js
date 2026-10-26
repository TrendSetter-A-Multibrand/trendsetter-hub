import test from 'node:test'
import assert from 'node:assert/strict'
import { HIDDEN_BANNER_KEY, canReadNews, excerpt, fromLocalInput, hideBanner, isBannerHidden, isNewsEditor, toLocalInput } from './news.js'

test('isNewsEditor: ответственный и админ — да; superuser без права и сотрудник — нет', () => {
  assert.equal(isNewsEditor({ module_responsible: { news: true }, can_manage_users: false }), true)
  assert.equal(isNewsEditor({ module_responsible: {}, can_manage_users: true }), true)
  assert.equal(isNewsEditor({ access_level: 'superuser', module_responsible: { news: false }, can_manage_users: false }), false)
  assert.equal(isNewsEditor({ access_level: 'employee', module_responsible: {}, can_manage_users: false }), false)
  assert.equal(isNewsEditor(null), false)
})

test('canReadNews: viewer (structure) и none — нет; view и run — да', () => {
  const me = (news) => ({ module_access: { news } })
  assert.equal(canReadNews(me('structure')), false)
  assert.equal(canReadNews(me('none')), false)
  assert.equal(canReadNews(me('view')), true)
  assert.equal(canReadNews(me('run')), true)
  assert.equal(canReadNews({ module_access: {} }), false)
})

test('toLocalInput / fromLocalInput: обратимость и пустые значения', () => {
  assert.equal(toLocalInput('2026-11-07T05:00:00+00:00') === toLocalInput(new Date('2026-11-07T05:00:00Z').toISOString()), true)
  assert.match(toLocalInput('2026-11-07T05:00:00Z'), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  const local = '2026-11-07T09:30'
  assert.equal(toLocalInput(fromLocalInput(local)), local)
  assert.equal(fromLocalInput(local).endsWith('Z'), true)
  assert.equal(fromLocalInput(''), null)
  assert.equal(fromLocalInput(null), null)
  assert.equal(fromLocalInput('мусор'), null)
  assert.equal(toLocalInput(null), '')
  assert.equal(toLocalInput('мусор'), '')
})

test('excerpt: короткий текст без «…», длинный обрезается', () => {
  assert.equal(excerpt('коротко', 160), 'коротко')
  assert.equal(excerpt('а'.repeat(160), 160), 'а'.repeat(160))
  assert.equal(excerpt('а'.repeat(161), 160), `${'а'.repeat(160)}…`)
  assert.equal(excerpt(null), '')
})

test('isBannerHidden / hideBanner: фейковый storage', () => {
  const data = {}
  const storage = { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v } }
  assert.equal(isBannerHidden(storage, 5), false)
  hideBanner(storage, 5)
  assert.equal(data[HIDDEN_BANNER_KEY], '5')
  assert.equal(isBannerHidden(storage, 5), true)
  assert.equal(isBannerHidden(storage, 6), false)
})

test('isBannerHidden / hideBanner: storage бросает исключение — наружу не выходит', () => {
  const broken = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
  assert.equal(isBannerHidden(broken, 5), false)
  assert.doesNotThrow(() => hideBanner(broken, 5))
})
