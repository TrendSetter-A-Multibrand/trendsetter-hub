"""Модуль «HR»: досье сотрудника, деньги и документы, отпуска (заявки, согласование, календарь), нормы отпуска, уведомления.

Таблицы hr_* (db/05_hr_dossier.sql). Права: Hr — право run на hr; Resp — право responsible на hr (деньги, документы, нормы);
личное право на модуль задаёт админ (user_module_permissions). В журнал (log_action) пишутся только id и имена полей:
значения досье, денег и документов, а также тексты сообщений не пишутся.
"""
import base64
import binascii
import calendar as pycalendar
import logging
import re
import unicodedata
from datetime import date
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core import crypto
from app.core import messages as m
from app.core.audit import log_action
from app.core.deps import module_rights
from app.core.models import User
from app.core.notifications import notify
from app.modules.hr import leave as calc
from app.modules.team import service as team_service

MODULE_ID = "hr"
H = "trendsetter_hub.hr_"
T = "trendsetter_hub.team_"
U = "trendsetter_hub.users"

COUNTRIES = ("RU", "AM")
EMPLOYMENT_TYPES = ("staff", "gph", "ip", "other")
KINDS = ("annual", "unpaid", "study", "sick", "other")
STATUSES = ("pending", "approved", "rejected", "cancelled")
CALENDAR_MAX_DAYS = 400
MESSAGE_LIMIT = 1000
COMMENT_LIMIT = 500
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

MSG_PERSON_NOT_FOUND = "Сотрудник не найден"
MSG_REQUEST_NOT_FOUND = "Заявка не найдена"
MSG_NO_PERSON = "Сначала заполните анкету: карточка сотрудника не найдена"
MSG_KIND = "Неизвестный вид отпуска"
MSG_DATES = "Укажите даты в формате ГГГГ-ММ-ДД; конец не раньше начала"
MSG_PAST = "Нельзя подать заявку на прошедшие даты"
MSG_OVERLAP = "На эти даты уже есть заявка"
MSG_MESSAGE = f"Сообщение коллегам не длиннее {MESSAGE_LIMIT} символов"
MSG_NOT_PENDING = "Заявка уже обработана"
MSG_COMMENT = f"Укажите причину отказа (до {COMMENT_LIMIT} символов)"
MSG_CANNOT_CANCEL = "Эту заявку нельзя отозвать"
MSG_RANGE = f"Период не больше {CALENDAR_MAX_DAYS} дней"
MSG_COUNTRY = "Страна не найдена"
MSG_STATUS = "Неизвестный статус"
MSG_FIELD = "Проверьте значение поля: {}"
MSG_ADJUST = "Укажите число дней (не 0, по модулю до 999) и причину (до 300 символов)"


def fail(status: int, message: str):
    raise HTTPException(status, message)


# ---------- шифрование ПДн (app/core/crypto.py) ----------
ENCRYPTED_COLUMNS = ("bonus_note", "tax_id", "social_id", "passport", "bank_details")  # salary (numeric) не шифруется, TODO(Q-S1)
_crypto_log = logging.getLogger("app.hr.crypto")


def protect_text(value: str | None) -> str | None:
    """Текст перед записью в БД. Без ключа — 503: ПДн не пишем открытым текстом."""
    if value is None:
        return None
    try:
        return crypto.encrypt_text(value)
    except crypto.KeyMissing:
        raise HTTPException(503, m.ENCRYPTION_NOT_CONFIGURED) from None


def reveal_text(value: str | None) -> str | None:
    if value is None or not crypto.is_encrypted_text(value):
        return value  # открытые значения (до encrypt_existing) читаются как есть
    try:
        return crypto.decrypt_text(value)
    except crypto.KeyMissing:
        raise HTTPException(503, m.ENCRYPTION_NOT_CONFIGURED) from None
    except crypto.DecryptError:
        _crypto_log.error("Не удалось расшифровать поле: %s", crypto.DecryptError.__name__)  # только тип ошибки
        raise HTTPException(500, m.DECRYPT_FAILED) from None


def protect_bytes(value: bytes) -> bytes:
    try:
        return crypto.encrypt_bytes(value)
    except crypto.KeyMissing:
        raise HTTPException(503, m.ENCRYPTION_NOT_CONFIGURED) from None


def reveal_bytes(value: bytes) -> bytes:
    value = bytes(value)
    if not crypto.is_encrypted_bytes(value):
        return value
    try:
        return crypto.decrypt_bytes(value)
    except crypto.KeyMissing:
        raise HTTPException(503, m.ENCRYPTION_NOT_CONFIGURED) from None
    except crypto.DecryptError:
        _crypto_log.error("Не удалось расшифровать документ: %s", crypto.DecryptError.__name__)
        raise HTTPException(500, m.DECRYPT_FAILED) from None


def fmt(d: date) -> str:
    return d.strftime("%d.%m.%Y")


def num(x) -> float | None:
    return None if x is None else float(x)


# ---------- права ----------


def hr_rights(session: Session, user: User) -> tuple[str, bool]:
    return module_rights(session, user, [MODULE_ID])[MODULE_ID]


def is_hr(session: Session, user: User) -> bool:
    return hr_rights(session, user)[0] == "run"


def is_responsible(session: Session, user: User) -> bool:
    return hr_rights(session, user)[1]


def hr_user_ids(session: Session) -> set[int]:
    """Все активные пользователи с правом run на hr."""
    users = session.scalars(select(User).where(User.is_active.is_(True))).all()
    return {u.id for u in users if module_rights(session, u, [MODULE_ID])[MODULE_ID][0] == "run"}


def badge(session: Session, user: User) -> int:
    """Бейдж hr: заявки анкет на проверке + заявки на отпуск, ожидающие HR (у руководителя нет аккаунта). Только для HR."""
    if not is_hr(session, user):
        return 0
    forms = team_service.pending_badge(session, user)
    leaves = session.execute(text(f"SELECT count(*) FROM {H}leave_requests WHERE status = 'pending' AND approver_user_id IS NULL")).scalar_one()
    return forms + leaves


# ---------- общее ----------


