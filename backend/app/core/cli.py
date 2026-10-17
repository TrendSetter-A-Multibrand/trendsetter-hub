"""Команды администрирования.

  python -m app.core.cli create-superadmin --email you@example.com --name "Имя Фамилия"

Пароль запрашивается интерактивно (getpass): не принимается из аргументов, окружения и не пишется в журналы.
Команда выполняет обычные INSERT, поэтому работает под пользователем hub_app.
"""
import argparse
import getpass
import sys

from sqlalchemy import func, select

from app.core import messages as m
from app.core.audit import log_action
from app.core.models import User
from app.core.security import hash_password, password_is_valid
from app.core.validation import is_valid_email
from app.db.database import get_engine
from sqlalchemy.orm import Session


def create_superadmin(session: Session, email: str, name: str, password: str) -> User:
    if not is_valid_email(email):
        raise ValueError(m.EMAIL_INVALID)
    if not name.strip():
        raise ValueError(m.FULL_NAME_EMPTY)
    if not password_is_valid(password):
        raise ValueError(m.PASSWORD_INVALID)
    if session.scalar(select(User.id).where(func.lower(User.email) == email.strip().lower())):
        raise ValueError(m.EMAIL_DUPLICATE)
    user = User(email=email.strip(), full_name=name.strip(), access_level="admin", password_hash=hash_password(password), is_active=True)
    session.add(user)
    session.flush()
    log_action(session, user.id, "cli.create_superadmin")
    session.commit()
    return user


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="app.core.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    create = sub.add_parser("create-superadmin", help="создать администратора (уровень admin)")
    create.add_argument("--email", required=True)
    create.add_argument("--name", required=True)
    args = parser.parse_args(argv)

    password = getpass.getpass("Пароль (от 8 символов): ")
    if password != getpass.getpass("Повторите пароль: "):
        print("Пароли не совпадают", file=sys.stderr)
        return 1
    # expire_on_commit=False: данные созданного пользователя читаются после коммита и закрытия сессии
    with Session(get_engine(), expire_on_commit=False) as session:
        try:
            user = create_superadmin(session, args.email, args.name, password)
        except ValueError as e:
            print(str(e), file=sys.stderr)
            return 1
    print(f"Администратор создан: {user.email}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
