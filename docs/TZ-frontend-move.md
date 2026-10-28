# ТЗ: перенос фронтенда с Vercel на сервер хаба, затем репозиторий — приватный (Weeek №19100)

Статус: финальная редакция lead, 2026-10-27. Ответы владельца сервера получены (Q-F1…Q-F6, Q-F9 закрыты; Q-F10 — решение по умолчанию). PR1 можно отдавать исполнителю. Открытыми остаются только Q-F7, Q-F8, Q-F11 — вне объёма этого ТЗ.
Миграции Alembic и БД не затрагиваются. Новых зависимостей в приложение (`frontend/package.json`, `backend/requirements.txt`) не добавляется.

## 1. Что есть сейчас (разведка + ответы владельца)
- **Сайт** `https://hub.trendsettercrew.com` — Vercel, проект `trendsetter-hab`. `frontend/vercel.json`: сборка `npm install --include=dev && npm run build`, выход `dist`, rewrites `/assets/(.*)` → как есть, всё остальное → `/index.html` (SPA-маршруты `/profile`, `/modules/*`, `/admin`). Заголовков и redirects в `vercel.json` нет; HTTPS, редирект http→https, HSTS, сжатие и кэш делает сам Vercel. Ещё Vercel даёт превью на каждый PR и адрес `trendsetter-hab.vercel.app`.
- **Адрес API задаётся только при сборке:** `frontend/src/core/config.js` берёт `import.meta.env.VITE_API_URL`, по умолчанию пустая строка. Пусто → **молча** включаются моки и localStorage-бэкенд склада. В Vercel Production `VITE_API_URL=https://hub-api.trendsettercrew.com` (подтверждено владельцем); там же есть `VITE_DEMO_MODE` (значение скрыто — в Actions ставим явно `false`). `vite.config.js` без прокси, `/api` во фронте не используется.
- **Фронт ходит на другой origin** `https://hub-api.trendsettercrew.com`; токен в `sessionStorage`, заголовок `Authorization`, cookie нет. CORS — из `HUB_CORS_ORIGINS` / `HUB_CORS_ORIGIN_REGEX` в `/opt/trendsetter-hub/.env`. Origin сайта не меняется → CORS менять не нужно (кроме временного имени на время проверки).
- **Бэкенд:** `.github/workflows/deploy.yml` → ssh → `deploy/deploy.sh` в клоне **`/opt/trendsetter-hub/repo`** (compose — `/opt/trendsetter-hub/repo/deploy`), remote `git@github.com:TrendSetter-A-Multibrand/trendsetter-hub.git` (SSH — на сервере уже есть ключ GitHub; чей — выясняется на этапе 6).
- **Сервер** 138.68.79.218 (hostname `ubuntu-s-1vcpu-1gb-fra1-01` — историческое имя; фактически 8 ГБ RAM / 160 ГБ, CPU ≈ 28 %). Там же живут `purchasing_dashboard`, airflow, WB-скрипты. **Порт 80 — nginx** (purchasing/airflow, их хосты за Cloudflare Proxied); **порт 443 — только Caddy** → сертификаты Caddy выпускает через TLS-ALPN (`disable_http_challenge`), редиректа http→https для наших имён Caddy не даст — его делает nginx (этап 0).
- **SSH-ключи:** в `authorized_keys` единственная строка с `command=` — ключ `purchasing_dashboard`; ключ деплоя хаба без ограничений (он уже выполняет `bash -s`) → `scp` и второй `ssh` для статики работают. Первый прогон всё равно проверяет это фактически (этап 1).
- **DNS:** зона `trendsettercrew.com` в **Cloudflare** (Full DNS). `hub` — **CNAME `ae3e0d945c5ded29.vercel-dns-017.com`, DNS only (серое облако), TTL Auto (300 с)** — это значение для отката. `hub-api` — A 138.68.79.218, DNS only. Новые записи `hub-next` и `hub` (A) — **только DNS only**: через прокси Cloudflare (оранжевое облако) TLS-ALPN-сертификат Caddy не выпустится.
- **Actions:** организация на плане `team`; биллинг за октябрь ≈ 430 мин, Billed $0, перерасход $0,006/мин → минуты не блокер (Q-F2 закрыт).