def _person(session: Session, person_id: int, *, lock: bool = False):
    suffix = " FOR UPDATE" if lock else ""
    row = session.execute(
        text(f"SELECT id, user_id, first_name, last_name, manager_id, is_archived FROM {T}people WHERE id = :i{suffix}"), {"i": person_id}
    ).mappings().first()
    if row is None:
        fail(404, MSG_PERSON_NOT_FOUND)
    return row


def _name(p) -> str:
    return f"{p['last_name']} {p['first_name']}".strip()


def _date(value, *, required: bool = True) -> date | None:
    if value is None or value == "":
        if required:
            fail(422, MSG_DATES)
        return None
    if not isinstance(value, str) or not DATE_RE.match(value):
        fail(422, MSG_DATES)
    try:
        return date.fromisoformat(value)
    except ValueError:
        fail(422, MSG_DATES)


def _policy_row(session: Session, country: str):
    return session.execute(text(f"SELECT * FROM {H}leave_policies WHERE country = :c"), {"c": country}).mappings().first()


def _policy_out(r) -> dict:
    return {
        "country": r["country"], "daysPerYear": num(r["days_per_year"]), "accruePerMonth": num(r["accrual_per_month"]),
        "firstLeaveAfterMonths": r["first_leave_after_months"],
    }


def _file_row(session: Session, person_id: int):
    return session.execute(text(f"SELECT * FROM {H}employee_files WHERE person_id = :p"), {"p": person_id}).mappings().first()


# ---------- заявки на отпуск ----------

REQUEST_SQL = f"""SELECT r.id, r.person_id, r.kind, r.start_date, r.end_date, r.days, r.message, r.status, r.approver_user_id,
       r.decided_at, r.decision_comment, r.created_at, p.first_name, p.last_name, d.full_name AS decider
       FROM {H}leave_requests r JOIN {T}people p ON p.id = r.person_id LEFT JOIN {U} d ON d.id = r.decided_by"""


def _request_out(r) -> dict:
    return {
        "id": r["id"], "personId": r["person_id"], "personName": _name(r), "kind": r["kind"], "start": r["start_date"].isoformat(),
        "end": r["end_date"].isoformat(), "days": num(r["days"]), "message": r["message"], "status": r["status"], "decidedBy": r["decider"],
        "decidedAt": r["decided_at"].isoformat() if r["decided_at"] else None, "decisionComment": r["decision_comment"],
        "createdAt": r["created_at"].isoformat(),
        "awaitingHr": r["status"] == "pending" and r["approver_user_id"] is None,
    }


def _request(session: Session, request_id: int) -> dict:
    row = session.execute(text(REQUEST_SQL + " WHERE r.id = :i"), {"i": request_id}).mappings().first()
    if row is None:
        fail(404, MSG_REQUEST_NOT_FOUND)
    return _request_out(row)


def _person_requests(session: Session, person_id: int) -> list[dict]:
    rows = session.execute(text(REQUEST_SQL + " WHERE r.person_id = :p ORDER BY r.start_date DESC, r.id DESC"), {"p": person_id}).mappings().all()
    return [_request_out(r) for r in rows]


def _balance(session: Session, person_id: int, today: date) -> tuple[dict | None, dict | None]:
    """(политика страны карточки, баланс). Нет карточки досье — страна RU; нет даты приёма — баланс None."""
    file = _file_row(session, person_id)
    policy = _policy_row(session, (file["country"] if file else None) or "RU")
    if policy is None:
        return None, None
    adjust = session.execute(text(f"SELECT coalesce(sum(delta_days), 0) FROM {H}leave_adjustments WHERE person_id = :p"), {"p": person_id}).scalar_one()
    rows = session.execute(
        text(f"SELECT kind, status, end_date, days FROM {H}leave_requests WHERE person_id = :p AND status = 'approved'"), {"p": person_id}
    ).all()
    balance = calc.compute_balance(
        hired_at=file["hired_at"] if file else None,
        accrual_per_month=policy["accrual_per_month"],
        first_leave_after_months=policy["first_leave_after_months"],
        adjust=adjust,
        requests=[tuple(r) for r in rows],
        today=today,
    )
    out = None
    if balance is not None:
        out = {k: num(v) for k, v in balance.items() if k != "available_from"}
        out["availableFrom"] = balance["available_from"].isoformat() if balance["available_from"] else None
    return _policy_out(policy), out


def _approver(session: Session, person) -> tuple[int | None, str | None]:
    """(user_id, имя) руководителя карточки, если у него есть активная учётка (и это не сам сотрудник)."""
    if person["manager_id"] is None:
        return None, None
    mgr = session.execute(
        text(f"SELECT p.user_id, p.first_name, p.last_name FROM {T}people p JOIN {U} u ON u.id = p.user_id AND u.is_active WHERE p.id = :m"),
        {"m": person["manager_id"]},
    ).mappings().first()
    if mgr is None or mgr["user_id"] == person["user_id"]:
        return None, None
    return mgr["user_id"], _name(mgr)


def _colleague_user_ids(session: Session, person, actor_id: int | None) -> set[int]:
    """Коллеги: неархивные с тем же руководителем, сам руководитель и все HR (run на hr). Без самого сотрудника и инициатора."""
    ids = set(hr_user_ids(session))
    if person["manager_id"] is not None:
        ids |= set(
            session.execute(
                text(
                    f"""SELECT user_id FROM {T}people WHERE user_id IS NOT NULL AND NOT is_archived AND id <> :p
                        AND (manager_id = :m OR id = :m)"""
                ),
                {"p": person["id"], "m": person["manager_id"]},
            ).scalars()
        )
    active = set(session.scalars(select(User.id).where(User.id.in_(ids), User.is_active.is_(True))).all()) if ids else set()
    return active - {person["user_id"], actor_id}


def _clean_message(value) -> str:
    if value is not None and not isinstance(value, str):
        fail(422, MSG_MESSAGE)
    v = (value or "").strip()
    if len(v) > MESSAGE_LIMIT:
        fail(422, MSG_MESSAGE)
    return v


