#!/usr/bin/env bash
# Обновление бэкенда хаба на сервере: git pull, пересборка, проверка /health, откат при ошибке.
# Запускается из GitHub Actions (ssh ... 'bash -s' -- /путь/к/репозиторию < deploy/deploy.sh) или вручную на сервере.
# Миграции Alembic НЕ выполняются: пароля doadmin на сервере нет (см. stamp_alembic.sql). Новые ревизии применяются отдельно.
set -euo pipefail

REPO="${1:?Передайте путь к репозиторию на сервере первым аргументом}"
COMPOSE=(docker compose -f docker-compose.prod.yml)
HEALTH_URL="http://127.0.0.1:8010/health"

cd "$REPO"
prev="$(git rev-parse HEAD)"
git fetch --quiet origin main
git merge --ff-only origin/main
new="$(git rev-parse HEAD)"

wait_healthy() {
  for _ in $(seq 1 30); do
    if curl -fsS --max-time 3 "$HEALTH_URL" > /dev/null; then return 0; fi
    sleep 3
  done
  return 1
}

deploy() {
  (cd deploy && "${COMPOSE[@]}" up -d --build)
}

echo "Деплой ${prev:0:7} -> ${new:0:7}"
if deploy && wait_healthy; then
  echo "Готово: бэкенд отвечает на /health"
  exit 0
fi

echo "Ошибка: бэкенд не поднялся, откат на ${prev:0:7}" >&2
git reset --hard "$prev"
deploy || true
wait_healthy && echo "Откат выполнен, прежняя версия работает" >&2 || echo "ВНИМАНИЕ: после отката /health тоже не отвечает" >&2
exit 1
