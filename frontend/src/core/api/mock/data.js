// Моковые данные: in-memory, сбрасываются при перезагрузке страницы. Все люди вымышленные.
export const DEMO_PASSWORD = 'demo'

export const data = {
  departments: [
    { id: 1, code: 'purchasing', name: 'Закупки' },
    { id: 2, code: 'wb', name: 'WB-отдел' },
    { id: 3, code: 'analytics', name: 'Аналитика' },
    { id: 4, code: 'pricing', name: 'Ценообразование' },
    { id: 5, code: 'warehouse', name: 'Склад' },
  ],

  // Привязка модулей к отделам — данные, а не реестр. Новый модуль добавляется сюда разработчиком.
  moduleDepartments: {
    purchasing: [1],
    wb: [2],
    analytics: [3],
    pricing: [4],
    warehouse: [5],
  },

  users: [
    { id: 1, email: 'karen@example.com', full_name: 'Карен В.', access_level: 'admin', department_ids: [], is_active: true },
    { id: 2, email: 'head@example.com', full_name: 'Руководитель', access_level: 'superuser', department_ids: [], is_active: true },
    { id: 3, email: 'ani@example.com', full_name: 'Ани С.', access_level: 'employee', department_ids: [1], is_active: true },
    { id: 4, email: 'wb@example.com', full_name: 'Сотрудник WB', access_level: 'employee', department_ids: [2], is_active: true },
    { id: 5, email: 'viewer@example.com', full_name: 'Наблюдатель', access_level: 'viewer', department_ids: [], is_active: true },
    { id: 6, email: 'multi@example.com', full_name: 'Сотрудник закупок и аналитики', access_level: 'employee', department_ids: [1, 3], is_active: true },
    { id: 8, email: 'warehouse@example.com', full_name: 'Сотрудник склада', access_level: 'employee', department_ids: [5], is_active: true },
    { id: 7, email: 'former@example.com', full_name: 'Бывший сотрудник', access_level: 'employee', department_ids: [1], is_active: false },
  ],

  groups: [{ id: 1, name: 'Ответственные склада', permissions: { warehouse: 'responsible' }, user_ids: [8] }],

  runs: [
    { id: 1, module_id: 'purchasing', filename: 'price_summer_2026.xlsx', user_id: 1, status: 'done', created_at: '2026-09-30T14:20:00' },
    { id: 2, module_id: 'purchasing', filename: 'price_autumn_2026.xlsx', user_id: 3, status: 'running', created_at: '2026-09-30T11:05:00' },
    { id: 3, module_id: 'purchasing', filename: 'price_accessories.xlsx', user_id: 6, status: 'queued', created_at: '2026-09-29T17:40:00' },
    { id: 4, module_id: 'purchasing', filename: 'price_old_format.xlsx', user_id: 3, status: 'failed', created_at: '2026-09-29T10:15:00' },
    { id: 5, module_id: 'purchasing', filename: 'price_winter_2025.xlsx', user_id: 1, status: 'done', created_at: '2026-09-26T09:30:00' },
  ],

  // Готовые обработанные файлы модуля «Закупки» (сводная таблица)
  purchasingFiles: [
    { id: 1, filename: 'price_summer_2026.xlsx', supplier: 'ООО «Вымышленный поставщик»', uploaded_at: '2026-09-30T14:20:00', user_id: 1, items: 128, qty: 4350, rrp_total: 3280500 },
    { id: 2, filename: 'price_winter_2025.xlsx', supplier: 'ИП Вымышленный', uploaded_at: '2026-09-26T09:30:00', user_id: 1, items: 74, qty: 2160, rrp_total: 1895200 },
    { id: 3, filename: 'price_kids_autumn.xlsx', supplier: 'ООО «Тестовый опт»', uploaded_at: '2026-09-22T16:05:00', user_id: 3, items: 203, qty: 7820, rrp_total: 5412900 },
    { id: 4, filename: 'price_accessories_2026.xlsx', supplier: 'ООО «Вымышленный поставщик»', uploaded_at: '2026-09-18T12:40:00', user_id: 6, items: 56, qty: 1240, rrp_total: 624800 },
  ],

  // Справочники формы «Новая обработка» (модуль «Закупки»). Все названия вымышленные.
  purchasingSuppliers: [
    { id: 1, name: 'Celio (демо)' },
    { id: 2, name: 'ООО «Вымышленный поставщик»' },
    { id: 3, name: 'ИП Вымышленный' },
    { id: 4, name: 'ООО «Тестовый опт»' },
    { id: 5, name: 'Nordic Wear Trading (демо)' },
  ],
  // Результат «быстрого просмотра» демо-файлов (POST /modules/purchasing/inspect). Значения вымышленные.
  purchasingInspect: {
    'price_celio_fw26.xlsx': {
      rows: 1243,
      brands: [{ name: 'Celio', count: 1243 }],
      sizes: [
        { name: 'XS', count: 96 }, { name: 'S', count: 214 }, { name: 'M', count: 268 }, { name: 'L', count: 251 },
        { name: 'XL', count: 187 }, { name: 'XXL', count: 94 }, { name: '44', count: 31 }, { name: '46', count: 38 },
        { name: '48', count: 36 }, { name: '50', count: 28 },
      ],
      categories: [
        { name: 'Футболки', count: 312 }, { name: 'Джинсы', count: 254 }, { name: 'Рубашки', count: 198 },
        { name: 'Трикотаж', count: 176 }, { name: 'Брюки', count: 141 }, { name: 'Верхняя одежда', count: 98 },
        { name: 'Аксессуары', count: 64 },
      ],
      seasons: [{ name: 'FW', count: 1243 }],
      years: [{ name: '2026', count: 1243 }],
    },
    'price_multibrand_mix.xlsx': {
      rows: 2180,
      brands: [
        { name: 'Aurora Line', count: 812 }, { name: 'Bluefield', count: 645 },
        { name: 'Cedar & Co', count: 488 }, { name: 'Dune Street', count: 235 },
      ],
      sizes: [
        { name: 'XS', count: 150 }, { name: 'S', count: 380 }, { name: 'M', count: 470 }, { name: 'L', count: 440 },
        { name: 'XL', count: 310 }, { name: 'XXL', count: 130 }, { name: '36', count: 90 }, { name: '38', count: 120 },
        { name: '40', count: 90 },
      ],
      categories: [
        { name: 'Верхняя одежда', count: 520 }, { name: 'Футболки', count: 610 }, { name: 'Джинсы', count: 340 },
        { name: 'Обувь', count: 295 }, { name: 'Аксессуары', count: 215 }, { name: 'Трикотаж', count: 200 },
      ],
      seasons: [{ name: 'SS', count: 760 }, { name: 'FW', count: 1190 }, { name: 'Круглогодичный', count: 230 }],
      years: [{ name: '2025', count: 940 }, { name: '2026', count: 1240 }],
    },
    'price_kids_ss27.xlsx': {
      rows: 860,
      brands: [{ name: 'Little Fjord', count: 520 }, { name: 'Mini Harbor', count: 340 }],
      sizes: [
        { name: '62', count: 40 }, { name: '68', count: 62 }, { name: '74', count: 75 }, { name: '80', count: 88 },
        { name: '86', count: 90 }, { name: '92', count: 98 }, { name: '98', count: 92 }, { name: '104', count: 85 },
        { name: '110', count: 78 }, { name: '116', count: 64 }, { name: '122', count: 48 }, { name: '128', count: 24 },
        { name: '134', count: 10 }, { name: '140', count: 6 },
      ],
      categories: [
        { name: 'Футболки', count: 210 }, { name: 'Комбинезоны', count: 160 }, { name: 'Шорты', count: 145 },
        { name: 'Платья', count: 130 }, { name: 'Верхняя одежда', count: 115 }, { name: 'Обувь', count: 100 },
      ],
      seasons: [{ name: 'SS', count: 860 }],
      years: [{ name: '2027', count: 860 }],
    },
  },
  // values — только общие параметры (без значений из файла), в формате значений формы NewRunDrawer
  purchasingPresets: [
    {
      id: 1,
      name: 'Celio — обычный лот',
      values: {
        mode: 'rows',
        channels: ['wb', 'retail_yerevan', 'retail_moscow'],
        shares: { wb: 40, retail_yerevan: 30, retail_moscow: 30 },
        qtyMin: 2,
        qtyMax: 20,
        lotLimit: 1500,
        discount: 50,
        genders: ['female', 'male'],
      },
    },
    {
      id: 2,
      name: 'Дозаказ — только WB',
      values: {
        mode: 'rows',
        channels: ['wb'],
        shares: { wb: 100 },
        qtyMin: 1,
        qtyMax: 10,
        lotLimit: 500,
        discount: 60,
      },
    },
    {
      id: 3,
      name: 'Лот целиком — Retail',
      values: {
        mode: 'lot',
        channels: ['retail_yerevan', 'retail_moscow'],
        shares: { retail_yerevan: 50, retail_moscow: 50 },
        discount: 55,
      },
    },
  ],

  nextId: { user: 8, department: 5, preset: 4, group: 2 },
}
