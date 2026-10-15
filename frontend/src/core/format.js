const priceFormatter = new Intl.NumberFormat('ru-RU')
const dateTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

export const formatPrice = (value) => `${priceFormatter.format(value)} ₽`

export const formatDateTime = (iso) => dateTimeFormatter.format(new Date(iso))
