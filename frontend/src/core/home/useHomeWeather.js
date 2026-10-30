import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/index.js'
import { DEFAULT_CITY_IDS } from './myCity.js'

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

  // Показываем только города по умолчанию и «мой»: убранный или прежний город исчезает сразу, не дожидаясь ответа
  const data = useMemo(
    () =>
      state.data ? { ...state.data, cities: (state.data.cities ?? []).filter((c) => DEFAULT_CITY_IDS.includes(c.id) || c.id === myCity) } : null,
    [state.data, myCity],
  )
  const cities = data?.cities ?? []
  const has = (id) => cities.some((c) => c.id === id)
  const cityId =
    picked.forCity === myCity && has(picked.id) ? picked.id : has(myCity) ? myCity : (cities[0]?.id ?? null)

  return {
    loading: state.loading,
    data,
    cityId,
    setCityId: (id) => setPicked({ forCity: myCity, id }),
  }
}
