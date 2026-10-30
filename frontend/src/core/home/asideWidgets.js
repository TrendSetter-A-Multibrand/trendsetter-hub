// Настраиваемые блоки правой колонки главной: виджеты модулей без slot (HOME_WIDGETS). Порядок по умолчанию — как в registry.
// Нужен главной (показ) и редактору виджетов (список для настройки); label — подпись в настройке.
// Часы, погода и курсы — постоянные блоки раскладки V1, не настраиваются (TODO(Q-P5)).
import { HOME_WIDGETS } from '../../modules/registry.js'

export const ASIDE_WIDGETS = HOME_WIDGETS.filter((w) => !w.slot)
