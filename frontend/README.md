# Платформа инструментов — фронтенд (этап 0a, демо на моках)

Только интерфейс: бэкенда, БД, очереди и файлов нет. Все данные — in-memory мок (`src/core/api/mock/`), сбрасываются при перезагрузке страницы. Пароль у всех демо-пользователей: `demo`.

## Локальный запуск

```
npm install
npm run dev        # http://localhost:5173
npm run build
npm run preview
npm run lint
npm test
```

Демо-элементы (баннер, «Войти как», «Демо-вход») включаются переменной `VITE_DEMO_MODE=true`. Она читается при сборке; для локальной проверки: `VITE_DEMO_MODE=true npm run dev` (см. `.env.example`; файлы `.env*` не коммитятся).

## Деплой на Vercel

1. Import Project, Root Directory = `frontend`.
2. Framework Preset = Vite, Build Command = `npm run build`, Output Directory = `dist`.
3. Environment Variable `VITE_DEMO_MODE=true` — задать ДО сборки. После изменения переменной нужен Redeploy.
4. `vercel.json` содержит SPA-rewrite на `/index.html` (статика `/assets/*` не переписывается).

Секретов и бэкенда нет.

## Добавление модуля

Чек-лист — в начале `src/modules/registry.js`: папка `src/modules/<id>/` со своим `strings.js` + одна строка в `MODULES`. Привязка к отделам — в данных (`mock/data.js`, `moduleDepartments`).