## 2. Решения
1. **Адрес API не меняем.** Сборка с `VITE_API_URL=https://hub-api.trendsettercrew.com`, `VITE_DEMO_MODE=false`. Прокси `/api` на том же домене (идея Дианы) — не в этом ТЗ. TODO(Q-F7).
2. **Сборка — в GitHub Actions, в том же workflow, что и бэкенд**, на коммите `head_sha`. Сборку из `ci.yml` не переиспользуем (она на моках). На сервере ничего не собираем.
3. **Доставка — архив `dist` по тому же ssh-ключу** (`scp` + скрипт через `ssh … bash -s`). Без GHCR, без нового контейнера, без rsync.
4. **Раскладка:** `/var/www/trendsetter-hub/releases/<sha>/` + симлинк `current`, 5 последних релизов, откат = переключить симлинк. `/var/www/…`, а не `/opt/trendsetter-hub/…`, чтобы Caddy не имел доступа к каталогу с `.env`.
5. **Соседи на сервере не затрагиваются:** только статика (≈ 3 МБ на релиз), один новый блок Caddy и один новый `server{}` nginx только для имён `hub`/`hub-next` на порту 80. Чужие блоки Caddy, хосты nginx, контейнеры, cron не трогаем; новых сервисов/контейнеров нет; нагрузка — раздача статики Caddy.
6. **Порядок выката:** сборка сайта → бэкенд → (если здоров) сайт. Бэкенд откатился → сайт не выкатывается. Сайт не прошёл проверку → сайт откатывается сам, бэкенд остаётся новым.
7. **Версия:** workflow кладёт `dist/version.txt` с полным sha.
8. **Старые чанки:** в новый релиз копируются (`cp -n`) собственные `assets` предыдущего релиза — одно поколение.
9. **Caddy** отдаёт статику сам, SPA-fallback на `index.html`, но `/assets/*` без fallback (404).
10. **CSP не добавляем** — TODO(Q-F8). HSTS без `includeSubDomains`/`preload`.
11. **Сертификат** для `hub.` Caddy получит только после смены DNS (TLS-ALPN), поэтому проверка до переключения — на временном `hub-next.trendsettercrew.com`; в день переключения `hub.` добавляется в Caddy **сразу после** того, как NS Cloudflare отдают новый IP.
12. **Vercel-демо на моках** (`trendsetter-hab.vercel.app`) по умолчанию отключается вместе с проектом Vercel (Q-F10; если владелец до этапа 5 скажет «оставить» — в Vercel только снимается домен, Git-интеграция всё равно отключается, демо замораживается на последней сборке).
13. **Превью PR** пропадают — принято (Q-F1).

## 3. План
Два PR от исполнителя + шаги владельца (раздел 5).

1. **Этап 0 (владелец, до merge PR1):** DNS `hub-next` (DNS only), каталог сайта, временный блок Caddy, редирект http→https в nginx, CORS для `hub-next`, Variable `HUB_WEB_HOST`, лимит расходов Actions. → verify: `https://hub-next.trendsettercrew.com/` с валидным сертификатом (404 допустим), `http://hub-next…` → 301 на https.
2. **PR1 (исполнитель):** `deploy/deploy-frontend.sh`, `deploy/Caddyfile.snippet`, `deploy/nginx-hub-redirect.conf`, `.github/workflows/deploy.yml`, раздел автодеплоя в `README.md`. → verify: после merge job `Deploy` зелёный (в т.ч. шаг scp), `https://hub-next.trendsettercrew.com/version.txt` = sha.
3. **Этап 2 (люди):** ручная проверка на `hub-next` (6.2).
4. **Этап 3 (владелец, нерабочее время):** Cloudflare: `hub` CNAME → A 138.68.79.218 (DNS only); добавить `hub.` в Caddy; сертификат; `HUB_WEB_HOST=hub.trendsettercrew.com`; Re-run Deploy. → verify: 6.3.
5. **Этап 4:** наблюдение 1–3 рабочих дня; Vercel не трогаем (откат = вернуть CNAME).
6. **Этап 5 (владелец):** отключить Vercel; убрать `hub-next` (Caddy, nginx, CORS, DNS) и `HUB_CORS_ORIGIN_REGEX` превью Vercel, если задан.
7. **PR2 (исполнитель):** убрать Vercel из документации и `frontend/vercel.json`.
8. **Этап 6 (владелец):** ключ GitHub на сервере (два сценария) → репо приватный → проверка CI/деплоя.

## 4. ТЗ для исполнителя

### Общие правила
- Трогать **только** файлы, перечисленные в PR1/PR2. Не менять: чужие блоки Caddy и хосты nginx (в репо их нет — только наши файлы в `deploy/`), `ci.yml`, `deploy/deploy.sh`, `deploy/docker-compose.prod.yml`, `frontend/src/**`, `backend/**` (кроме строки в `backend/.env.example` в PR2), `vite.config.js`, `package.json`, `CLAUDE.md`, `ARCHITECTURE.md`, миграции, `db/`.
- Никаких секретов, IP и имён пользователей в файлах, кроме уже публичных доменов `hub.trendsettercrew.com`, `hub-api.trendsettercrew.com`, `hub-next.trendsettercrew.com`.
- Неясность → открытый вопрос в отчёте, не решать молча.