def _parse_request(d: dict) -> tuple[str, date, date, str]:
    kind = d.get("kind")
    if kind not in KINDS:
        fail(422, MSG_KIND)
    start, end = _date(d.get("start")), _date(d.get("end"))
    if end < start:
        fail(422, MSG_DATES)
    return kind, start, end, _clean_message(d.get("message"))


def _check_overlap(session: Session, person_id: int, start: date, end: date) -> None:
    clash = session.execute(
        text(
            f"""SELECT 1 FROM {H}leave_requests WHERE person_id = :p AND status IN ('pending', 'approved')
                AND start_date <= :e AND end_date >= :s LIMIT 1"""
        ),
        {"p": person_id, "s": start, "e": end},
    ).first()
    if clash:
        fail(409, MSG_OVERLAP)


def _insert_request(session: Session, person, kind, start, end, message, *, status, approver_id, actor: User) -> int:
    decided = status == "approved"
    return session.execute(
        text(
            f"""INSERT INTO {H}leave_requests (person_id, kind, start_date, end_date, days, message, status, approver_user_id,
                    decided_by, decided_at, created_by)
                VALUES (:p, :k, :s, :e, :d, :m, :st, :a, :db, CASE WHEN :dec THEN now() END, :cb) RETURNING id"""
        ),
        {
            "p": person["id"], "k": kind, "s": start, "e": end, "d": calc.request_days(start, end), "m": message, "st": status, "a": approver_id,
            "db": actor.id if decided else None, "dec": decided, "cb": actor.id,
        },
    ).scalar_one()


def _notify_absence(session: Session, person, kind: str, start: date, end: date, message: str, actor_id: int | None, *, cancelled: bool = False) -> None:
    """Коллегам: «X не будет … с … по …» (или отмена). Больничные коллегам не рассылаются (причина отсутствия)."""
    if kind == "sick":
        return
    name = _name(person)
    if cancelled:
        title, body = "Отпуск отменён", f"{name}: отпуск с {fmt(start)} по {fmt(end)} отменён."
        notify_kind = "leave_cancelled"
    else:
        title = "Отсутствие коллеги"
        body = f"{name} не будет на работе с {fmt(start)} по {fmt(end)}." + (f" Сообщение: {message}" if message else "")
        notify_kind = "leave_approved"
    notify(session, _colleague_user_ids(session, person, actor_id), notify_kind, title, body, "/modules/team")


def get_my_leave(session: Session, user: User) -> dict:
    pid = team_service.resolve_own_person(session, user)
    if pid is None:
        return {"person": None, "policy": None, "balance": None, "requests": [], "approver": None}
    person = _person(session, pid)
    policy, balance = _balance(session, pid, date.today())
    _, approver_name = _approver(session, person)
    return {
        "person": {"id": pid, "name": _name(person)}, "policy": policy, "balance": balance,
        "requests": _person_requests(session, pid), "approver": {"name": approver_name} if approver_name else None,
    }


def get_my_file(session: Session, user: User) -> dict:
    """Только четыре поля своего базового досье (без денег и остального)."""
    pid = team_service.resolve_own_person(session, user)
    if pid is None:
        return {"person": None, "file": None}
    person = _person(session, pid)
    row = _file_row(session, pid)
    file = None
    if row is not None:
        file = {name: _out_value(kind, row[col]) for name, (col, kind, _) in FILE_FIELDS.items() if name in ("legalName", "hiredAt", "country", "workSchedule")}
    return {"person": {"id": pid, "name": _name(person)}, "file": file}


def create_my_request(session: Session, user: User, d: dict) -> dict:
    pid = team_service.resolve_own_person(session, user)
    if pid is None:
        fail(422, MSG_NO_PERSON)
    person = _person(session, pid, lock=True)
    kind, start, end, message = _parse_request(d)
    today = date.today()
    if start < today:
        fail(422, MSG_PAST)
    if kind == "annual":
        _, balance = _balance(session, pid, today)
        if balance and balance["availableFrom"] and start < date.fromisoformat(balance["availableFrom"]):
            fail(422, f"Право на отпуск возникает с {fmt(date.fromisoformat(balance['availableFrom']))}")
    _check_overlap(session, pid, start, end)
    approver_id, _ = _approver(session, person)
    request_id = _insert_request(session, person, kind, start, end, message, status="pending", approver_id=approver_id, actor=user)
    body = f"{_name(person)}: с {fmt(start)} по {fmt(end)}."
    if approver_id is not None:
        notify(session, [approver_id], "leave_request", "Заявка на отпуск", body, "/profile?section=approvals")
    else:
        notify(session, hr_user_ids(session) - {user.id}, "leave_request", "Заявка на отпуск ждёт HR", body, "/modules/hr")
    log_action(session, user.id, "hr.leave_request", MODULE_ID, request_id=request_id, person_id=pid, kind=kind)
    session.commit()
    return _request(session, request_id)


def cancel_my_request(session: Session, user: User, request_id: int) -> dict:
    pid = team_service.resolve_own_person(session, user)
    row = session.execute(
        text(f"SELECT person_id, kind, start_date, end_date, message, status FROM {H}leave_requests WHERE id = :i FOR UPDATE"), {"i": request_id}
    ).mappings().first()
    if row is None or pid is None or row["person_id"] != pid:
        fail(404, MSG_REQUEST_NOT_FOUND)
    approved = row["status"] == "approved"
    if row["status"] == "pending" or (approved and row["start_date"] >= date.today()):
        session.execute(text(f"UPDATE {H}leave_requests SET status = 'cancelled' WHERE id = :i"), {"i": request_id})
        if approved:
            _notify_absence(session, _person(session, pid), row["kind"], row["start_date"], row["end_date"], "", user.id, cancelled=True)
        log_action(session, user.id, "hr.leave_cancel", MODULE_ID, request_id=request_id, person_id=pid)
        session.commit()
        return _request(session, request_id)
    fail(409, MSG_NOT_PENDING if row["status"] != "approved" else MSG_CANNOT_CANCEL)


