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

## Автодеплой
- CI (`.github/workflows/ci.yml`): на каждый PR и пуш в `main` — pytest на Postgres, `npm run lint`, `npm test`, `npm run build`.
- Деплой (`.github/workflows/deploy.yml`): после зелёного CI на пуше в `main` по ssh запускается `deploy/deploy.sh` — `git merge --ff-only`, `docker compose up -d --build`, проверка `/health`; при неудаче откат на прежний коммит и пересборка.
- Сайт (тот же workflow): до выката бэкенда собирается фронтенд (`VITE_API_URL` задан в `deploy.yml`, `VITE_DEMO_MODE=false`; без адреса API сборка падает, чтобы не получились моки). После успешного бэкенда архив по scp кладётся на сервер, `deploy/deploy-frontend.sh` распаковывает его в `/var/www/trendsetter-hub/releases/<sha>` и переключает симлинк `current` (хранятся 5 релизов), Caddy отдаёт статику (`deploy/Caddyfile.snippet`, редирект http→https — `deploy/nginx-hub-redirect.conf`).
- Проверка: `https://hub.trendsettercrew.com/version.txt` = sha коммита; workflow сам проверяет сайт и при провале откатывает фронтенд (бэкенд остаётся новым).
- Откат сайта вручную на сервере: `bash deploy/deploy-frontend.sh /var/www/trendsetter-hub rollback [sha]` (без sha — на предыдущий релиз); `... status` показывает релизы.
- Необязательная GitHub Variable `HUB_WEB_HOST` (Settings → Secrets and variables → Actions → Variables): имя сайта для проверки, по умолчанию `hub.trendsettercrew.com`. Порядок переезда и шаги для владельца сервера — `docs/TZ-frontend-move.md`.
- Миграции Alembic автодеплой **не** применяет (пароля doadmin на сервере нет): новые ревизии выполняются отдельно, до слияния кода, который их требует.
- Секреты репозитория (Settings → Secrets and variables → Actions): `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PATH` (папка клона репозитория на сервере), `DEPLOY_SSH_KEY` (приватный ключ отдельного deploy-пользователя; публичный — в его `authorized_keys`), `DEPLOY_KNOWN_HOSTS` (вывод `ssh-keyscan -t ed25519 <хост>`, сверить отпечаток вручную).

## Правила
- Секреты (пароли, ключи, DSN) в репозиторий не кладём. Локально — `.env` / `.env.local` (в `.gitignore`), в репозитории только `.env.example`.
- Все строки интерфейса — в `frontend/src/core/strings.js` и `strings.js` модулей.
- Новый отдел = новый модуль (`frontend/src/modules/<id>/`), ядро не переделываем.
- Не коммитить локальный прокси в `vite.config.js`.