### PR1, файл 1 (новый): `deploy/deploy-frontend.sh`
Bash, стиль как у `deploy/deploy.sh` (русские комментарии, `set -euo pipefail`), плюс `umask 022`. Запускается **на сервере**: `ssh … bash -s -- <WEB_ROOT> <команда> [sha] < deploy/deploy-frontend.sh` или вручную `bash deploy-frontend.sh <WEB_ROOT> <команда> [sha]`. `WEB_ROOT` обязателен (`${1:?…}`, как в `deploy.sh`); в workflow — `/var/www/trendsetter-hub`.
Структура `WEB_ROOT`: `incoming/` (архивы), `releases/<sha>/` (релизы), `releases/<sha>.assets` (список собственных файлов `assets/` релиза, вне раздаваемой папки), `current` → `releases/<sha>` (относительный симлинк), `previous` (текстовый файл с sha предыдущего активного релиза).
Команды:
- `activate <sha>`:
  1. sha строго `^[0-9a-f]{40}$`, иначе выход 1. Архив `incoming/<sha>.tgz` обязателен.
  2. Если `current` уже указывает на `releases/<sha>` — удалить архив, вывести «уже активна», выход 0 (повторный запуск того же коммита).
  3. Распаковать в `releases/<sha>.tmp` (предварительно `rm -rf` его): `tar -xzf … --no-same-owner --no-same-permissions`; затем `chmod -R u=rwX,go=rX`.
  4. Проверки (иначе удалить `.tmp`, выход 1, `current` не меняется): есть `index.html`; содержимое `version.txt` без завершающего перевода строки равно `<sha>`; есть каталог `assets` и в нём хотя бы один `.js`.
  5. Записать `releases/<sha>.assets` = имена файлов в `releases/<sha>.tmp/assets` (до копирования старых).
  6. Если есть активный релиз `prev` (из `readlink current`) и файл `releases/<prev>.assets` — скопировать перечисленные в нём файлы из `releases/<prev>/assets/` в `releases/<sha>.tmp/assets/` с `cp -n`. Отсутствующий файл — пропуск без ошибки.
  7. `rm -rf releases/<sha>` (остаток прошлой неактивной попытки), `mv releases/<sha>.tmp releases/<sha>`.
  8. Атомарное переключение в `WEB_ROOT`: `ln -sfn releases/<sha> current.tmp && mv -Tf current.tmp current`. Записать `prev` в `previous` (если был).
  9. Чистка: оставить 5 самых новых каталогов `releases/*/` по времени изменения; никогда не удалять текущий и `previous`; вместе с каталогом удалять его `.assets`. Удалить `incoming/<sha>.tgz`.
  10. Вывод: `Фронтенд: <prev7> -> <sha7>`.
- `rollback [sha]`: цель = аргумент или содержимое `previous`; каталог `releases/<цель>` обязан существовать (иначе выход 1 с понятным текстом); переключение как в п. 8; в `previous` записать бывший текущий. Вывод `Откат фронтенда на <sha7>`.
- `status`: текущий релиз, `previous`, список релизов (новые сверху).
- Неизвестная команда → подсказка по использованию, выход 2.
Скрипт не вызывает `sudo`, не трогает Caddy, не делает сетевых запросов.

### PR1, файл 2: `deploy/Caddyfile.snippet`
Существующий блок `hub-api.trendsettercrew.com` **не менять**. Первую строку-комментарий поправить так, чтобы было ясно, что блоков два. Дописать ниже (текст нагрузочный — переносить как есть):
```
# Сайт хаба: статика фронтенда. Релизы кладёт deploy/deploy-frontend.sh, current — симлинк на активный релиз.
# До переключения DNS вместо hub.trendsettercrew.com здесь временное имя hub-next.trendsettercrew.com (docs/TZ-frontend-move.md).
hub.trendsettercrew.com {
    root * /var/www/trendsetter-hub/current
    encode zstd gzip

    header {
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
        Strict-Transport-Security "max-age=31536000"
    }

    # Файлы сборки с хэшем в имени: кэш навсегда; нет файла — 404, а не index.html
    handle /assets/* {
        header Cache-Control "public, max-age=31536000, immutable"
        file_server
    }

    # Остальное: файл, если есть, иначе index.html (маршруты SPA: /profile, /modules/..., /admin)
    handle {
        header Cache-Control "no-cache"
        try_files {path} /index.html
        file_server
    }

    tls {
        issuer acme {
            disable_http_challenge
        }
    }
}
```

### PR1, файл 2а (новый): `deploy/nginx-hub-redirect.conf`
Отдельный `server{}` для nginx на порту 80 (порт 80 на сервере у nginx, Caddy слушает только 443). Только наши имена, чужие хосты не затрагиваются. Текст нагрузочный — переносить как есть:
```
# Редирект http -> https для сайта хаба. Порт 80 на сервере у nginx, HTTPS отдаёт Caddy (deploy/Caddyfile.snippet).
# Ставится в /etc/nginx/sites-available/ + ссылка в sites-enabled (docs/TZ-frontend-move.md, этап 0).
# hub-next — временное имя на время переезда; убрать после переключения DNS (этап 5).
server {
    listen 80;
    listen [::]:80;
    server_name hub.trendsettercrew.com hub-next.trendsettercrew.com;
    return 301 https://$host$request_uri;
}
```