def cancel_request_by_hr(session: Session, hr: User, request_id: int) -> dict:
    """HR снимает любую pending/approved заявку (в том числе прошедшую или идущую); баланс пересчитывается сам."""
    row = session.execute(
        text(f"SELECT person_id, kind, start_date, end_date, status FROM {H}leave_requests WHERE id = :i FOR UPDATE"), {"i": request_id}
    ).mappings().first()
    if row is None:
        fail(404, MSG_REQUEST_NOT_FOUND)
    if row["status"] not in ("pending", "approved"):
        fail(409, MSG_CANNOT_CANCEL)
    person = _person(session, row["person_id"])
    session.execute(text(f"UPDATE {H}leave_requests SET status = 'cancelled' WHERE id = :i"), {"i": request_id})
    if row["status"] == "approved" and row["start_date"] >= date.today():
        _notify_absence(session, person, row["kind"], row["start_date"], row["end_date"], "", hr.id, cancelled=True)
    if person["user_id"] is not None and person["user_id"] != hr.id:
        period = f"с {fmt(row['start_date'])} по {fmt(row['end_date'])}"
        notify(session, [person["user_id"]], "leave_cancelled_by_hr", "HR отменил заявку", f"Заявка {period} отменена HR.", "/profile?section=leave")
    log_action(session, hr.id, "hr.leave_cancel", MODULE_ID, request_id=request_id, person_id=row["person_id"], by_hr=True)
    session.commit()
    return _request(session, request_id)


def my_approvals(session: Session, user: User) -> list[dict]:
    """Ожидают моего решения (pending) и недавно решённые мной (до 20)."""
    pending = session.execute(
        text(REQUEST_SQL + " WHERE r.status = 'pending' AND r.approver_user_id = :u ORDER BY r.created_at, r.id"), {"u": user.id}
    ).mappings().all()
    recent = session.execute(
        text(REQUEST_SQL + " WHERE r.decided_by = :u AND r.status IN ('approved', 'rejected') ORDER BY r.decided_at DESC, r.id DESC LIMIT 20"),
        {"u": user.id},
    ).mappings().all()
    return [_request_out(r) for r in (*pending, *recent)]


def decide(session: Session, user: User, request_id: int, approve: bool, comment: str | None) -> dict:
    row = session.execute(
        text(f"SELECT person_id, kind, start_date, end_date, message, status, approver_user_id FROM {H}leave_requests WHERE id = :i FOR UPDATE"),
        {"i": request_id},
    ).mappings().first()
    if row is None:
        fail(404, MSG_REQUEST_NOT_FOUND)
    if row["approver_user_id"] != user.id and not is_hr(session, user):
        fail(403, m.FORBIDDEN)
    if row["status"] != "pending":
        fail(409, MSG_NOT_PENDING)
    comment = (comment or "").strip()
    if len(comment) > COMMENT_LIMIT or (not approve and not comment):
        fail(422, MSG_COMMENT)
    person = _person(session, row["person_id"])
    session.execute(
        text(
            f"""UPDATE {H}leave_requests SET status = :st, decided_by = :u, decided_at = now(), decision_comment = :c WHERE id = :i"""
        ),
        {"st": "approved" if approve else "rejected", "u": user.id, "c": comment or None, "i": request_id},
    )
    period = f"с {fmt(row['start_date'])} по {fmt(row['end_date'])}"
    if approve:
        _notify_absence(session, person, row["kind"], row["start_date"], row["end_date"], row["message"], user.id)
        if person["user_id"] is not None and person["user_id"] != user.id:
            notify(session, [person["user_id"]], "leave_decision", "Отпуск согласован", f"Заявка {period} согласована.", "/profile?section=leave")
    elif person["user_id"] is not None and person["user_id"] != user.id:
        notify(session, [person["user_id"]], "leave_decision", "Отпуск отклонён", f"Заявка {period} отклонена. Причина: {comment}", "/profile?section=leave")
    log_action(session, user.id, "hr.leave_approve" if approve else "hr.leave_reject", MODULE_ID, request_id=request_id, person_id=row["person_id"])
    session.commit()
    return _request(session, request_id)


# ---------- календарь ----------


def calendar(session: Session, start: str, end: str) -> list[dict]:
    """Одобренные отсутствия (кроме больничных) неархивных людей карты за период; без сообщений и остатков."""
    d_from, d_to = _date(start), _date(end)
    if d_to < d_from:
        fail(422, MSG_DATES)
    if (d_to - d_from).days > CALENDAR_MAX_DAYS:
        fail(422, MSG_RANGE)
    rows = session.execute(
        text(
            f"""SELECT r.person_id, p.first_name, p.last_name, p.direction_id, r.kind, r.start_date, r.end_date
                FROM {H}leave_requests r JOIN {T}people p ON p.id = r.person_id
                WHERE r.status = 'approved' AND r.kind <> 'sick' AND NOT p.is_archived AND p.show_in_map
                AND r.start_date <= :t AND r.end_date >= :f ORDER BY r.start_date, r.id"""
        ),
        {"f": d_from, "t": d_to},
    ).mappings().all()
    return [
        {
            "personId": r["person_id"], "name": _name(r), "directionId": r["direction_id"], "kind": r["kind"],
            "start": r["start_date"].isoformat(), "end": r["end_date"].isoformat(),
        }
        for r in rows
    ]


# ---------- HR: досье ----------

# camelCase -> (колонка, тип, лимит)
FILE_FIELDS = {
    "legalName": ("legal_name", "text", 200), "birthDate": ("birth_date", "date", 0), "country": ("country", "country", 0),
    "employmentType": ("employment_type", "employment", 0), "hiredAt": ("hired_at", "date", 0),
    "probationUntil": ("probation_until", "date", 0), "contractNo": ("contract_no", "text", 100), "contractDate": ("contract_date", "date", 0),
    "workSchedule": ("work_schedule", "text", 200), "dismissedAt": ("dismissed_at", "date", 0),
    "dismissalReason": ("dismissal_reason", "text", 500), "phone": ("phone", "text", 50), "personalEmail": ("personal_email", "email", 200),
    "emergencyContact": ("emergency_contact", "text", 300), "notes": ("notes", "text", 4000),
}
SENSITIVE_FIELDS = {
    "salary": ("salary", "money", 0), "currency": ("currency", "text", 10), "payDay1": ("pay_day_1", "day", 0), "payDay2": ("pay_day_2", "day", 0),
    "bonusNote": ("bonus_note", "text", 1000), "taxId": ("tax_id", "text", 100), "socialId": ("social_id", "text", 100),
    "passport": ("passport", "text", 200), "bankDetails": ("bank_details", "text", 1000),
}


