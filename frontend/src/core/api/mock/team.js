// Mock-слой модуля «Карта команды» (демо на Vercel). Контракт — docs/TZ-team-map.md, раздел «API».
// Все люди вымышленные. Данные in-memory и сбрасываются при перезагрузке страницы.
// Права: Team = доступ к модулю team >= view (structure — урезанная карта), HR = run на модуле hr.
import { ApiError } from '../client.js'
import strings from '../../../modules/team/strings.js'
import coreStrings from '../../strings.js'
import { data as hub } from './data.js'

const err = strings.errors

const KEY_RE = /^[a-z][a-z0-9_]{1,40}$/
const URL_RE = /^https?:\/\/\S+$/i
const FIELD_KINDS = ['text', 'textarea', 'select', 'chips', 'links', 'photo']
const LIMITS = { text: 200, textarea: 2000, select: 80, chip: 400, chips: 20, links: 5, label: 60, url: 300, comment: 500 }
const PHOTO_LIMITS = { full: 300 * 1024, thumb: 30 * 1024 }
// Значения анкеты, которые живут в колонках карточки, а не в answers
const COLUMN_KEYS = { first_name: 'firstName', last_name: 'lastName', title: 'title', email: 'email' }

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isEmpty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)
const has = (obj, key) => isObject(obj) && obj[key] !== undefined
const now = () => new Date().toISOString()
const deny = (status, message) => new ApiError(status, message)

// Вымышленные «фото»: SVG data-URL (настоящие загрузки — JPEG, проверка ниже)
const svgPhoto = (letters, bg) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='128' height='128'><rect width='128' height='128' fill='${bg}'/><text x='64' y='82' font-size='46' text-anchor='middle' fill='white' font-family='sans-serif'>${letters}</text></svg>`,
  )}`