### PR1, файл 3: `.github/workflows/deploy.yml`
- `name: Deploy` (было `Deploy backend`); комментарий в начале: «бэкенд, затем сайт; только после зелёного CI на том же коммите». Триггер `workflow_run` (`workflows: [CI]`), `if:` и `concurrency` (группу `deploy-backend` **не переименовывать**) — без изменений.
- Шаги одного job `deploy`, по порядку:
  1. `actions/checkout@v4` с `ref: head_sha` — как есть.
  2. **Новый:** `actions/setup-node@v4`: `node-version: 22`, `cache: npm`, `cache-dependency-path: frontend/package-lock.json` (как в `ci.yml`).
  3. **Новый «Сборка сайта»** (`working-directory: frontend`), env: `VITE_API_URL: https://hub-api.trendsettercrew.com`, `VITE_DEMO_MODE: "false"`, `HEAD_SHA` = `github.event.workflow_run.head_sha`. Команды: `npm ci`; `npm run build`; записать `$HEAD_SHA` с переводом строки в `dist/version.txt`; защита от сборки на моках — `grep -rqF "$VITE_API_URL" dist/assets`, иначе сообщение «В сборке нет адреса API — получились бы моки» и `exit 1`. Сборка идёт **до** выката бэкенда: сломанная сборка не выкатывает ничего.
  4. «Ключ и известный хост» — как есть.
  5. «Деплой бэкенда» — существующий шаг «Деплой», только переименовать.
  6. **Новый «Деплой сайта»**, env: `DEPLOY_HOST`, `DEPLOY_USER` из secrets, `HEAD_SHA`, `WEB_ROOT: /var/www/trendsetter-hub`. Команды:
     - `tar -C frontend/dist -czf "$RUNNER_TEMP/site.tgz" .`
     - `scp -i ~/.ssh/id_deploy -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes "$RUNNER_TEMP/site.tgz" "$DEPLOY_USER@$DEPLOY_HOST:$WEB_ROOT/incoming/$HEAD_SHA.tgz"`
     - `ssh` с теми же опциями: `"$DEPLOY_USER@$DEPLOY_HOST" bash -s -- "$WEB_ROOT" activate "$HEAD_SHA"`, скрипт на stdin из `deploy/deploy-frontend.sh` (как в шаге бэкенда).
  7. **Новый «Проверка сайта»**, env: `SITE_HOST` = GitHub Variable `HUB_WEB_HOST`, а если она не задана — `hub.trendsettercrew.com` (выражение вида `vars.HUB_WEB_HOST || 'hub.trendsettercrew.com'`); `DEPLOY_HOST`, `DEPLOY_USER`, `HEAD_SHA`, `WEB_ROOT`. Все `curl` — с `--connect-to "$SITE_HOST:443:$DEPLOY_HOST:443"` (проверяем именно сервер, даже если DNS у раннера ещё отдаёт Vercel), `-sS --max-time 10`. Серия проверок — до 5 попыток с паузой 3 с:
     - `https://$SITE_HOST/version.txt` → 200, тело без завершающего перевода строки = `$HEAD_SHA`;
     - `/` и `/modules/warehouse` → 200, `content-type` начинается с `text/html`, тело содержит `<div id="root">`;
     - первый `/assets/*.js` из HTML ответа `/` → 200, `content-type` содержит `javascript`, `cache-control` содержит `immutable`;
     - `/assets/does-not-exist.js` → **404**.
     При провале: вывести, какая проверка не прошла; по ssh выполнить `deploy-frontend.sh` с командой `rollback` (если сам откат упал — вывести, не маскировать); job завершить с ошибкой.
- Секреты не печатать, `set -x` не использовать. Новых actions, кроме `checkout`/`setup-node`, не добавлять.

### PR1, файл 4: `README.md`, раздел «Автодеплой бэкенда»
Переименовать в «Автодеплой» и дописать 3–5 строк: после бэкенда workflow собирает сайт (`VITE_API_URL` задан в `deploy.yml`), кладёт его в `/var/www/trendsetter-hub/releases/<sha>` и переключает `current`; проверка — `https://hub.trendsettercrew.com/version.txt`; откат — `deploy/deploy-frontend.sh <WEB_ROOT> rollback [sha]`; необязательная GitHub Variable `HUB_WEB_HOST` (по умолчанию `hub.trendsettercrew.com`). Строки про Vercel в разделе «Работа с git» в PR1 **не трогать** (Vercel ещё работает и служит откатом).

### PR2 (только после этапа 5: Vercel отключён, сайт на сервере не меньше 1 рабочего дня)
- Удалить `frontend/vercel.json`.
- `README.md`: убрать «Каждая ветка автоматически получает превью на Vercel»; «Пуш в main выкатывает сайт на trendsetter-hab.vercel.app» → «Пуш в main после зелёного CI выкатывает бэкенд и сайт https://hub.trendsettercrew.com»; «(так на Vercel)» в абзаце про `VITE_API_URL` → «(локальное демо на моках)».
- `frontend/README.md`: раздел «Деплой на Vercel» заменить одной строкой со ссылкой на раздел «Автодеплой» корневого README.
- `frontend/.env.example`: «Для Vercel-демо не задавать» → «Для локального демо на моках не задавать».
- `backend/.env.example`: в комментарии к `HUB_CORS_ORIGIN_REGEX` убрать пример с адресом Vercel (оставить нейтральное описание).
- `.gitignore`-файлы (`.vercel`) не трогать.

