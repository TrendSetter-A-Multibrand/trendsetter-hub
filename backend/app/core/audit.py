from sqlalchemy.orm import Session

from app.core.models import AuditLog


def log_action(session: Session, user_id: int | None, action: str, module_id: str | None = None, **details) -> None:
    """Запись в журнал. Коммитит вызывающий код вместе с основным действием."""
    session.add(AuditLog(user_id=user_id, action=action, module_id=module_id, details=details))
