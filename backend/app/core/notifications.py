"""Уведомления внутри хаба (колокольчик). Почты и мессенджера нет. TODO(Q-D4): канал вне хаба (Telegram-бот / почта)."""
from collections.abc import Iterable

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.models import Notification


def notify(session: Session, user_ids: Iterable[int], kind: str, title: str, body: str = "", link: str | None = None) -> None:
    """Добавляет уведомления (по одному на пользователя, без дублей). Коммитит вызывающий код."""
    for user_id in sorted(set(user_ids)):
        session.add(Notification(user_id=user_id, kind=kind, title=title, body=body, link=link))


def unread_count(session: Session, user_id: int) -> int:
    return session.scalar(select(func.count()).select_from(Notification).where(Notification.user_id == user_id, Notification.read_at.is_(None))) or 0