## 5. Шаги для владельца сервера / Cloudflare / GitHub / Vercel
`<deploy>` — пользователь из секрета `DEPLOY_USER` (значение секрета в GitHub не видно; узнать на сервере: `stat -c %U /opt/trendsetter-hub/repo/.git` — владелец клона, под которым идёт `git merge`; если это root — домашний каталог `/root`). Клон — `/opt/trendsetter-hub/repo`. Вывод с приватными ключами и секретами никому не пересылать. Чужие блоки Caddy и хосты nginx (purchasing, airflow, weeek-mcp, hub-api) не трогать.

### Этап 0 — подготовка (до merge PR1)
**Cloudflare → DNS → Records (`trendsettercrew.com`):**
1. Значение для отката уже известно: `hub` = CNAME `ae3e0d945c5ded29.vercel-dns-017.com`, DNS only, TTL Auto. Сделать скриншот записи. TTL уже 300 с — снижать не нужно.
2. CAA: если в зоне нет записей типа CAA — ок; если есть и среди них нет `letsencrypt.org` — сообщить lead.
3. Add record: `A`, Name `hub-next`, IPv4 `138.68.79.218`, Proxy status **DNS only (серое облако)**, TTL Auto.
4. Дождаться ответа NS Cloudflare (имена NS — Cloudflare → DNS → Records, блок «Cloudflare Nameservers»): `dig @<ns>.ns.cloudflare.com hub-next.trendsettercrew.com +short` → `138.68.79.218`.

**Vercel:** ничего не менять.

**GitHub (организация):** Settings → Billing and licensing → Budgets and alerts → бюджет на Actions (например $5/мес) с оповещением — защита от неожиданного перерасхода после перевода в приватный. (Платная Secret Protection с 22.10 к хабу не относится — владелец проверяет отдельно.)

**Сервер — каталог сайта:**
```bash
sudo install -d -o <deploy> -g <deploy> -m 755 /var/www/trendsetter-hub /var/www/trendsetter-hub/releases /var/www/trendsetter-hub/incoming
sudo -u caddy test -x /var/www/trendsetter-hub && echo "caddy видит каталог"
```

**Сервер — Caddy, временный блок** (текст — раздел 4, после merge PR1 — `deploy/Caddyfile.snippet`, **с заменой `hub.trendsettercrew.com` на `hub-next.trendsettercrew.com`**):
```bash
sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-before-hub-site
sudo nano /etc/caddy/Caddyfile                      # дописать блок в конец, остальное не менять
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
sudo journalctl -u caddy -n 50 --no-pager | grep -i hub-next     # ждём "certificate obtained successfully"
curl -sI https://hub-next.trendsettercrew.com/ | head -1           # HTTPS без ошибок сертификата; 404 до первого релиза — нормально
curl -sI https://hub-api.trendsettercrew.com/health | head -1      # бэкенд не задет
```

**Сервер — nginx, редирект http→https только для наших имён** (порт 80 у nginx; без этого `http://hub…` попадёт в чужой default-хост nginx). Файл — `deploy/nginx-hub-redirect.conf` из PR1 (до merge — текст из раздела 4):
```bash
sudo nginx -T 2>/dev/null | grep -n "server_name" | grep -i "hub"     # имён hub/hub-next в nginx ещё быть не должно
sudo nginx -T 2>/dev/null | grep -c "listen \[::\]:80"                 # 0 → строку listen [::]:80 из файла убрать
ls /etc/nginx/sites-enabled /etc/nginx/conf.d                          # где лежат конфиги
sudo nano /etc/nginx/sites-available/trendsetter-hub-redirect          # вставить содержимое deploy/nginx-hub-redirect.conf
sudo ln -s /etc/nginx/sites-available/trendsetter-hub-redirect /etc/nginx/sites-enabled/trendsetter-hub-redirect
sudo nginx -t && sudo systemctl reload nginx
curl -sI http://hub-next.trendsettercrew.com/modules/warehouse | head -3   # 301, Location: https://hub-next.trendsettercrew.com/modules/warehouse
curl -sI https://purchasing.trendsettercrew.com/ | head -1                 # соседи отвечают как раньше
```
Если на сервере нет `sites-enabled`, а используется `conf.d` — файл кладётся как `/etc/nginx/conf.d/trendsetter-hub-redirect.conf`. Если `nginx -t` ругается — удалить ссылку/файл, reload не делать, сообщить lead.

**Сервер — CORS на время проверки:** в `/opt/trendsetter-hub/.env` к `HUB_CORS_ORIGINS` дописать через запятую `https://hub-next.trendsettercrew.com` (существующие значения не трогать) и пересоздать контейнер (перерыв API несколько секунд — вне рабочего времени):
```bash
cd /opt/trendsetter-hub/repo/deploy && docker compose -f docker-compose.prod.yml up -d --force-recreate api
curl -fsS http://127.0.0.1:8010/health
```
**GitHub (репо):** Settings → Secrets and variables → Actions → вкладка **Variables** → `HUB_WEB_HOST` = `hub-next.trendsettercrew.com`.

