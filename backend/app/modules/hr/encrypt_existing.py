"""Разовая команда: шифрует уже сохранённые открытые ПДн HR (поля hr_employee_sensitive и содержимое hr_document_files).

  python -m app.modules.hr.encrypt_existing          # сухой прогон: только счётчики, ничего не пишется
  python -m app.modules.hr.encrypt_existing --apply  # записать (одной транзакцией)

Ключ — HUB_PII_KEY из окружения. Повторный запуск безопасен (зашифрованное пропускается). Перед записью каждое значение
проверяется обратной расшифровкой. Печатаются только счётчики: ни ключа, ни значений. Коды выхода: 0 — успех, 1 — ошибка, 2 — нет ключа.
"""
import argparse
import sys

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core import crypto
from app.core.audit import log_action
from app.db.database import get_engine
from app.modules.hr import service as hr

ACTION = "hr.encrypt_existing"


def run(session: Session, *, apply: bool) -> dict:
    """Возвращает счётчики. Коммитит только при apply=True; иначе откатывает."""
    counts = {"fields_encrypted": 0, "fields_already": 0, "documents_encrypted": 0, "documents_already": 0}
    for pid in session.execute(text(f"SELECT person_id FROM {hr.H}employee_sensitive ORDER BY person_id")).scalars().all():
        row = session.execute(text(f"SELECT {', '.join(hr.ENCRYPTED_COLUMNS)} FROM {hr.H}employee_sensitive WHERE person_id = :p FOR UPDATE"), {"p": pid}).mappings().one()
        changes = {}
        for col in hr.ENCRYPTED_COLUMNS:
            value = row[col]
            if value is None:
                continue
            if crypto.is_encrypted_text(value):
                counts["fields_already"] += 1
                continue
            token = crypto.encrypt_text(value)
            if crypto.decrypt_text(token) != value:
                raise RuntimeError("проверка расшифровки не прошла")
            changes[col] = token
            counts["fields_encrypted"] += 1
        if changes and apply:
            session.execute(
                text(f"UPDATE {hr.H}employee_sensitive SET {', '.join(f'{c} = :{c}' for c in changes)} WHERE person_id = :p"), {**changes, "p": pid}
            )
    for doc_id in session.execute(text(f"SELECT document_id FROM {hr.H}document_files ORDER BY document_id")).scalars().all():
        content = session.execute(text(f"SELECT content FROM {hr.H}document_files WHERE document_id = :i FOR UPDATE"), {"i": doc_id}).scalar_one()
        if crypto.is_encrypted_bytes(content):
            counts["documents_already"] += 1
            continue
        token = crypto.encrypt_bytes(bytes(content))
        if crypto.decrypt_bytes(token) != bytes(content):
            raise RuntimeError("проверка расшифровки не прошла")
        counts["documents_encrypted"] += 1
        if apply:
            session.execute(text(f"UPDATE {hr.H}document_files SET content = :c WHERE document_id = :i"), {"c": token, "i": doc_id})
    if apply:
        log_action(session, None, ACTION, hr.MODULE_ID, **counts)
        session.commit()
    else:
        session.rollback()
    return counts


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m app.modules.hr.encrypt_existing", description="Шифрование уже сохранённых ПДн HR")
    ap.add_argument("--apply", action="store_true", help="записать (по умолчанию сухой прогон)")
    args = ap.parse_args(argv)
    if not crypto.key_configured():
        print("HUB_PII_KEY не задан или неверного формата", file=sys.stderr)
        return 2
    try:
        with Session(get_engine()) as session:
            counts = run(session, apply=args.apply)
    except Exception as e:  # noqa: BLE001 — текст исключения может содержать данные, печатаем только тип
        print(f"Непредвиденная ошибка: {type(e).__name__}", file=sys.stderr)
        return 1
    print("Режим: " + ("запись" if args.apply else "сухой прогон (ничего не записано)"))
    print(f"Поля досье: зашифровано {counts['fields_encrypted']}, уже были зашифрованы {counts['fields_already']}")
    print(f"Документы: зашифровано {counts['documents_encrypted']}, уже были зашифрованы {counts['documents_already']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
