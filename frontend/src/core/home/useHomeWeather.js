import { useEffect, useState } from 'react'
import { api } from '../api/index.js'

// Погода главной: один запрос на страницу. С выбранным «моим городом» — /core/home/weather?city=<id>, при смене города перезапрос.
// Активный город (Q-P3): выбранный кнопкой переключателя, иначе мой (если он пришёл в cities), иначе первый.
export function useHomeWeather(myCity) {
  const [state, setState] = useState({ loading: true, data: null })
  // выбор кнопкой действует только пока не сменился «мой город»
  const [picked, setPicked] = useState({ forCity: null, id: null })

  useEffect(() => {
    let alive = true
    const path = myCity ? `/core/home/weather?city=${encodeURIComponent(myCity)}` : '/core/home/weather'
    api
      .get(path)
      .then((data) => alive && setState({ loading: false, data }))
      .catch(() => alive && setState({ loading: false, data: null }))
    return () => {
      alive = false
    }
  }, [myCity])

  const cities = state.data?.cities ?? []
  const has = (id) => cities.some((c) => c.id === id)
  const cityId =
    picked.forCity === myCity && has(picked.id) ? picked.id : has(myCity) ? myCity : (cities[0]?.id ?? null)

  return {
    loading: state.loading,
    data: state.data,
    cityId,
    setCityId: (id) => setPicked({ forCity: myCity, id }),
  }
}