### Этап 1 — merge PR1
- Job `Deploy` зелёный. В логе шага «Деплой сайта» `scp` прошёл — это фактическая проверка, что ключ деплоя без ограничений. Если `scp` упал (`subsystem request failed` / `Permission denied`) — сайт не выкатился, бэкенд уже обновлён и работает; прислать лог lead (запасной вариант — передача архива через `ssh` со stdin, правка PR1).
- `https://hub-next.trendsettercrew.com/version.txt` = sha коммита в `main`.
- На сервере: `sudo -u <deploy> bash /opt/trendsetter-hub/repo/deploy/deploy-frontend.sh /var/www/trendsetter-hub status`.

### Этап 2 — ручная проверка на `hub-next` (раздел 6.2)

### Этап 3 — переключение (нерабочее время, 15–30 мин)
1. Cloudflare → DNS → запись `hub` → Edit: Type **A**, IPv4 `138.68.79.218`, Proxy status **DNS only**, TTL Auto → Save. Если тип в редакторе не меняется — Delete CNAME и **сразу** Add record `A hub 138.68.79.218 DNS only` (между ними секунды, иначе резолверы могут закэшировать «записи нет»).
2. NS Cloudflare: `dig @<ns>.ns.cloudflare.com hub.trendsettercrew.com +short` → `138.68.79.218`. Публичные резолверы (`@1.1.1.1`, `@8.8.8.8`) до 5 мин могут отдавать Vercel — эти пользователи пока на Vercel, он работает.
3. Сразу заменить заголовок блока сайта в `/etc/caddy/Caddyfile` на `hub.trendsettercrew.com, hub-next.trendsettercrew.com {` → `caddy validate` → `systemctl reload caddy` → `sudo journalctl -u caddy -f` до «certificate obtained successfully» для `hub.trendsettercrew.com`. **Не добавлять `hub.` в Caddy до смены DNS**: неудачные попытки выпуска уходят в нарастающие паузы.
4. С сервера: `curl -s --resolve hub.trendsettercrew.com:443:127.0.0.1 https://hub.trendsettercrew.com/version.txt` = sha `main`; `curl -sI http://hub.trendsettercrew.com/ | head -3` → 301 на https (nginx-блок этапа 0 уже содержит `hub.trendsettercrew.com`).
5. GitHub Variable `HUB_WEB_HOST` → `hub.trendsettercrew.com`; Actions → последний Deploy → Re-run all jobs → зелёный.
6. **Откат**, если сертификат не выпускается > 10 мин или что-то сломано: Cloudflare → `hub` обратно **CNAME `ae3e0d945c5ded29.vercel-dns-017.com`, DNS only**; убрать `hub.` из заголовка блока Caddy, reload; `HUB_WEB_HOST` обратно на `hub-next`. Vercel всё это время собирает `main` и отдаёт сайт.

### Этап 4 — наблюдение 1–3 рабочих дня. Vercel не трогать.

### Этап 5 — отключение Vercel и уборка временного
1. Vercel → `trendsetter-hab` → Settings → Git → **Disconnect**; Settings → Domains → удалить `hub.trendsettercrew.com`; затем Settings → General → Delete Project (Q-F10: по умолчанию удаляем; если решено оставить демо — без удаления). **С этого момента откат на Vercel недоступен.**
2. Caddy: заголовок блока → только `hub.trendsettercrew.com {`, validate, reload.
3. nginx: в файле редиректа убрать `hub-next.trendsettercrew.com` из `server_name`, `sudo nginx -t && sudo systemctl reload nginx`.
4. `/opt/trendsetter-hub/.env`: убрать `https://hub-next.trendsettercrew.com` из `HUB_CORS_ORIGINS`; убрать `HUB_CORS_ORIGIN_REGEX`, если он задан под превью Vercel; пересоздать контейнер, `/health`.
5. Cloudflare: удалить запись `hub-next`.
6. GitHub Variable `HUB_WEB_HOST` удалить (по умолчанию `hub.trendsettercrew.com`).
7. → PR2.

### Этап 6 — перевод репозитория в приватный
**Шаг 6.1 — выяснить, каким ключом сервер ходит в GitHub** (пока репо публичный; приватные ключи не показывать):
- GitHub → репо `trendsetter-hub` → Settings → Deploy keys — скриншот списка (название, дата, read-only/read-write).
- На сервере под `<deploy>`:
```bash
ssh -T git@github.com            # "Hi TrendSetter-A-Multibrand/trendsetter-hub! ..." = deploy key репо; "Hi <логин>! ..." = ключ пользователя
ls -l ~/.ssh                     # только список файлов
cat ~/.ssh/config                # если файла нет — это нормально
```
**Сценарий А — в ответе имя репозитория** (`Hi TrendSetter-A-Multibrand/trendsetter-hub!`): ключ уже deploy key этого репо, приватность доступ не ломает. Ничего не менять; убедиться, что в списке Deploy keys он без write access (если с write — пересоздать read-only по сценарию Б, старый удалить).