function seed() {
  const directions = [
    { id: 'leadership', label: 'РУКОВОДСТВО', shortName: 'Руководство', color: '#A22325', avatarInk: '#FFFFFF', sort: 0 },
    { id: 'ops', label: 'ОПЕРАЦИИ', shortName: 'Операции', color: '#1D428A', avatarInk: '#FFFFFF', sort: 1 },
    { id: 'mkt', label: 'МАРКЕТИНГ', shortName: 'Маркетинг', color: '#FE5000', avatarInk: '#FFFFFF', sort: 2 },
    { id: 'buy', label: 'ЗАКУПКИ', shortName: 'Закупки', color: '#F3D03E', avatarInk: '#252120', sort: 3 },
    { id: 'hr', label: 'ПЕРСОНАЛ', shortName: 'Персонал', color: '#E59BDC', avatarInk: '#252120', sort: 4 },
  ]

  const mk = (id, lastName, firstName, title, managerId, directionId, extra = {}) => ({
    id, userId: null, email: null, lastName, firstName, title, managerId, directionId, tag: null, team: null,
    isCeo: false, isAssistant: false, showInMap: true, isArchived: false, answers: {}, sort: id, ...extra,
  })
  const people = [
    mk(1, 'Северов', 'Александр', 'CEO', null, 'leadership', { isCeo: true, email: 'ceo@example.com' }),
    mk(2, 'Лебедева', 'Мария', 'Ассистент директора и офис-менеджер', 1, 'leadership', { isAssistant: true }),
    mk(3, 'Громов', 'Павел', 'Операционный директор', 1, 'ops', {
      team: 'Логистика', email: 'pavel.gromov@example.com',
      answers: {
        location: 'Москва', work_format: 'Пятидневка в офисе',
        responsibility: 'Склад, логистика и поставки: приёмка, хранение, отгрузка и контроль сроков.',
        ask_me_about: 'Сроки поставок, складские остатки, вопросы по логистике и сертификации.',
        hobbies: ['Настольные игры', 'Бег'], telegram: 'gromov_demo',
        socials: [{ label: 'Сайт', url: 'https://example.com/gromov' }],
      },
    }),
    mk(4, 'Ершова', 'Нина', 'Руководитель склада', 3, 'ops', {
      team: 'Склад', answers: { location: 'Москва', work_format: 'Пятидневка в офисе', hobbies: ['Кроссворды'] },
    }),
    mk(5, 'Тихонов', 'Глеб', 'Старший кладовщик', 4, 'ops'),
    mk(6, 'Мельник', 'Ольга', 'Менеджер по логистике и ВЭД', 3, 'ops', { team: 'Логистика' }),
    mk(7, 'Белова', 'Инна', 'Директор по маркетингу', 1, 'mkt', {
      team: 'Маркетинг', email: 'inna.belova@example.com',
      answers: {
        location: 'Ереван', work_format: 'Гибрид',
        responsibility: 'Бренд, коммуникации и продвижение: контент, соцсети, партнёрские кампании.',
        ask_me_about: 'Брендбук, согласование макетов и кампаний, коллаборации.',
        hobbies: ['Фотография', 'Керамика', 'Йога'], telegram: 'belova_demo',
      },
    }),
    mk(8, 'Радин', 'Артём', 'SMM-менеджер', 7, 'mkt', { answers: { location: 'Ереван', telegram: 'radin_demo' } }),
    mk(9, 'Орлова', 'Вера', 'Графический дизайнер', 7, 'mkt'),
    mk(10, 'Кравцов', 'Денис', 'Руководитель закупок', 1, 'buy', {
      userId: 10, team: 'Закупки', email: 'denis.kravtsov@example.com',
      answers: {
        location: 'Москва', work_format: 'Пятидневка в офисе',
        responsibility: 'Закупки и отношения с поставщиками, планирование лотов.',
        ask_me_about: 'Условия поставщиков, статусы заказов, прайсы и скидки.',
        hobbies: ['Шахматы', 'Велосипед'], telegram: 'kravtsov_demo',
      },
    }),
    mk(11, 'Саркисян', 'Ани', 'Менеджер по закупкам', 10, 'buy', {
      userId: 3, email: 'ani@example.com',
      answers: { location: 'Ереван', work_format: 'Гибрид', telegram: 'ani_demo', hobbies: ['Танго'] },
    }),
    mk(12, 'Жуков', 'Лев', 'Аналитик закупок', 10, 'buy', { userId: 11, team: 'Аналитика' }),
    mk(13, 'Захарова', 'Полина', 'Ассистент отдела закупок', 10, 'buy', { tag: 'Закупки' }),
    mk(14, 'Фролова', 'Ирина', 'Руководитель отдела кадров', 1, 'hr', {
      userId: 9, email: 'hr@example.com', tag: 'HR', team: 'HR',
      answers: {
        location: 'Москва', work_format: 'Пятидневка в офисе',
        responsibility: 'Подбор, адаптация и кадровое делопроизводство.',
        ask_me_about: 'Отпуска, справки, онбординг, вопросы по условиям работы.',
        hobbies: ['Книжный клуб'], telegram: 'frolova_demo',
      },
    }),
    mk(15, 'Назаров', 'Тимур', 'Менеджер по персоналу', 14, 'hr', { userId: 13, tag: 'HR' }),
    // скрыт с карты: HR может включить кнопкой «Показывать в карте»
    mk(16, 'Беляев', 'Захар', 'Специалист по рекламе', 8, 'mkt', { userId: 4, email: 'wb@example.com', showInMap: false }),
  ]

  const photos = {
    1: { full: svgPhoto('СА', '#A22325'), thumb: svgPhoto('СА', '#A22325') },
    3: { full: svgPhoto('ГП', '#1D428A'), thumb: svgPhoto('ГП', '#1D428A') },
    7: { full: svgPhoto('БИ', '#FE5000'), thumb: svgPhoto('БИ', '#FE5000') },
    14: { full: svgPhoto('ФИ', '#8A5A86'), thumb: svgPhoto('ФИ', '#8A5A86') },
  }

  const f = (id, key, label, kind, extra = {}) => ({
    id, key, label, hint: null, kind, required: false, options: [], sort: id, isSystem: true, active: true, ...extra,
  })
  const fields = [
    f(1, 'first_name', 'Имя', 'text', { required: true }),
    f(2, 'last_name', 'Фамилия', 'text', { required: true }),
    f(3, 'title', 'Должность', 'text', { required: true }),
    f(4, 'manager_claim', 'Твой руководитель (ФИ)', 'text', {
      required: true, hint: 'Подсказка для HR: в карту не попадает',
    }),
    f(5, 'responsibility', 'Зона ответственности', 'textarea', { required: true }),
    f(6, 'ask_me_about', 'С чем можно обращаться', 'textarea', { required: true }),
    f(7, 'location', 'Локация', 'select', { required: true, options: ['Москва', 'Ереван'] }),
    f(8, 'work_format', 'Формат работы', 'select', { required: true, options: ['Пятидневка в офисе', 'Гибрид', 'Удалёнка'] }),
    f(9, 'telegram', 'Telegram', 'text', { required: true, hint: 'Без @' }),
    f(10, 'email', 'Корпоративная почта', 'text', { hint: 'По умолчанию — почта учётки' }),
    f(11, 'hobbies', 'Увлечения и таланты', 'chips', { required: true }),
    f(12, 'socials', 'Соцсети', 'links', { isSystem: false }),
    f(13, 'photo', 'Фото', 'photo', { required: true, sort: 14 }),
    f(14, 'video_link', 'Видеосвязь: Zoom / Яндекс Телемост', 'links', { isSystem: false, sort: 13 }),
  ]

  const submissions = [
    {
      id: 1, userId: 6, personId: null, status: 'pending', reviewComment: null, reviewedBy: null,
      createdAt: '2026-10-22T09:40:00.000Z', reviewedAt: null, photoFull: svgPhoto('НС', '#005844'), photoThumb: svgPhoto('НС', '#005844'),
      values: {
        first_name: 'Нелли', last_name: 'Саакян', title: 'Менеджер по маркетплейсам', manager_claim: 'Громов Павел',
        responsibility: 'Ведение карточек и поставок на маркетплейсах.', ask_me_about: 'Статусы поставок, остатки на складах МП.',
        location: 'Ереван', work_format: 'Гибрид', telegram: 'nelli_demo', email: 'multi@example.com', hobbies: ['Скалолазание'],
      },
    },
    {
      id: 2, userId: 3, personId: 11, status: 'pending', reviewComment: null, reviewedBy: null,
      createdAt: '2026-10-22T14:05:00.000Z', reviewedAt: null, photoFull: null, photoThumb: null,
      values: {
        first_name: 'Ани', last_name: 'Саркисян', title: 'Старший менеджер по закупкам',
        responsibility: 'Закупки бренд-лотов, переговоры с поставщиками.', ask_me_about: 'Условия лотов, сроки отгрузки.',
        location: 'Ереван', work_format: 'Гибрид', telegram: 'ani_demo', email: 'ani@example.com', hobbies: ['Танго', 'Походы'],
      },
    },
    {
      id: 3, userId: 8, personId: null, status: 'rejected', reviewComment: 'Добавьте, пожалуйста, настоящее фото лица и укажите руководителя.',
      reviewedBy: 1, createdAt: '2026-10-20T10:00:00.000Z', reviewedAt: '2026-10-21T08:30:00.000Z', photoFull: svgPhoto('СС', '#7E1A1C'), photoThumb: svgPhoto('СС', '#7E1A1C'),
      values: {
        first_name: 'Сергей', last_name: 'Ковалёв', title: 'Кладовщик', manager_claim: 'Ершова', responsibility: 'Приёмка товара.',
        ask_me_about: 'Приёмка и расхождения.', location: 'Москва', work_format: 'Пятидневка в офисе', telegram: 'kovalev_demo', hobbies: ['Рыбалка'],
      },
    },
  ]

  return { directions, people, photos, fields, submissions, nextId: { person: 17, field: 15, submission: 4 } }
}

