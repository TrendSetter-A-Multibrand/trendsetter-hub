# trendsetter-hub — единая платформа инструментов

Хаб для всех отделов компании: общее ядро (роли, загрузка файлов, очередь задач, журнал) и модули отделов (Закупки — MVP; WB-карточки, Аналитика, Ценообразование — в планах).

Сейчас готова только оболочка интерфейса на моках (`frontend/`). Бэкенда и БД ещё нет.

## Документы
- `ARCHITECTURE.md` — архитектура, решения, открытые вопросы, план.
- `CLAUDE.md` — правила проекта (для людей и для Claude Code).
- `design/` — макет интерфейса и брендбук.
- `docs/` — планы и ТЗ.

## Запуск фронтенда
```
cd frontend
npm install
npm run dev
```
Демо-режим (баннер, вход без пароля): в `frontend/.env.local` написать `VITE_DEMO_MODE=true`.
Проверки: `npm run lint`, `npm test`, `npm run build`.

## Запуск бэкенда (разработка, в Docker, с локальным Postgres)
```
docker compose up -d postgres
docker compose run --rm api alembic upgrade head      # схема trendsetter_hub (роль hub_app создаётся тестами/вручную, см. backend/tests/conftest.py)
docker compose run --rm api pytest -q                 # тесты (временная база, приложение под hub_app)
docker compose up api                                 # API на http://localhost:8000
```
Фронтенд с настоящим API: `VITE_API_URL=http://localhost:8000` в `frontend/.env.local`. Без неё работают моки (так на Vercel). Реальные пароли и ключи в репозиторий не кладём: образец — `backend/.env.example`. ТЗ: `docs/TZ-backend-stage-0b.md`.

## Работа с git
- В `main` напрямую не пушим. У каждого своя ветка: `dev-karen`, `dev-andrey`.
- Готовый кусок работы — Pull Request из своей ветки в `main`, второй смотрит и сливает.
- Перед началом работы подтянуть свежий `main`: `git checkout dev-<имя> && git pull origin main`.
- Каждая ветка автоматически получает превью на Vercel (ссылка появится в PR).
- Пуш в `main` выкатывает сайт на `trendsetter-hab.vercel.app`.

## Автодеплой бэкенда
- CI (`.github/workflows/ci.yml`): на каждый PR и пуш в `main` — pytest на Postgres, `npm run lint`, `npm test`, `npm run build`.
- Деплой (`.github/workflows/deploy.yml`): после зелёного CI на пуше в `main` по ssh запускается `deploy/deploy.sh` — `git merge --ff-only`, `docker compose up -d --build`, проверка `/health`; при неудаче откат на прежний коммит и пересборка.
- Миграции Alembic автодеплой **не** применяет (пароля doadmin на сервере нет): новые ревизии выполняются отдельно, до слияния кода, который их требует.
- Секреты репозитория (Settings → Secrets and variables → Actions): `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PATH` (папка клона репозитория на сервере), `DEPLOY_SSH_KEY` (приватный ключ отдельного deploy-пользователя; публичный — в его `authorized_keys`), `DEPLOY_KNOWN_HOSTS` (вывод `ssh-keyscan -t ed25519 <хост>`, сверить отпечаток вручную).

## Правила
- Секреты (пароли, ключи, DSN) в репозиторий не кладём. Локально — `.env` / `.env.local` (в `.gitignore`), в репозитории только `.env.example`.
- Все строки интерфейса — в `frontend/src/core/strings.js` и `strings.js` модулей.
- Новый отдел = новый модуль (`frontend/src/modules/<id>/`), ядро не переделываем.
- Не коммитить локальный прокси в `vite.config.js`.