**Сценарий Б — в ответе логин пользователя** (или ключ другого репо): доступ привязан к человеку (уйдёт человек / сменятся права — деплой сломается), а при ключе другого репо приватный `trendsetter-hub` перестанет читаться. Создать отдельный read-only deploy key:
```bash
ssh-keygen -t ed25519 -N "" -C "trendsetter-hub server" -f ~/.ssh/github_trendsetter_hub
cat ~/.ssh/github_trendsetter_hub.pub      # → GitHub: репо Settings → Deploy keys → Add deploy key, БЕЗ "Allow write access"
nano ~/.ssh/config                         # дописать блок ниже
chmod 600 ~/.ssh/config
git -C /opt/trendsetter-hub/repo remote set-url origin git@github-trendsetter-hub:TrendSetter-A-Multibrand/trendsetter-hub.git
git -C /opt/trendsetter-hub/repo fetch origin main && echo OK
```
Блок для `~/.ssh/config` (отдельный алиас, чтобы не менять доступ других репо на этом сервере, например `purchasing_dashboard`):
```
Host github-trendsetter-hub
    HostName github.com
    User git
    IdentityFile ~/.ssh/github_trendsetter_hub
    IdentitiesOnly yes
```
`known_hosts` для github.com уже есть (сервер ходит в GitHub по SSH). Прежний пользовательский ключ не удалять — им могут пользоваться другие репо; решение — за владельцем.

**Шаг 6.2 — перевод:** репо Settings → General → Danger Zone → Change repository visibility → Private.

**Шаг 6.3 — после перевода:** на сервере `git -C /opt/trendsetter-hub/repo fetch origin main && echo OK`; пустяковый PR → CI зелёный; merge → Deploy зелёный (`version.txt` = новый sha); Settings → Secrets → все 5 секретов на месте.

### Откат сайта вручную (в любое время после PR1)
```bash
sudo -u <deploy> bash /opt/trendsetter-hub/repo/deploy/deploy-frontend.sh /var/www/trendsetter-hub status
sudo -u <deploy> bash /opt/trendsetter-hub/repo/deploy/deploy-frontend.sh /var/www/trendsetter-hub rollback           # на предыдущий
sudo -u <deploy> bash /opt/trendsetter-hub/repo/deploy/deploy-frontend.sh /var/www/trendsetter-hub rollback <sha40>    # на конкретный
```
Перезапуск Caddy не нужен. Следующий merge в `main` снова выкатит новую версию.

## 6. Критерии приёмки

### 6.1 Ревьюер — PR1 (по диффу)
- Изменены только `deploy/deploy-frontend.sh` (новый), `deploy/nginx-hub-redirect.conf` (новый), `deploy/Caddyfile.snippet`, `.github/workflows/deploy.yml`, `README.md` (только раздел автодеплоя). Нет правок в `ci.yml`, `deploy.sh`, `docker-compose*.yml`, `frontend/**`, `backend/**`, `CLAUDE.md`, `ARCHITECTURE.md`; нет новых npm/pip-зависимостей и сторонних actions.
- Workflow: сборка сайта до выката бэкенда; `VITE_API_URL=https://hub-api.trendsettercrew.com` и `VITE_DEMO_MODE=false` в env шага сборки; проверка, что адрес API попал в `dist/assets` (сборка на моках → job красный); `version.txt` = `workflow_run.head_sha`; триггер, `if:` и `concurrency.group` не изменены; сайт выкатывается только после успешного шага бэкенда (без `continue-on-error`).
- ssh/scp — тот же ключ, `IdentitiesOnly=yes`, `StrictHostKeyChecking=yes`; секреты не выводятся; нет `set -x`.
- Проверка сайта — через `--connect-to` на `DEPLOY_HOST`; покрывает `version.txt`, `/`, глубокую ссылку `/modules/warehouse`, реальный ассет (`javascript` + `immutable`) и 404 на несуществующем ассете; при провале — `rollback` и красный job.
- `deploy-frontend.sh`: проверка формата sha; распаковка во временный каталог; атомарная замена симлинка (`ln -sfn` + `mv -T`); проверки `index.html`/`version.txt`/`assets`; ассеты только одного предыдущего поколения через `cp -n`; чистка не трогает `current`/`previous`; повторный `activate` того же sha безопасен; `rollback` без предыдущего релиза — понятная ошибка; без `sudo` и сетевых вызовов. `bash -n` и `shellcheck` (если доступен) — без ошибок.
- Caddy-блок совпадает с текстом раздела 4; блок `hub-api` не изменён.
- `deploy/nginx-hub-redirect.conf` совпадает с текстом раздела 4: только `server_name` хаба, `listen 80`, `return 301 https://$host$request_uri`.
- В отчёте исполнителя — локальный прогон скрипта во временном каталоге: `activate` двух фиктивных релизов, `status`, `rollback`, повторный `activate`, `activate` с архивом без `version.txt` (текущий релиз не меняется), чистка при 7 релизах оставляет 5 и не трогает `previous`.

### 6.1a Ревьюер — PR2
- Только файлы из списка PR2; `vercel.json` удалён; в README/`frontend/README.md`/`.env.example` не осталось инструкций по Vercel; `.gitignore` не тронут.

