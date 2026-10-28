import { useEffect, useState } from 'react'
import { api } from '../../../core/api/index.js'

// Лента главной: GET /modules/news/feed. Колонки «Новости» и «События» грузят её независимо (два лёгких запроса).
// replace(updated) подменяет запись из ответа сервера (после RSVP) в обеих лентах.
export function useFeed() {
  const [feed, setFeed] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    api
      .get('/modules/news/feed')
      .then((result) => alive && setFeed(result))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [])

  const replace = (updated) =>
    setFeed((f) => ({ events: f.events.map((e) => (e.id === updated.id ? updated : e)), news: f.news.map((n) => (n.id === updated.id ? updated : n)) }))

  return { feed, failed, replace }
}
