#!/usr/bin/env bash
# Выкат сайта хаба на сервере: релизы в WEB_ROOT/releases/<sha>, симлинк current, откат = переключить симлинк.
# Запускается из GitHub Actions (ssh ... 'bash -s' -- <WEB_ROOT> <команда> [sha] < deploy/deploy-frontend.sh) или вручную:
#   bash deploy-frontend.sh <WEB_ROOT> activate <sha40> | rollback [sha40] | status
# Архив сайта должен лежать в WEB_ROOT/incoming/<sha>.tgz (его кладёт workflow через scp).
# Скрипт не вызывает sudo, не трогает Caddy и не ходит в сеть. Подробности — docs/TZ-frontend-move.md.
set -euo pipefail
umask 022

WEB_ROOT="${1:?Передайте путь к каталогу сайта (WEB_ROOT) первым аргументом}"
CMD="${2:-}"
ARG="${3:-}"
KEEP=5

usage() {
  echo "Использование: bash deploy-frontend.sh <WEB_ROOT> activate <sha40> | rollback [sha40] | status" >&2
  exit 2
}

# Атомарно переключает current на releases/<sha>
switch_current() {
  ln -sfn "releases/$1" current.tmp
  mv -Tf current.tmp current
}

# sha активного релиза (пусто, если current нет)
current_sha() {
  if [ -L current ]; then
    basename "$(readlink current)"
  fi
}

activate() {
  local sha="$1" prev tmp
  if ! [[ "$sha" =~ ^[0-9a-f]{40}$ ]]; then
    echo "Ошибка: sha должен быть 40 символов [0-9a-f]" >&2
    exit 1
  fi
  if [ ! -f "incoming/$sha.tgz" ]; then
    echo "Ошибка: нет архива incoming/$sha.tgz" >&2
    exit 1
  fi

  prev="$(current_sha)"
  if [ "$prev" = "$sha" ]; then
    rm -f "incoming/$sha.tgz"
    echo "Сборка ${sha:0:7} уже активна"
    exit 0
  fi

  tmp="releases/$sha.tmp"
  rm -rf "$tmp"
  mkdir -p "$tmp"
  if ! tar -xzf "incoming/$sha.tgz" -C "$tmp" --no-same-owner --no-same-permissions; then
    rm -rf "$tmp"
    echo "Ошибка: архив не распаковывается" >&2
    exit 1
  fi
  chmod -R u=rwX,go=rX "$tmp"

  if [ ! -f "$tmp/index.html" ]; then
    rm -rf "$tmp"; echo "Ошибка: в архиве нет index.html" >&2; exit 1
  fi
  if [ ! -f "$tmp/version.txt" ] || [ "$(tr -d '\r\n' < "$tmp/version.txt")" != "$sha" ]; then
    rm -rf "$tmp"; echo "Ошибка: version.txt отсутствует или не равен $sha" >&2; exit 1
  fi
  if [ ! -d "$tmp/assets" ] || ! find "$tmp/assets" -maxdepth 1 -type f -name '*.js' | grep -q .; then
    rm -rf "$tmp"; echo "Ошибка: в архиве нет assets/*.js" >&2; exit 1
  fi

  # Собственные файлы релиза (до копирования старых)
  ls -1 "$tmp/assets" > "releases/$sha.assets"

  # Ассеты предыдущего поколения — для открытых вкладок со старыми чанками
  if [ -n "$prev" ] && [ -f "releases/$prev.assets" ] && [ -d "releases/$prev/assets" ]; then
    while IFS= read -r f; do
      [ -n "$f" ] && [ -f "releases/$prev/assets/$f" ] && cp -n "releases/$prev/assets/$f" "$tmp/assets/" || true
    done < "releases/$prev.assets"
  fi

  rm -rf "releases/$sha"
  mv "$tmp" "releases/$sha"

  switch_current "$sha"
  if [ -n "$prev" ]; then
    printf '%s\n' "$prev" > previous
  fi

  cleanup "$sha"
  rm -f "incoming/$sha.tgz"
  echo "Фронтенд: ${prev:0:7} -> ${sha:0:7}"
}

# Оставляет KEEP самых новых релизов; текущий и previous не удаляет
cleanup() {
  local cur="$1" prv="" d name n=0
  [ -f previous ] && prv="$(tr -d '\r\n' < previous)"
  # shellcheck disable=SC2012,SC2045
  for d in $(ls -1dt releases/*/ 2>/dev/null); do
    name="$(basename "$d")"
    case "$name" in *.tmp) continue ;; esac
    n=$((n + 1))
    if [ "$n" -le "$KEEP" ] || [ "$name" = "$cur" ] || [ "$name" = "$prv" ]; then continue; fi
    rm -rf "releases/$name" "releases/$name.assets"
  done
}

rollback() {
  local target="$1" cur
  cur="$(current_sha)"
  if [ -z "$target" ] && [ -f previous ]; then
    target="$(tr -d '\r\n' < previous)"
  fi
  if [ -z "$target" ]; then
    echo "Ошибка: предыдущего релиза нет (файл previous пуст), укажите sha явно" >&2
    exit 1
  fi
  if ! [[ "$target" =~ ^[0-9a-f]{40}$ ]] || [ ! -d "releases/$target" ]; then
    echo "Ошибка: релиза releases/$target нет на сервере" >&2
    exit 1
  fi
  switch_current "$target"
  if [ -n "$cur" ] && [ "$cur" != "$target" ]; then
    printf '%s\n' "$cur" > previous
  fi
  echo "Откат фронтенда на ${target:0:7}"
}

status() {
  local cur prv=""
  cur="$(current_sha)"
  [ -f previous ] && prv="$(tr -d '\r\n' < previous)"
  echo "current:  ${cur:-нет}"
  echo "previous: ${prv:-нет}"
  echo "релизы (новые сверху):"
  # shellcheck disable=SC2012,SC2045
  ls -1dt releases/*/ 2>/dev/null | while read -r d; do basename "$d"; done || true
}

case "$CMD" in
  activate|rollback|status) ;;
  *) usage ;;
esac

cd "$WEB_ROOT"
mkdir -p incoming releases

case "$CMD" in
  activate) activate "${ARG:?Передайте sha коммита (40 символов)}" ;;
  rollback) rollback "$ARG" ;;
  status) status ;;
esac