def _clean_field(name: str, kind: str, limit: int, value):
    if value is None:
        return None
    if kind == "date":
        return _date(value, required=False)
    if kind == "money":
        v = Decimal(value)
        if v < 0 or v >= Decimal(10) ** 10:
            fail(422, MSG_FIELD.format(name))
        return v
    if kind == "day":
        if not isinstance(value, int) or not 1 <= value <= 31:
            fail(422, MSG_FIELD.format(name))
        return value
    v = value.strip()
    if not v:
        return None
    if (kind in ("text", "email") and len(v) > limit) or (kind == "country" and v not in COUNTRIES) or (kind == "employment" and v not in EMPLOYMENT_TYPES):
        fail(422, MSG_FIELD.format(name))
    if kind == "email" and not EMAIL_RE.match(v):
        fail(422, m.EMAIL_INVALID)
    return v


def _out_value(kind: str, value):
    if value is None:
        return None
    return value.isoformat() if kind == "date" else num(value) if kind == "money" else value


def _upsert(session: Session, table: str, person_id: int, cols: dict, user: User) -> None:
    """Колонки приходят из белого списка FILE_FIELDS/SENSITIVE_FIELDS, не от пользователя."""
    names = list(cols)
    session.execute(
        text(
            f"""INSERT INTO {H}{table} (person_id, {", ".join(names)}, updated_by) VALUES (:person_id, {", ".join(":" + n for n in names)}, :updated_by)
                ON CONFLICT (person_id) DO UPDATE SET {", ".join(f"{n} = EXCLUDED.{n}" for n in names)}, updated_at = now(), updated_by = EXCLUDED.updated_by"""
        ),
        {**cols, "person_id": person_id, "updated_by": user.id},
    )


def _leave_block(session: Session, person_id: int) -> dict:
    policy, balance = _balance(session, person_id, date.today())
    adjustments = session.execute(
        text(
            f"""SELECT a.id, a.delta_days, a.reason, a.created_at, u.full_name FROM {H}leave_adjustments a LEFT JOIN {U} u ON u.id = a.created_by
                WHERE a.person_id = :p ORDER BY a.id DESC"""
        ),
        {"p": person_id},
    ).all()
    return {
        "policy": policy, "balance": balance, "requests": _person_requests(session, person_id),
        "adjustments": [{"id": a[0], "deltaDays": num(a[1]), "reason": a[2], "createdAt": a[3].isoformat(), "createdBy": a[4]} for a in adjustments],
    }


def get_file(session: Session, user: User, person_id: int) -> dict:
    _person(session, person_id)
    row = _file_row(session, person_id)
    file = {name: _out_value(kind, row[col] if row else None) for name, (col, kind, _) in FILE_FIELDS.items()}
    file["birthdayHidden"] = bool(row["birthday_hidden"]) if row else False
    return {"file": file, "leave": _leave_block(session, person_id), "canSeeSensitive": is_responsible(session, user)}


def update_file(session: Session, user: User, person_id: int, d: dict) -> dict:
    _person(session, person_id, lock=True)
    cols = {FILE_FIELDS[k][0]: _clean_field(k, FILE_FIELDS[k][1], FILE_FIELDS[k][2], v) for k, v in d.items() if k != "birthdayHidden"}
    if "birthdayHidden" in d:
        if not isinstance(d["birthdayHidden"], bool):
            fail(422, MSG_FIELD.format("birthdayHidden"))
        cols["birthday_hidden"] = d["birthdayHidden"]
    if cols:
        _upsert(session, "employee_files", person_id, cols, user)
        log_action(session, user.id, "hr.file_update", MODULE_ID, person_id=person_id, fields=sorted(d))
        session.commit()
    return get_file(session, user, person_id)


def get_sensitive(session: Session, person_id: int) -> dict:
    _person(session, person_id)
    row = session.execute(text(f"SELECT * FROM {H}employee_sensitive WHERE person_id = :p"), {"p": person_id}).mappings().first()
    return {
        name: _out_value(kind, (reveal_text(row[col]) if col in ENCRYPTED_COLUMNS else row[col]) if row else None)
        for name, (col, kind, _) in SENSITIVE_FIELDS.items()
    }


def view_sensitive(session: Session, user: User, person_id: int) -> dict:
    """GET /people/{id}/sensitive: чтение пишется в журнал (только person_id)."""
    data = get_sensitive(session, person_id)
    log_action(session, user.id, "hr.sensitive_view", MODULE_ID, person_id=person_id)
    session.commit()
    return data


MY_COMPENSATION_FIELDS = ("salary", "currency", "payDay1", "payDay2")


def get_my_compensation(session: Session, user: User) -> dict:
    """Решение Q-D5: сотрудник видит свой оклад. «Своя» карточка — строго по team_people.user_id; отдаём только 4 поля."""
    pid = _own_card_by_user_id(session, user)
    if pid is None:
        return {"person": None, "compensation": None}
    person = _person(session, pid)
    row = session.execute(text(f"SELECT * FROM {H}employee_sensitive WHERE person_id = :p"), {"p": pid}).mappings().first()
    compensation = None
    if row is not None:
        compensation = {name: _out_value(kind, row[col]) for name, (col, kind, _) in SENSITIVE_FIELDS.items() if name in MY_COMPENSATION_FIELDS}
    log_action(session, user.id, "hr.compensation_view", MODULE_ID, person_id=pid)
    session.commit()
    return {"person": {"id": pid, "name": _name(person)}, "compensation": compensation}


def _salary_pair(session: Session, person_id: int) -> tuple[Decimal | None, str | None]:
    row = session.execute(text(f"SELECT salary, currency FROM {H}employee_sensitive WHERE person_id = :p"), {"p": person_id}).first()
    return (row[0], row[1]) if row else (None, None)


