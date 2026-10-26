import { useEffect, useState } from 'react'
import { api } from '../../../core/api/index.js'
import { hideBanner, isBannerHidden } from '../lib/news.js'
import strings from '../strings.js'
import '../news.css'

const s = strings.banner

// localStorage может быть недоступен (режим приватности, запрет) — тогда плашка просто не запоминает скрытие
const storage = () => {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

// Срочная плашка над шапкой главной (HOME_WIDGETS, slot 'banner'). Загрузка, ошибка, пустота, скрытие — ничего не рисуем.
export default function HomeBanner() {
  const [banner, setBanner] = useState(null)

  useEffect(() => {
    let alive = true
    api
      .get('/modules/news/banner')
      .then((result) => {
        if (alive && result?.banner && !isBannerHidden(storage(), result.banner.id)) setBanner(result.banner)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  if (!banner) return null

  const hide = () => {
    hideBanner(storage(), banner.id)
    setBanner(null)
  }

  return (
    <div className="news-banner" role="alert">
      <div className="news-banner-text">{banner.text}</div>
      <button type="button" className="news-banner-hide" aria-label={s.hideLabel} onClick={hide}>
        {s.hide}
      </button>
    </div>
  )
}