### 6.2 Люди — на `https://hub-next.trendsettercrew.com` (до DNS)
- Вход реальной учёткой; главная с реальными данными (нет демо-баннера, не моки).
- F5 на `/profile`, `/modules/warehouse`, `/admin` и на несуществующем пути — приложение открывается.
- Склад: список приёмок тот же, что на боевом сайте (сервер, не localStorage). HR: загрузка и скачивание файла работают.
- DevTools → Network: `/assets/*.js` — `cache-control: … immutable`, `content-encoding: gzip|zstd`; документ — `no-cache`; ошибок CORS нет.
- Открывается из сети РФ и из сети Армении (тот же IP, что у `hub-api`, — риск низкий, но проверить).
- `http://hub-next.trendsettercrew.com/modules/warehouse` → 301 на https.
- `rollback` на сервере → `version.txt` показывает прежний sha; Re-run Deploy возвращает текущий.

### 6.3 Люди — после переключения DNS и после перевода в приватный
- `https://hub.trendsettercrew.com`: сертификат Let's Encrypt (не Vercel), `version.txt` = sha `main`, Re-run Deploy с `HUB_WEB_HOST=hub.trendsettercrew.com` зелёный.
- Вход, склад, HR работают; `https://hub-api.trendsettercrew.com/health` — ok.
- `http://hub.trendsettercrew.com/…` → 301 на `https://` тот же путь; purchasing/airflow/weeek-mcp отвечают как до переезда.
- 1–3 рабочих дня без жалоб; Vercel всё это время не отключён.
- После этапа 6: CI на PR и Deploy с `main` зелёные в приватном репо; `git fetch` на сервере работает по deploy key.

## 7. Проверить по документации (technical-analyst, не блокирует PR1)
- T-F3. Caddy 2: повторные попытки ACME (TLS-ALPN) при неудаче — подтверждает ли правило «имя `hub.` в Caddy только после смены DNS»; `try_files` и `header` внутри `handle`; `encode zstd gzip` с `file_server`.
- T-F4. Смена видимости public → private: что происходит с секретами, workflow и `workflow_run`, правилами веток, deploy keys.
- (T-F1 закрыт данными биллинга; T-F2 не нужен — причина переезда подтверждена владельцем.)

## 8. Вопросы
**Закрыты:**
- Q-F1 — превью PR пропадают: принято.
- Q-F2 — минуты Actions: ≈ 430 мин за октябрь, Billed $0, перерасход $0,006/мин; рекомендация — бюджет с оповещением (этап 0); `paths`-фильтры/ускорение CI — позже, отдельной задачей при необходимости.
- Q-F3 — `VITE_API_URL=https://hub-api.trendsettercrew.com` (Production), `VITE_DEMO_MODE=false` ставим в Actions.
- Q-F4 — порт 80 у nginx, 443 у Caddy: редирект http→https делает отдельный `server{}` nginx (этап 0).
- Q-F5 — ключ деплоя хаба без `command=`; фактическая проверка — `scp` при первом прогоне (этап 1).
- Q-F6 — клон `/opt/trendsetter-hub/repo` по SSH; чей ключ — шаг 6.1, два сценария.
- Q-F9 — имя `hub-next`.

**По умолчанию (можно изменить до этапа 5):** Q-F10 — демо на моках `trendsetter-hab.vercel.app` удаляется вместе с проектом Vercel.

**Открыты, вне этого ТЗ:**
- Q-F7 — «`/api` на том же домене» без CORS (идея Дианы) — отдельной задачей или нет.
- Q-F8 — Content-Security-Policy — отдельной задачей (Google Fonts, `hub-api`, `blob:`/`data:` для выгрузок xlsx).
- Q-F11 — `CLAUDE.md` и `ARCHITECTURE.md` (Vercel как демо-витрина) устарели — обновить пользователю отдельно; исполнитель их не трогает.

## 9. Риски
- Сборка без `VITE_API_URL` → тихие моки и localStorage у склада. Закрыто проверкой в workflow и ручной проверкой 6.2.
- Запись `hub-next`/`hub` случайно создана как Proxied (оранжевое облако) → Caddy не выпустит сертификат. Закрыто явным «DNS only» в шагах.
- Окно без сертификата при переключении — только у клиентов, получивших новый IP раньше, чем Caddy выпустил сертификат (секунды–минута при порядке этапа 3). Остальные до 5 мин ходят на работающий Vercel.
- Ошибка в nginx-конфиге задела бы purchasing/airflow — закрыто `nginx -t` до reload и отдельным файлом только с нашими именами.
- Перевод в приватный при ключе другого репо/пользователя — бэкенд-деплой ломается. Закрыто шагом 6.1.
- Открытые вкладки: сохраняются ассеты одного предыдущего поколения; вкладка, открытая два деплоя назад, может получить ошибку загрузки ленивой страницы — помогает F5 (на Vercel было так же).
- Нагрузка на общий сервер: только раздача статики Caddy, ≈ 3 МБ на релиз × 5 — несущественно.