def _salary_text(salary: Decimal | None, _currency: str | None = None) -> str | None:
    """«120000.00» (только число); пустой оклад — NULL."""
    return None if salary is None else f"{salary:.2f}"


def update_sensitive(session: Session, user: User, person_id: int, d: dict) -> dict:
    _person(session, person_id, lock=True)
    cols = {SENSITIVE_FIELDS[k][0]: _clean_field(k, SENSITIVE_FIELDS[k][1], SENSITIVE_FIELDS[k][2], v) for k, v in d.items()}
    stored = {c: protect_text(v) if c in ENCRYPTED_COLUMNS else v for c, v in cols.items()}  # 503 без ключа — до любой записи
    if cols:
        track_salary = "salary" in cols or "currency" in cols
        before = _salary_pair(session, person_id) if track_salary else None
        _upsert(session, "employee_sensitive", person_id, stored, user)
        if track_salary:
            after = _salary_pair(session, person_id)
            if after != before:
                from app.modules.hr import history  # отложенный импорт: history сам импортирует service

                history.record_auto(session, person_id, "salary", "Изменение оклада", _salary_text(*before), _salary_text(*after), user.id)
        log_action(session, user.id, "hr.sensitive_update", MODULE_ID, person_id=person_id, fields=sorted(d))  # только имена полей
        session.commit()
    return get_sensitive(session, person_id)


# ---------- HR: отпуска ----------


def create_request_for(session: Session, hr: User, person_id: int, d: dict) -> dict:
    """HR оформляет заявку за сотрудника (в том числе задним числом); approved — сразу, иначе pending у руководителя без уведомления."""
    person = _person(session, person_id, lock=True)
    kind, start, end, message = _parse_request(d)
    _check_overlap(session, person_id, start, end)
    status = "approved" if d.get("status") == "approved" else "pending"
    approver_id, _ = _approver(session, person) if status == "pending" else (None, None)
    request_id = _insert_request(session, person, kind, start, end, message, status=status, approver_id=approver_id, actor=hr)
    if status == "approved" and start >= date.today():
        _notify_absence(session, person, kind, start, end, message, hr.id)
    log_action(session, hr.id, "hr.leave_request", MODULE_ID, request_id=request_id, person_id=person_id, kind=kind, status=status, by_hr=True)
    session.commit()
    return _request(session, request_id)


def add_adjustment(session: Session, hr: User, person_id: int, d: dict) -> dict:
    _person(session, person_id, lock=True)
    delta = d.get("deltaDays")
    reason = (d.get("reason") or "").strip()
    if delta is None or Decimal(delta) == 0 or abs(Decimal(delta)) > 999 or not reason or len(reason) > 300:
        fail(422, MSG_ADJUST)
    adjustment_id = session.execute(
        text(f"INSERT INTO {H}leave_adjustments (person_id, delta_days, reason, created_by) VALUES (:p, :d, :r, :u) RETURNING id"),
        {"p": person_id, "d": Decimal(delta), "r": reason, "u": hr.id},
    ).scalar_one()
    log_action(session, hr.id, "hr.leave_adjust", MODULE_ID, person_id=person_id, adjustment_id=adjustment_id)
    session.commit()
    return next(a for a in _leave_block(session, person_id)["adjustments"] if a["id"] == adjustment_id)


def list_requests(session: Session, status: str, person_id: int | None) -> list[dict]:
    if status != "all" and status not in STATUSES:
        fail(422, MSG_STATUS)
    where, params = [], {}
    if status != "all":
        where.append("r.status = :st")
        params["st"] = status
    if person_id is not None:
        where.append("r.person_id = :p")
        params["p"] = person_id
    sql = REQUEST_SQL + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY r.created_at DESC, r.id DESC LIMIT 500"
    return [_request_out(r) for r in session.execute(text(sql), params).mappings().all()]


def list_policies(session: Session) -> list[dict]:
    return [_policy_out(r) for r in session.execute(text(f"SELECT * FROM {H}leave_policies ORDER BY country")).mappings().all()]


def update_policy(session: Session, user: User, country: str, d: dict) -> dict:
    if _policy_row(session, country) is None:
        fail(404, MSG_COUNTRY)
    cols = {}
    for key, col, low, high in (
        ("daysPerYear", "days_per_year", 0, Decimal(366)), ("accruePerMonth", "accrual_per_month", 0, Decimal(31)),
        ("firstLeaveAfterMonths", "first_leave_after_months", 0, Decimal(120)),
    ):
        if key in d:
            v = d[key]
            if v is None or not low <= Decimal(v) <= high or (key == "firstLeaveAfterMonths" and Decimal(v) != int(v)):
                fail(422, MSG_FIELD.format(key))
            cols[col] = int(v) if key == "firstLeaveAfterMonths" else Decimal(v)
    if cols:
        session.execute(
            text(f"UPDATE {H}leave_policies SET {', '.join(f'{c} = :{c}' for c in cols)}, updated_at = now() WHERE country = :country"),
            {**cols, "country": country},
        )
        log_action(session, user.id, "hr.policy_update", MODULE_ID, country=country, fields=sorted(d))
        session.commit()
    return _policy_out(_policy_row(session, country))


# ---------- Resp: документы сотрудника ----------

