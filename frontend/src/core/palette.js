// Палитра данных хаба: диаграммы, направления, категории и статусы. Приглушённые тона, различимые между собой,
// одинаковые в обеих темах (средняя светлота читается и на белом, и на графите). Совпадают с --data-* в styles.css.
export const DATA_COLORS = {
  blue: '#4A6B9A',
  terracotta: '#A85F33',
  green: '#3F7A5F',
  rose: '#B57AA6',
  ochre: '#C9A443',
  teal: '#3F7F7A',
  stone: '#A9A39E',
  red: '#A22325',
}

const INK = '#232120'
const WHITE = '#FFFFFF'

// Яркие цвета фирменного справочника (они же хранятся у направлений в БД) → их спокойные версии и цвет текста на них.
// Данные в БД не меняются: замена только при показе. Неизвестный цвет показывается как есть.
const SOFT = {
  '#1D428A': [DATA_COLORS.blue, WHITE],
  '#FE5000': [DATA_COLORS.terracotta, WHITE],
  '#F3D03E': [DATA_COLORS.ochre, INK],
  '#E59BDC': [DATA_COLORS.rose, INK],
  '#7CE0D3': [DATA_COLORS.teal, WHITE],
  '#005844': [DATA_COLORS.green, WHITE],
  '#B3ACA9': [DATA_COLORS.stone, INK],
  '#A22325': [DATA_COLORS.red, WHITE],
}

export const softColor = (hex) => (hex && SOFT[hex.toUpperCase()]?.[0]) || hex

// Направление { color, avatarInk, … } → с приглушённым цветом и подходящим к нему цветом текста
export function softDirection(d) {
  const hit = d?.color && SOFT[d.color.toUpperCase()]
  return hit ? { ...d, color: hit[0], avatarInk: hit[1] } : d
}

export const softDirections = (list) => (Array.isArray(list) ? list.map(softDirection) : list)