function bytesOf(dataUrl) {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/]{8,}={0,2})$/.exec(typeof dataUrl === 'string' ? dataUrl : '')
  if (!m) throw deny(422, err.photoInvalid)
  const b64 = m[1]
  const head = atob(b64.slice(0, 8))
  if (head.charCodeAt(0) !== 0xff || head.charCodeAt(1) !== 0xd8 || head.charCodeAt(2) !== 0xff) throw deny(422, err.photoInvalid)
  return Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0)
}

function checkPhoto(photo) {
  if (!isObject(photo)) throw deny(422, err.photoInvalid)
  if (bytesOf(photo.full) > PHOTO_LIMITS.full || bytesOf(photo.thumb) > PHOTO_LIMITS.thumb) throw deny(422, err.photoTooLarge)
  return { full: photo.full, thumb: photo.thumb }
}

export function createTeamHandlers({ userFromToken, accessTo }) {
  const db = seed()
  const users = () => hub.users

  const byId = (id) => db.people.find((p) => p.id === Number(id)) ?? null
  const patchListeners = []
  const personOf = (user) =>
    db.people.find((p) => p.userId === user.id) ??
    db.people.find((p) => p.email && p.email.toLowerCase() === user.email.toLowerCase()) ??
    null
  const pendingOf = (user) => db.submissions.find((s) => s.userId === user.id && s.status === 'pending') ?? null
  const userById = (id) => users().find((u) => u.id === id) ?? null

  // ---- права ----
  const ctx = (token) => {
    const user = userFromToken(token)
    const access = accessTo(user, 'team')
    if (access === 'none') throw deny(403, err.forbidden)
    return { user, access }
  }
  const ctxFull = (token) => {
    const c = ctx(token)
    if (c.access === 'structure') throw deny(403, err.forbidden)
    return c
  }
  const ctxHr = (token) => {
    const user = userFromToken(token)
    if (accessTo(user, 'hr') !== 'run') throw deny(403, err.forbidden)
    return user
  }

  // ---- представления ----
  const name = (p) => `${p.lastName} ${p.firstName}`
  const structureOf = (p) => ({
    id: p.id, name: name(p), title: p.title, managerId: p.managerId, directionId: p.directionId, isCeo: p.isCeo, isAssistant: p.isAssistant,
  })
  // Ответы на активные НЕсистемные поля по sort; пустые пропускаются (ТЗ: PersonPub.extra)
  const extraOf = (p) =>
    sortedFields()
      // socials уже отдаётся отдельным полем PersonPub.socials, в extra не дублируется (как в backend)
      .filter((f) => f.active && !f.isSystem && f.kind !== 'photo' && f.key !== 'socials' && !isEmpty(p.answers[f.key]))
      .map((f) => ({ key: f.key, label: f.label, kind: f.kind, value: structuredClone(p.answers[f.key]) }))
  const pubOf = (p) => ({
    ...structureOf(p),
    tag: p.tag, team: p.team,
    location: p.answers.location ?? null, workFormat: p.answers.work_format ?? null,
    responsibility: p.answers.responsibility ?? null, askMeAbout: p.answers.ask_me_about ?? null,
    hobbies: [...(p.answers.hobbies ?? [])], telegram: p.answers.telegram ?? null, email: p.email,
    socials: [...(p.answers.socials ?? [])], thumb: db.photos[p.id]?.thumb ?? null, extra: extraOf(p),
  })
  const hrOf = (p) => ({
    ...pubOf(p), firstName: p.firstName, lastName: p.lastName,
    userId: p.userId, userEmail: userById(p.userId)?.email ?? null,
    showInMap: p.showInMap, isArchived: p.isArchived, hasPhoto: Boolean(db.photos[p.id]),
    directReports: db.people.filter((c) => c.managerId === p.id && !c.isArchived).length,
    answers: structuredClone(p.answers),
  })
  const directionOut = ({ id, label, shortName, color, avatarInk }) => ({ id, label, shortName, color, avatarInk })
  const valuesOf = (p, user) => ({
    first_name: p?.firstName ?? '', last_name: p?.lastName ?? '', title: p?.title ?? '',
    email: p?.email ?? user?.email ?? '', ...structuredClone(p?.answers ?? {}),
  })
  const fieldOut = (f) => ({ ...f, options: [...f.options] })
  const sortedFields = () => [...db.fields].sort((a, b) => a.sort - b.sort || a.id - b.id)
  const visiblePeople = () => db.people.filter((p) => p.showInMap && !p.isArchived).sort((a, b) => a.sort - b.sort || a.id - b.id)
  const pendingCount = () => db.submissions.filter((s) => s.status === 'pending').length

  // ---- валидация значений анкеты ----
  function cleanValue(field, v) {
    const bad = () => deny(422, err.fieldInvalid(field.label))
    const long = () => deny(422, err.fieldTooLong(field.label))
    switch (field.kind) {
      case 'text':
      case 'textarea':
      case 'select': {
        if (typeof v !== 'string') throw bad()
        const s = field.key === 'telegram' ? v.trim().replace(/^@/, '') : v.trim()
        if (s.length > LIMITS[field.kind]) throw long()
        return s
      }
      case 'chips': {
        if (!Array.isArray(v) || v.some((c) => typeof c !== 'string')) throw bad()
        const list = v.map((c) => c.trim()).filter(Boolean)
        if (list.length > LIMITS.chips || list.some((c) => c.length > LIMITS.chip)) throw long()
        return list
      }
      case 'links': {
        if (!Array.isArray(v) || v.some((l) => !isObject(l) || typeof l.label !== 'string' || typeof l.url !== 'string')) throw bad()
        if (v.length > LIMITS.links) throw long()
        return v.map((l) => {
          const link = { label: l.label.trim(), url: l.url.trim() }
          if (!URL_RE.test(link.url) || link.url.length > LIMITS.url || link.label.length > LIMITS.label) throw bad()
          return link
        })
      }
      default:
        throw bad()
    }
  }

  // requireFields — проверять обязательность (анкета сотрудника); onlyPresent — трогать только переданные ключи (правка HR)
  function cleanValues(values, { requireFields = false, onlyPresent = false, skipRequired = [] } = {}) {
    if (!isObject(values)) throw deny(422, err.invalid)
    const out = {}
    for (const field of db.fields) {
      if (field.kind === 'photo' || !field.active) continue
      if (onlyPresent && !has(values, field.key)) continue
      const v = values[field.key]
      if (isEmpty(v)) {
        if (requireFields && field.required && !skipRequired.includes(field.key)) throw deny(422, err.fieldRequired(field.label))
        if (has(values, field.key) || onlyPresent) out[field.key] = field.kind === 'chips' || field.kind === 'links' ? [] : ''
        continue
      }
      out[field.key] = cleanValue(field, v)
    }
    return out
  }

  // Перенос очищенных значений в карточку. manager_claim в карту не попадает.
  function applyValues(p, values, { replace = false } = {}) {
    for (const [key, value] of Object.entries(values)) {
      if (key === 'manager_claim') continue
      if (Object.hasOwn(COLUMN_KEYS, key)) {
        if (key === 'email') p.email = value || p.email
        else if (value) p[COLUMN_KEYS[key]] = value
      } else if (isEmpty(value)) delete p.answers[key]
      else p.answers[key] = value
    }
    if (replace) {
      for (const field of db.fields) {
        if (field.active && field.kind !== 'photo' && !Object.hasOwn(COLUMN_KEYS, field.key) && !has(values, field.key)) delete p.answers[field.key]
      }
    }
  }

  // Откат всех изменений при ошибке, чтобы запрос был атомарным
  function atomic(fn) {
    const snap = structuredClone({ people: db.people, photos: db.photos, submissions: db.submissions, nextId: db.nextId })
    try {
      return fn()
    } catch (e) {
      Object.assign(db, snap)
      throw e
    }
  }

  // ---- иерархия ----
  const isDescendant = (candidateId, ancestorId) => {
    for (let c = byId(candidateId), guard = 0; c && guard <= db.people.length; guard += 1) {
      if (c.id === ancestorId) return true
      c = c.managerId === null ? null : byId(c.managerId)
    }
    return false
  }
  function setManager(p, managerId) {
    if (managerId === null || managerId === undefined) {
      if (p.isCeo) return
      throw deny(422, err.managerRequired)
    }
    if (p.isCeo) throw deny(422, err.ceoLocked)
    const m = byId(managerId)
    if (!m || m.isArchived) throw deny(422, err.managerInvalid)
    if (m.id === p.id || isDescendant(m.id, p.id)) throw deny(422, err.cycle)
    p.managerId = m.id
  }
  const checkDirection = (id) => {
    if (typeof id !== 'string' || !db.directions.some((d) => d.id === id)) throw deny(422, err.directionRequired)
  }
  const checkEmail = (email, selfId) => {
    if (email && db.people.some((p) => p.id !== selfId && p.email && p.email.toLowerCase() === email.toLowerCase())) {
      throw deny(409, err.emailTaken)
    }
  }
  const checkUserFree = (userId, selfId) => {
    if (!userById(userId)) throw deny(422, err.unknownUser)
    if (db.people.some((p) => p.id !== selfId && p.userId === userId)) throw deny(409, err.userTaken)
  }
  const strOrNull = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)

  // Поля карточки, которые меняет только HR (и общие для create/patch)
  function applyCardFields(p, body, selfId) {
    for (const key of ['firstName', 'lastName', 'title']) {
      if (has(body, key)) {
        if (typeof body[key] !== 'string' || !body[key].trim()) throw deny(422, err.nameRequired)
        p[key] = body[key].trim()
      }
    }
    if (has(body, 'directionId')) {
      checkDirection(body.directionId)
      p.directionId = body.directionId
    }
    if (has(body, 'tag')) p.tag = strOrNull(body.tag)
    if (has(body, 'team')) p.team = strOrNull(body.team)
    if (has(body, 'email')) {
      const email = strOrNull(body.email)
      checkEmail(email, selfId)
      p.email = email
    }
    if (has(body, 'userId')) {
      if (body.userId !== null) checkUserFree(body.userId, selfId)
      p.userId = body.userId
    }
    if (has(body, 'showInMap')) p.showInMap = Boolean(body.showInMap)
    if (has(body, 'sort')) {
      if (!Number.isInteger(body.sort)) throw deny(422, err.invalid)
      p.sort = body.sort
    }
    if (has(body, 'values')) applyValues(p, cleanValues(body.values, { onlyPresent: true }))
    if (has(body, 'photo') && body.photo !== null) db.photos[p.id] = checkPhoto(body.photo)
  }

  // ---- анкета сотрудника ----
  function submissionOut(s) {
    return { id: s.id, status: s.status, reviewComment: s.reviewComment, createdAt: s.createdAt }
  }

  function saveSubmission(user, body, existing) {
    const person = personOf(user)
    const values = cleanValues(body?.values, { requireFields: true, skipRequired: person ? ['manager_claim'] : [] })
    const photo = body?.photo ? checkPhoto(body.photo) : null
    const rejected = [...db.submissions].reverse().find((x) => x.userId === user.id)
    const kept = rejected?.status === 'rejected' && rejected.photoFull ? rejected : null // фото последней отклонённой заявки
    if (!photo && !existing?.photoFull && !kept && !(person && db.photos[person.id])) throw deny(422, err.photoRequired)
    if (existing) {
      existing.values = values
      if (photo) Object.assign(existing, { photoFull: photo.full, photoThumb: photo.thumb })
      existing.createdAt = now()
      return existing
    }
    const sub = {
      id: db.nextId.submission++, userId: user.id, personId: person?.id ?? null, status: 'pending', values,
      photoFull: photo?.full ?? kept?.photoFull ?? null, photoThumb: photo?.thumb ?? kept?.photoThumb ?? null, reviewComment: null, reviewedBy: null, createdAt: now(), reviewedAt: null,
    }
    if (person && !person.userId) person.userId = user.id
    db.submissions.push(sub)
    return sub
  }

  // ---- модерация ----
  const submissionHr = (s) => {
    const person = s.personId === null ? null : byId(s.personId)
    const u = userById(s.userId)
    return {
      id: s.id, userId: s.userId, userName: u?.full_name ?? coreStrings.dash, userEmail: u?.email ?? null, personId: s.personId,
      status: s.status, createdAt: s.createdAt, reviewedAt: s.reviewedAt, reviewComment: s.reviewComment,
      values: structuredClone(s.values), hasPhoto: Boolean(s.photoFull), thumb: s.photoThumb,
      current: person ? valuesOf(person, u) : null,
    }
  }
  const findSubmission = (id) => {
    const s = db.submissions.find((x) => x.id === Number(id))
    if (!s) throw deny(404, err.submissionNotFound)
    return s
  }

  const handlers = {
    'GET /modules/team/map': ({ token }) => {
      const { access } = ctx(token)
      const people = visiblePeople()
      const used = new Set(people.map((p) => p.directionId))
      return {
        directions: db.directions.filter((d) => d.id === 'leadership' || used.has(d.id)).sort((a, b) => a.sort - b.sort).map(directionOut),
        people: people.map(access === 'structure' ? structureOf : pubOf),
      }
    },

    'GET /modules/team/hr/directions': ({ token }) => {
      ctxHr(token)
      return [...db.directions].sort((a, b) => a.sort - b.sort).map(directionOut)
    },

    'GET /modules/team/fields': ({ token }) => {
      ctxFull(token)
      return sortedFields().filter((f) => f.active).map(fieldOut)
    },

    'GET /modules/team/people/:id/photo': ({ token, params }) => {
      ctxFull(token)
      const p = byId(params.id)
      const photo = p && p.showInMap && !p.isArchived ? db.photos[p.id] : null
      if (!photo) throw deny(404, err.notFound)
      return { data: photo.full }
    },

    'GET /modules/team/me': ({ token }) => {
      const { user } = ctxFull(token)
      const person = personOf(user)
      const pending = pendingOf(user)
      const last = [...db.submissions].reverse().find((s) => s.userId === user.id) ?? null
      const draft = pending ?? (last?.status === 'rejected' ? last : null)
      return {
        person: person ? { ...pubOf(person), firstName: person.firstName, lastName: person.lastName } : null,
        values: { ...valuesOf(person, user), ...(draft ? structuredClone(draft.values) : {}) },
        submission: last ? submissionOut(last) : null,
        photo: draft?.photoFull ?? (person ? db.photos[person.id]?.full ?? null : null),
      }
    },

    'POST /modules/team/me/submission': ({ token, body }) => {
      const { user } = ctxFull(token)
      if (pendingOf(user)) throw deny(409, err.pendingExists)
      return atomic(() => {
        const sub = saveSubmission(user, body, null)
        return { id: sub.id, status: sub.status }
      })
    },

    'PATCH /modules/team/me/submission': ({ token, body }) => {
      const { user } = ctxFull(token)
      const existing = pendingOf(user)
      if (!existing) throw deny(404, err.submissionNotFound)
      return atomic(() => {
        const sub = saveSubmission(user, body, existing)
        return { id: sub.id, status: sub.status }
      })
    },

    'POST /modules/team/me/submission/cancel': ({ token }) => {
      const { user } = ctxFull(token)
      const existing = pendingOf(user)
      if (!existing) throw deny(404, err.submissionNotFound)
      db.submissions.splice(db.submissions.indexOf(existing), 1)
      return { ok: true }
    },

    // ---- HR ----
    'GET /modules/team/hr/pending-count': ({ token }) => {
      ctxHr(token)
      return { count: pendingCount() }
    },

    'GET /modules/team/hr/submissions': ({ token, query }) => {
      ctxHr(token)
      // TODO(Q-T4): в ТЗ нет значения status по умолчанию; в mock — pending
      const status = query.status ?? 'pending'
      if (!['pending', 'approved', 'rejected', 'all'].includes(status)) throw deny(422, err.invalid)
      return db.submissions
        .filter((s) => status === 'all' || s.status === status)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(submissionHr)
    },

    'GET /modules/team/hr/submissions/:id/photo': ({ token, params }) => {
      ctxHr(token)
      const s = findSubmission(params.id)
      if (!s.photoFull) throw deny(404, err.notFound)
      return { data: s.photoFull }
    },

    'POST /modules/team/hr/submissions/:id/approve': ({ token, params, body }) => {
      const reviewer = ctxHr(token)
      const sub = findSubmission(params.id)
      if (sub.status !== 'pending') throw deny(409, err.notPending)
      const b = body ?? {}
      return atomic(() => {
        let person = sub.personId === null ? null : byId(sub.personId)
        if (!person && b.personId !== undefined && b.personId !== null) {
          person = byId(b.personId)
          if (!person) throw deny(404, err.personNotFound)
          if (person.userId && person.userId !== sub.userId) throw deny(409, err.personTaken)
        }
        if (person) {
          if (has(b, 'managerId')) setManager(person, b.managerId)
        } else {
          checkDirection(b.directionId)
          if (b.managerId === null || b.managerId === undefined) throw deny(422, err.managerRequired)
          person = { id: db.nextId.person++, userId: null, email: null, lastName: '', firstName: '', title: '', managerId: null,
            directionId: b.directionId, tag: null, team: null, isCeo: false, isAssistant: false, showInMap: true, isArchived: false,
            answers: {}, sort: db.people.length + 1 }
          setManager(person, b.managerId)
          db.people.push(person)
        }
        applyValues(person, sub.values, { replace: true })
        if (!person.email) person.email = userById(sub.userId)?.email ?? null
        applyCardFields(person, { directionId: b.directionId, tag: b.tag, team: b.team, showInMap: b.showInMap }, person.id)
        if (sub.photoFull) db.photos[person.id] = { full: sub.photoFull, thumb: sub.photoThumb }
        person.userId = sub.userId
        Object.assign(sub, { status: 'approved', personId: person.id, reviewedBy: reviewer.id, reviewedAt: now(), reviewComment: null })
        return hrOf(person)
      })
    },

    'POST /modules/team/hr/submissions/:id/reject': ({ token, params, body }) => {
      const reviewer = ctxHr(token)
      const sub = findSubmission(params.id)
      if (sub.status !== 'pending') throw deny(409, err.notPending)
      const comment = typeof body?.comment === 'string' ? body.comment.trim() : ''
      if (!comment || comment.length > LIMITS.comment) throw deny(422, err.commentRequired)
      Object.assign(sub, { status: 'rejected', reviewComment: comment, reviewedBy: reviewer.id, reviewedAt: now() })
      return submissionHr(sub)
    },

    'GET /modules/team/hr/people': ({ token }) => {
      ctxHr(token)
      return [...db.people].sort((a, b) => a.sort - b.sort || a.id - b.id).map(hrOf)
    },

    'GET /modules/team/hr/users': ({ token }) => {
      ctxHr(token)
      return users()
        .filter((u) => u.is_active)
        .map((u) => ({ id: u.id, fullName: u.full_name, email: u.email, personId: personOf(u)?.id ?? null }))
    },

    'POST /modules/team/hr/people': ({ token, body }) => {
      ctxHr(token)
      const b = body ?? {}
      return atomic(() => {
        for (const key of ['firstName', 'lastName', 'title']) {
          if (typeof b[key] !== 'string' || !b[key].trim()) throw deny(422, err.nameRequired)
        }
        checkDirection(b.directionId)
        const p = { id: db.nextId.person++, userId: null, email: null, lastName: '', firstName: '', title: '', managerId: null,
          directionId: b.directionId, tag: null, team: null, isCeo: false, isAssistant: false, showInMap: true, isArchived: false,
          answers: {}, sort: db.people.reduce((m, x) => Math.max(m, x.sort), 0) + 1 }
        setManager(p, b.managerId)
        applyCardFields(p, b, p.id)
        db.people.push(p)
        return hrOf(p)
      })
    },

    'PATCH /modules/team/hr/people/:id': ({ token, params, body }) => {
      const actor = ctxHr(token)
      const p = byId(params.id)
      if (!p) throw deny(404, err.personNotFound)
      const b = body ?? {}
      const before = { title: p.title, managerId: p.managerId, directionId: p.directionId, isArchived: p.isArchived }
      const result = atomic(() => {
        if (p.isCeo && ((has(b, 'managerId') && b.managerId !== null) || b.isArchived === true)) throw deny(422, err.ceoLocked)
        if (has(b, 'managerId')) setManager(p, b.managerId)
        applyCardFields(p, b, p.id)
        if (b.isArchived === true && !p.isArchived) {
          const reports = db.people.filter((c) => c.managerId === p.id && !c.isArchived)
          if (reports.length > 0) {
            if (b.reassignTo === undefined || b.reassignTo === null) throw deny(409, err.reassignFirst)
            const target = byId(b.reassignTo)
            if (!target || target.isArchived || target.id === p.id || isDescendant(target.id, p.id)) throw deny(422, err.reassignInvalid)
            reports.forEach((c) => {
              c.managerId = target.id
            })
          }
          p.isArchived = true
        } else if (b.isArchived === false) p.isArchived = false
        return hrOf(p)
      })
      // наблюдатели (автозапись истории в hrOps.js) вызываются только после успешного атомарного обновления
      patchListeners.forEach((fn) => fn({ person: p, before, actor }))
      return result
    },

    'GET /modules/team/hr/people/:id/photo': ({ token, params }) => {
      ctxHr(token)
      const photo = db.photos[Number(params.id)]
      if (!photo) throw deny(404, err.notFound)
      return { data: photo.full }
    },

    'GET /modules/team/hr/fields': ({ token }) => {
      ctxHr(token)
      return sortedFields().map(fieldOut)
    },

    'POST /modules/team/hr/fields': ({ token, body }) => {
      ctxHr(token)
      const b = body ?? {}
      if (typeof b.key !== 'string' || !KEY_RE.test(b.key)) throw deny(422, err.fieldKeyInvalid)
      if (typeof b.label !== 'string' || !b.label.trim()) throw deny(422, err.fieldLabelRequired)
      if (!FIELD_KINDS.includes(b.kind)) throw deny(422, err.fieldKindInvalid)
      if (b.kind === 'photo') throw deny(422, err.fieldPhotoSystem)
      if (db.fields.some((f) => f.key === b.key)) throw deny(409, err.fieldKeyDuplicate)
      const options = Array.isArray(b.options) ? b.options.filter((o) => typeof o === 'string' && o.trim()).map((o) => o.trim()) : []
      const field = {
        id: db.nextId.field++, key: b.key, label: b.label.trim(), hint: strOrNull(b.hint), kind: b.kind, required: Boolean(b.required),
        options: b.kind === 'select' ? options : [], sort: db.fields.reduce((m, f) => Math.max(m, f.sort), 0) + 1, isSystem: false, active: true,
      }
      db.fields.push(field)
      return fieldOut(field)
    },

    // reorder объявлен раньше :id — иначе mock-транспорт сопоставит «reorder» как id
    'PATCH /modules/team/hr/fields/reorder': ({ token, body }) => {
      ctxHr(token)
      const ids = body?.ids
      if (!Array.isArray(ids) || new Set(ids).size !== ids.length || !ids.every((id) => db.fields.some((f) => f.id === id))) {
        throw deny(422, err.invalid)
      }
      const rest = sortedFields().filter((f) => !ids.includes(f.id))
      ;[...ids.map((id) => db.fields.find((f) => f.id === id)), ...rest].forEach((f, i) => {
        f.sort = i + 1
      })
      return sortedFields().map(fieldOut)
    },

    'PATCH /modules/team/hr/fields/:id': ({ token, params, body }) => {
      ctxHr(token)
      const field = db.fields.find((f) => f.id === Number(params.id))
      if (!field) throw deny(404, err.fieldNotFound)
      const b = body ?? {}
      if ((has(b, 'key') && b.key !== field.key) || (has(b, 'kind') && b.kind !== field.kind)) throw deny(422, err.fieldImmutable)
      if (field.isSystem && b.active === false) throw deny(422, err.fieldSystemHide)
      if (has(b, 'label') && (typeof b.label !== 'string' || !b.label.trim())) throw deny(422, err.fieldLabelRequired)
      if (has(b, 'sort') && !Number.isInteger(b.sort)) throw deny(422, err.invalid)
      if (has(b, 'options') && !(Array.isArray(b.options) && b.options.every((o) => typeof o === 'string'))) throw deny(422, err.invalid)
      if (has(b, 'label')) field.label = b.label.trim()
      if (has(b, 'hint')) field.hint = strOrNull(b.hint)
      if (has(b, 'required')) field.required = Boolean(b.required)
      if (has(b, 'options')) field.options = b.options.map((o) => o.trim()).filter(Boolean)
      if (has(b, 'sort')) field.sort = b.sort
      if (has(b, 'active')) field.active = Boolean(b.active)
      return fieldOut(field)
    },
  }

  // Бейджи модулей для /core/me: только ненулевые. Ядро ничего не знает про конкретные модули.
  const moduleBadges = (user) => {
    const badges = {}
    if (accessTo(user, 'hr') === 'run') {
      const count = pendingCount()
      if (count > 0) badges.hr = count
    }
    return badges
  }

  // people/personOf/byId — для mock-слоя HR (hr.js): отпуска привязаны к карточкам и иерархии
  // onPersonPatched(fn) — fn({ person, before, actor }) после успешного PATCH карточки HR (для автозаписи истории)
  return {
    handlers, moduleBadges, people: () => db.people, personOf, byId, directions: () => db.directions,
    onPersonPatched: (fn) => patchListeners.push(fn),
  }
}