DOC_CATEGORIES = ("contract", "order", "id_doc", "tax", "bank", "medical", "other")
DOC_MAX_BYTES = 8 * 1024 * 1024
DOC_MAX_PER_PERSON = 50
DOC_TITLE_LIMIT = 120
DOC_NAME_LIMIT = 120
DOC_BASE64_LIMIT = (DOC_MAX_BYTES + 2) // 3 * 4  # длина base64 для файла максимального размера
_PDF, _JPEG, _PNG, _ZIP, _OLE = b"%PDF", b"\xff\xd8\xff", b"\x89PNG", b"PK\x03\x04", b"\xd0\xcf\x11\xe0"
# расширение -> (mime, допустимые начала файла; None — текст без нулевых байт, валидный UTF-8)
DOC_TYPES = {
    "pdf": ("application/pdf", (_PDF,)),
    "jpg": ("image/jpeg", (_JPEG,)),
    "jpeg": ("image/jpeg", (_JPEG,)),
    "png": ("image/png", (_PNG,)),
    "doc": ("application/msword", (_OLE,)),
    "docx": ("application/vnd.openxmlformats-officedocument.wordprocessingml.document", (_ZIP,)),
    "xls": ("application/vnd.ms-excel", (_OLE,)),
    "xlsx": ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", (_ZIP,)),
    "txt": ("text/plain", None),
}
MSG_DOC_NOT_FOUND = "Документ не найден"
MSG_DOC_CATEGORY = "Неизвестная категория документа"
MSG_DOC_TITLE = f"Введите название документа (до {DOC_TITLE_LIMIT} символов)"
MSG_DOC_NAME = "Укажите имя файла"
MSG_DOC_EXT = "Допустимые файлы: pdf, jpg, png, doc, docx, xls, xlsx, txt"
MSG_DOC_BASE64 = "Файл повреждён или передан неверно"
MSG_DOC_EMPTY = "Файл пустой"
MSG_DOC_SIZE = "Файл больше 8 МБ"
MSG_DOC_CONTENT = "Содержимое файла не соответствует его расширению"
MSG_DOC_LIMIT = f"У сотрудника уже {DOC_MAX_PER_PERSON} документов: удалите ненужные"


def _doc_file_name(value) -> tuple[str, str]:
    """Имя без путей и управляющих символов (до 120, расширение сохраняется) и расширение в нижнем регистре."""
    name = str(value or "").replace("\\", "/").rsplit("/", 1)[-1]
    name = "".join(c for c in name if unicodedata.category(c) not in ("Cc", "Cf", "Cs", "Zl", "Zp")).strip()
    if not name or name in (".", ".."):
        fail(422, MSG_DOC_NAME)
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext not in DOC_TYPES:
        fail(422, MSG_DOC_EXT)
    if len(name) > DOC_NAME_LIMIT:
        suffix = "." + name.rsplit(".", 1)[-1]
        name = name[: DOC_NAME_LIMIT - len(suffix)].rstrip() + suffix
    return name, ext


def _doc_content(data_base64, ext: str) -> bytes:
    if not isinstance(data_base64, str):
        fail(422, MSG_DOC_BASE64)
    if len(data_base64) > DOC_BASE64_LIMIT:
        fail(413, MSG_DOC_SIZE)
    try:
        content = base64.b64decode(data_base64, validate=True)
    except (binascii.Error, ValueError):
        fail(422, MSG_DOC_BASE64)
    if not content:
        fail(422, MSG_DOC_EMPTY)
    if len(content) > DOC_MAX_BYTES:
        fail(413, MSG_DOC_SIZE)
    heads = DOC_TYPES[ext][1]
    if heads is None:
        try:
            content.decode("utf-8")
        except UnicodeDecodeError:
            fail(422, MSG_DOC_CONTENT)
        if b"\x00" in content:
            fail(422, MSG_DOC_CONTENT)
    elif not content.startswith(heads):
        fail(422, MSG_DOC_CONTENT)
    return content


def _doc_out(r) -> dict:
    return {
        "id": r["id"], "category": r["category"], "title": r["title"], "fileName": r["file_name"], "mime": r["mime"],
        "sizeBytes": r["size_bytes"], "uploadedBy": r["uploader"], "uploadedAt": r["uploaded_at"].isoformat(),
        "visibleToEmployee": r["visible_to_employee"],
    }


DOC_SQL = (
    "SELECT d.id, d.person_id, d.category, d.title, d.file_name, d.mime, d.size_bytes, d.uploaded_at, d.visible_to_employee, u.full_name AS uploader "
    f"FROM {H}documents d LEFT JOIN {U} u ON u.id = d.uploaded_by"
)


def list_documents(session: Session, person_id: int) -> list[dict]:
    _person(session, person_id)
    rows = session.execute(text(DOC_SQL + " WHERE d.person_id = :p ORDER BY d.uploaded_at DESC, d.id DESC"), {"p": person_id}).mappings().all()
    return [_doc_out(r) for r in rows]


def view_documents(session: Session, user: User, person_id: int) -> list[dict]:
    """GET /people/{id}/documents: чтение списка пишется в журнал (только person_id)."""
    data = list_documents(session, person_id)
    log_action(session, user.id, "hr.documents_list", MODULE_ID, person_id=person_id)
    session.commit()
    return data


def upload_document(session: Session, user: User, person_id: int, d: dict) -> dict:
    _person(session, person_id, lock=True)  # замок на человека: лимит 50 не обходится параллельными загрузками
    category = d.get("category")
    if category not in DOC_CATEGORIES:
        fail(422, MSG_DOC_CATEGORY)
    title = d.get("title")
    title = title.strip() if isinstance(title, str) else ""
    if not 1 <= len(title) <= DOC_TITLE_LIMIT:
        fail(422, MSG_DOC_TITLE)
    visible = d.get("visibleToEmployee", False)
    if not isinstance(visible, bool):
        fail(422, MSG_FIELD.format("visibleToEmployee"))
    name, ext = _doc_file_name(d.get("fileName"))
    content = _doc_content(d.get("dataBase64"), ext)
    stored_content = protect_bytes(content)  # без ключа 503 — до любой записи
    count = session.execute(text(f"SELECT count(*) FROM {H}documents WHERE person_id = :p"), {"p": person_id}).scalar_one()
    if count >= DOC_MAX_PER_PERSON:
        fail(409, MSG_DOC_LIMIT)
    doc_id = session.execute(
        text(
            f"INSERT INTO {H}documents (person_id, category, title, file_name, mime, size_bytes, uploaded_by, visible_to_employee) "
            "VALUES (:p, :c, :t, :n, :m, :s, :u, :v) RETURNING id"
        ),
        {"p": person_id, "c": category, "t": title, "n": name, "m": DOC_TYPES[ext][0], "s": len(content), "u": user.id, "v": visible},
    ).scalar_one()
    session.execute(text(f"INSERT INTO {H}document_files (document_id, content) VALUES (:i, :c)"), {"i": doc_id, "c": stored_content})
    log_action(session, user.id, "hr.document_upload", MODULE_ID, document_id=doc_id, person_id=person_id, category=category)
    session.commit()
    return _doc_out(session.execute(text(DOC_SQL + " WHERE d.id = :i"), {"i": doc_id}).mappings().one())


