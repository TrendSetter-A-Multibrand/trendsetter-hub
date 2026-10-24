"""HR: чтение журнала (GET /modules/hr/audit). Доступ — responsible на hr или администратор (проверяется в router.py).
Значения полей в журнал не пишутся; наружу из `details` отдаётся только белый список ключей (docs/TZ-security.md, п. 3)."""
import re
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.audit import log_action
from app.core.models import User
from app.modules.hr import service as hr

DETAILS_WHITELIST = ("person_id", "document_id", "category", "kind", "rows", "sensitive", "fields", "count", "template_id", "year")
SCOPE_PREFIXES = ("hr.", "team.")
SCOPE_ACTIONS = ("core.user_permission_set", "core.password_change", "core.password_reset")
LIMIT_MAX = 200
AUDIT = "trendsetter_hub.audit_log"
MSG_DATE = "Укажите дату в формате ГГГГ-ММ-ДД"
MSG_ACTION = "Некорректный фильтр действий"
ACTION_RE = re.compile(r"^[a-z_]+\.[a-z_]+$")
ACTIONS_MAX = 40


def _actions(value: str | None) -> list[str]:
    """`action`: одно точное действие или список через запятую (до 40, формат `префикс.имя`)."""
    if not value:
        return []
    items = [a.strip() for a in value.split(",")]
    if len(items) > ACTIONS_MAX or not all(ACTION_RE.match(a) for a in items):
        hr.fail(422, MSG_ACTION)
    return items

# Единый словарь русских подписей действий; неизвестное действие отдаётся своим кодом.
ACTION_LABELS = {
    "hr.sensitive_view": "Просмотр денег и реквизитов",
    "hr.sensitive_update": "Изменены деньги и реквизиты",
    "hr.compensation_view": "Просмотр своего оклада",
    "hr.documents_list": "Просмотр списка документов",
    "hr.document_upload": "Документ загружен",
    "hr.document_download": "Документ скачан",
    "hr.document_update": "Документ изменён",
    "hr.document_delete": "Документ удалён",
    "hr.file_update": "Изменено досье",
    "hr.history_add": "Запись в историю добавлена",
    "hr.history_delete": "Запись из истории удалена",
    "hr.equipment_add": "Оборудование выдано",
    "hr.equipment_update": "Оборудование изменено",
    "hr.equipment_delete": "Оборудование удалено",
    "hr.leave_request": "Заявка на отпуск",
    "hr.leave_approve": "Отпуск согласован",
    "hr.leave_reject": "Отпуск отклонён",
    "hr.leave_cancel": "Заявка на отпуск отозвана",
    "hr.leave_adjust": "Корректировка отпуска",
    "hr.plan_add": "Отпуск запланирован",
    "hr.plan_cancel": "План отпуска отменён",
    "hr.plan_convert": "План отпуска превращён в заявку",
    "hr.policy_update": "Изменены нормы отпуска",
    "hr.checklist_start": "Чек-лист запущен",
    "hr.checklist_item": "Пункт чек-листа отмечен",
    "hr.checklist_close": "Чек-лист закрыт",
    "hr.checklist_cancel": "Чек-лист отменён",
    "hr.template_update": "Шаблон чек-листа изменён",
    "hr.export": "Экспорт в Excel",
    "hr.reminders_run": "Созданы напоминания",
    "hr.audit_view": "Просмотр журнала",
    "team.submit": "Анкета отправлена",
    "team.cancel": "Анкета отозвана",
    "team.approve": "Анкета принята",
    "team.reject": "Анкета отклонена",
    "team.person_create": "Карточка сотрудника создана",
    "team.person_update": "Карточка сотрудника изменена",
    "team.person_archive": "Карточка сотрудника в архиве",
    "team.field_create": "Поле анкеты добавлено",
    "team.field_update": "Поле анкеты изменено",
    "team.seed_import": "Импорт команды",
    "team.seed_rollback": "Откат импорта команды",
    "team.import_responses": "Импорт ответов анкет",
    "core.user_permission_set": "Изменены личные права на модуль",
    "core.password_change": "Пароль изменён сотрудником",
    "core.password_reset": "Пароль сброшен администратором",
}


def _clean_details(details: dict | None) -> dict:
    out: dict = {}
    for key in DETAILS_WHITELIST:
        value = (details or {}).get(key)
        if isinstance(value, (bool, int)) or (isinstance(value, str) and len(value) <= 100):
            out[key] = value
        elif isinstance(value, list) and all(isinstance(v, str) and len(v) <= 100 for v in value):
            out[key] = value
    return out


def _day(value: str | None, *, end: bool = False) -> datetime | None:
    if value is None:
        return None
    day = hr._date(value)  # 422 при неверном формате
    zone = ZoneInfo(get_settings().timezone)
    return datetime.combine(day + timedelta(days=1) if end else day, time.min, tzinfo=zone)


def list_audit(session: Session, user: User, person_id: int | None, action: str | None, date_from: str | None, date_to: str | None, limit: int, offset: int) -> dict:
    where = ["(a.action LIKE :p_hr OR a.action LIKE :p_team OR a.action = ANY(:scope))"]
    params: dict = {"p_hr": "hr.%", "p_team": "team.%", "scope": list(SCOPE_ACTIONS)}
    if person_id is not None:
        where.append("(a.details ->> 'person_id') = :person")
        params["person"] = str(person_id)
    actions = _actions(action)
    if actions:
        where.append("a.action = ANY(:actions)")
        params["actions"] = actions
    start, end = _day(date_from), _day(date_to, end=True)
    if start is not None:
        where.append("a.at >= :start")
        params["start"] = start
    if end is not None:
        where.append("a.at < :end")
        params["end"] = end
    clause = " AND ".join(where)
    total = session.execute(text(f"SELECT count(*) FROM {AUDIT} a WHERE {clause}"), params).scalar_one()
    rows = session.execute(
        text(
            f"""SELECT a.id, a.at, a.action, a.details, u.full_name FROM {AUDIT} a
                LEFT JOIN {hr.U} u ON u.id = a.user_id WHERE {clause} ORDER BY a.at DESC, a.id DESC LIMIT :limit OFFSET :offset"""
        ),
        {**params, "limit": limit, "offset": offset},
    ).mappings().all()
    ids = {r["details"]["person_id"] for r in rows if isinstance((r["details"] or {}).get("person_id"), int)}
    names: dict[int, str] = {}
    if ids:
        for p in session.execute(
            text(f"SELECT id, first_name, last_name FROM {hr.T}people WHERE id = ANY(:ids)"), {"ids": sorted(ids)}
        ).mappings():
            names[p["id"]] = hr._name(p)
    items = []
    for r in rows:
        details = _clean_details(r["details"])
        pid = details.get("person_id")
        pid = pid if isinstance(pid, int) and not isinstance(pid, bool) else None
        items.append(
            {
                "id": r["id"], "at": r["at"].isoformat(), "userName": r["full_name"], "action": r["action"],
                "label": ACTION_LABELS.get(r["action"], r["action"]), "personId": pid, "personName": names.get(pid) if pid is not None else None,
                "details": details,
            }
        )
    log_action(session, user.id, "hr.audit_view", hr.MODULE_ID)  # без фильтров, чтобы не раздувать журнал
    session.commit()
    return {"items": items, "total": total}