def _document(session: Session, doc_id: int):
    row = session.execute(text(DOC_SQL + " WHERE d.id = :i"), {"i": doc_id}).mappings().first()
    if row is None:
        fail(404, MSG_DOC_NOT_FOUND)
    return row


def download_document(session: Session, user: User, doc_id: int) -> dict:
    doc = _document(session, doc_id)
    content = session.execute(text(f"SELECT content FROM {H}document_files WHERE document_id = :i"), {"i": doc_id}).scalar_one_or_none()
    if content is None:
        fail(404, MSG_DOC_NOT_FOUND)
    log_action(session, user.id, "hr.document_download", MODULE_ID, document_id=doc_id, person_id=doc["person_id"], category=doc["category"])
    session.commit()
    return {
        "fileName": doc["file_name"], "mime": doc["mime"], "sizeBytes": doc["size_bytes"],
        "dataBase64": base64.b64encode(reveal_bytes(content)).decode("ascii"),
    }


def delete_document(session: Session, user: User, doc_id: int) -> dict:
    doc = _document(session, doc_id)
    session.execute(text(f"DELETE FROM {H}documents WHERE id = :i"), {"i": doc_id})  # файл удаляется каскадом
    log_action(session, user.id, "hr.document_delete", MODULE_ID, document_id=doc_id, person_id=doc["person_id"], category=doc["category"])
    session.commit()
    return {"ok": True}


def update_document(session: Session, user: User, doc_id: int, d: dict) -> dict:
    """Флаг «Показывать сотруднику», название и категория (Resp). Значения в журнал не пишутся."""
    doc = _document(session, doc_id)
    cols = {}
    if "visibleToEmployee" in d:
        if not isinstance(d["visibleToEmployee"], bool):
            fail(422, MSG_FIELD.format("visibleToEmployee"))
        cols["visible_to_employee"] = d["visibleToEmployee"]
    if "title" in d:
        title = d["title"].strip() if isinstance(d["title"], str) else ""
        if not 1 <= len(title) <= DOC_TITLE_LIMIT:
            fail(422, MSG_DOC_TITLE)
        cols["title"] = title
    if "category" in d:
        if d["category"] not in DOC_CATEGORIES:
            fail(422, MSG_DOC_CATEGORY)
        cols["category"] = d["category"]
    if cols:
        session.execute(text(f"UPDATE {H}documents SET {', '.join(f'{c} = :{c}' for c in cols)} WHERE id = :_id"), {**cols, "_id": doc_id})
        log_action(session, user.id, "hr.document_update", MODULE_ID, document_id=doc_id, person_id=doc["person_id"], fields=sorted(d))
        session.commit()
    return _doc_out(_document(session, doc_id))


# ---------- Me: свои документы (только отмеченные HR) ----------


def _own_card_by_user_id(session: Session, user: User) -> int | None:
    """Документы чувствительны: «своя» карточка — только с team_people.user_id = пользователь (без поиска по почте и имени)."""
    return session.execute(text(f"SELECT id FROM {T}people WHERE user_id = :u"), {"u": user.id}).scalar()


def my_documents(session: Session, user: User) -> list[dict]:
    pid = _own_card_by_user_id(session, user)
    if pid is None:
        return []
    rows = session.execute(
        text(DOC_SQL + " WHERE d.person_id = :p AND d.visible_to_employee ORDER BY d.uploaded_at DESC, d.id DESC"), {"p": pid}
    ).mappings().all()
    return [
        {"id": r["id"], "category": r["category"], "title": r["title"], "fileName": r["file_name"], "sizeBytes": r["size_bytes"], "uploadedAt": r["uploaded_at"].isoformat()}
        for r in rows
    ]


def download_my_document(session: Session, user: User, doc_id: int) -> dict:
    pid = _own_card_by_user_id(session, user)
    doc = session.execute(text(DOC_SQL + " WHERE d.id = :i"), {"i": doc_id}).mappings().first()
    if doc is None or pid is None or doc["person_id"] != pid or not doc["visible_to_employee"]:
        fail(404, MSG_DOC_NOT_FOUND)  # чужой и скрытый документ неотличимы от несуществующего
    return download_document(session, user, doc_id)


# ---------- Team: дни рождения ----------

MONTH_RE = re.compile(r"^(\d{4})-(\d{2})$")
MSG_MONTH = "Укажите месяц в формате ГГГГ-ММ"


def birthdays(session: Session, month: str | None) -> list[dict]:
    """День и месяц без года и возраста; без скрытых HR, архивных и не показываемых на карте."""
    today = date.today()
    year, mon = today.year, today.month
    if month is not None:
        found = MONTH_RE.match(month)
        if not found or not 1 <= int(found.group(2)) <= 12:
            fail(422, MSG_MONTH)
        year, mon = int(found.group(1)), int(found.group(2))
    rows = session.execute(
        text(
            f"""SELECT p.id, p.first_name, p.last_name, p.direction_id, f.birth_date FROM {H}employee_files f JOIN {T}people p ON p.id = f.person_id
                WHERE f.birth_date IS NOT NULL AND extract(month FROM f.birth_date) = :m AND NOT f.birthday_hidden AND NOT p.is_archived AND p.show_in_map
                ORDER BY extract(day FROM f.birth_date), p.id"""
        ),
        {"m": mon},
    ).mappings().all()
    out = []
    for r in rows:
        day = min(r["birth_date"].day, pycalendar.monthrange(year, mon)[1])  # 29 февраля в невисокосный год — 28-е
        out.append({"personId": r["id"], "name": _name(r), "directionId": r["direction_id"], "day": day, "month": mon})
    return sorted(out, key=lambda b: (b["day"], b["personId"]))
