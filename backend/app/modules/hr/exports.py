"""HR: экспорт в Excel (сотрудники — «всё, что есть», отпуска и баланс). Права: run на hr.
Содержимое файлов документов в файл не попадает никогда. Деньги и реквизиты (лист «Деньги и документы», записи истории kind=salary) —
только если у пользователя есть responsible на hr; тогда в журнал пишется sensitive=true. В журнал пишутся только вид, число строк и флаг.
Новая колонка: одна строка Col(...) в соответствующем списке ниже (поля анкеты добавляются сами по team_form_fields)."""
import base64
import io
import re
from datetime import date
from decimal import Decimal
from typing import Callable, NamedTuple

from openpyxl import Workbook
from openpyxl.styles import Font
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.audit import log_action
from app.core.models import User
from app.modules.hr import leave as calc
from app.modules.hr import service as hr
from app.modules.team import service as team_service

XLSX_NAME = "{}.xlsx"
KIND_LABELS = {"annual": "Ежегодный", "unpaid": "Без сохранения", "study": "Учебный", "sick": "Больничный", "other": "Другое"}
COLUMN_KEYS = {"first_name": "first_name", "last_name": "last_name", "title": "title", "email": "email"}
COUNTRY_LABELS = {"RU": "Россия", "AM": "Армения"}
EMPLOYMENT_LABELS = {"staff": "Штат", "gph": "ГПХ", "ip": "ИП", "other": "Другое"}
EQUIPMENT_LABELS = {"laptop": "Ноутбук", "phone": "Телефон", "monitor": "Монитор", "access_card": "Пропуск", "peripheral": "Периферия", "other": "Другое"}
HISTORY_LABELS = {"position": "Должность", "salary": "Оклад", "manager": "Руководитель", "direction": "Направление", "status": "Статус", "other": "Другое"}
CHECKLIST_KIND_LABELS = {"onboarding": "Онбординг", "offboarding": "Оффбординг"}
CHECKLIST_STATUS_LABELS = {"active": "Идёт", "done": "Завершён", "cancelled": "Отменён"}
LEAVE_STATUS_LABELS = {"pending": "На согласовании", "approved": "Одобрена"}
FORMULA_START = ("=", "+", "-", "@")
ILLEGAL_XML = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


class Col(NamedTuple):
    key: str
    header: str
    get: Callable[[dict], object]


def _yes(value) -> str:
    return "Да" if value else "Нет"


def _label(labels: dict, key: str):
    return lambda r: labels.get(r[key], r[key] or "")


def _plain(key: str, header: str) -> Col:
    return Col(key, header, lambda r: r[key])


def _balance_col(key: str, header: str) -> Col:
    return Col("balance_" + key, header, lambda r: r["balance"].get(key, ""))


# Лист «Сотрудники»: карточка -> досье -> баланс отпуска -> оборудование. Поля анкеты добавляются после них динамически.
EXPORT_COLUMNS = [
    Col("name", "ФИО", hr._name),
    _plain("first_name", "Имя"),
    _plain("last_name", "Фамилия"),
    _plain("title", "Должность"),
    _plain("direction", "Направление"),
    Col("manager", "Руководитель", lambda r: hr._name({"first_name": r["m_first"], "last_name": r["m_last"]}) if r["manager_id"] else ""),
    Col("status", "Статус", lambda r: "Уволен" if r["is_archived"] else "Работает"),
    _plain("tag", "Тег"),
    _plain("team", "Команда"),
    Col("show_in_map", "Показывать в карте", lambda r: _yes(r["show_in_map"])),
    Col("has_account", "Аккаунт привязан", lambda r: _yes(r["user_id"] is not None)),
    _plain("account_email", "Почта аккаунта"),
    _plain("email", "Корпоративная почта"),
    Col("completeness", "Заполнено, %", lambda r: r["completeness"]),
    Col("has_photo", "Есть фото", lambda r: _yes(r["has_photo"])),
    _plain("legal_name", "ФИО полностью"),
    _plain("birth_date", "Дата рождения"),
    Col("birthday_hidden", "Скрыть день рождения", lambda r: _yes(r["birthday_hidden"])),
    Col("country", "Страна", _label(COUNTRY_LABELS, "country")),
    Col("employment_type", "Тип занятости", _label(EMPLOYMENT_LABELS, "employment_type")),
    _plain("hired_at", "Дата приёма"),
    _plain("probation_until", "Испытательный до"),
    _plain("dismissed_at", "Дата увольнения"),
    _plain("dismissal_reason", "Причина увольнения"),
    _plain("contract_no", "Договор №"),
    _plain("contract_date", "Дата договора"),
    _plain("work_schedule", "График работы"),
    _plain("phone", "Телефон"),
    _plain("personal_email", "Личная почта"),
    _plain("emergency_contact", "Экстренный контакт"),
    _plain("notes", "Заметки HR"),
    _balance_col("accrued", "Отпуск: накоплено"),
    _balance_col("used", "Отпуск: использовано"),
    _balance_col("planned", "Отпуск: запланировано"),
    _balance_col("available", "Отпуск: доступно"),
    _plain("equipment_on_hands", "Оборудование на руках"),
]

# Лист «Деньги и документы» (только responsible). Содержимое файлов документов не выгружается — только их число.
SENSITIVE_COLUMNS = [
    Col("name", "ФИО", hr._name),
    Col("salary", "Оклад", lambda r: hr.num(r["salary"])),
    _plain("currency", "Валюта"),
    _plain("pay_day_1", "День выплаты 1"),
    _plain("pay_day_2", "День выплаты 2"),
    _plain("bonus_note", "Премии (заметка)"),
    _plain("tax_id", "ИНН"),
    _plain("social_id", "СНИЛС / ID"),
    _plain("passport", "Паспорт"),
    _plain("bank_details", "Реквизиты"),
    _plain("documents_count", "Документов"),
]

EQUIPMENT_COLUMNS = [
    Col("name", "ФИО", hr._name),
    Col("kind", "Вид", _label(EQUIPMENT_LABELS, "kind")),
    _plain("eq_name", "Название"),
    _plain("serial", "Серийный номер"),
    _plain("issued_at", "Выдано"),
    _plain("return_due", "Вернуть до"),
    _plain("returned_at", "Возвращено"),
    _plain("comment", "Комментарий"),
]

HISTORY_COLUMNS = [
    Col("name", "ФИО", hr._name),
    _plain("effective_date", "Дата"),
    Col("kind", "Вид", _label(HISTORY_LABELS, "kind")),
    _plain("h_title", "Заголовок"),
    _plain("old_value", "Было"),
    _plain("new_value", "Стало"),
    _plain("comment", "Комментарий"),
    Col("auto", "Автозапись", lambda r: _yes(r["auto"])),
    _plain("creator", "Кто внёс"),
]

CHECKLIST_COLUMNS = [
    Col("name", "ФИО", hr._name),
    Col("kind", "Вид", _label(CHECKLIST_KIND_LABELS, "kind")),
    _plain("c_title", "Название"),
    Col("status", "Статус", _label(CHECKLIST_STATUS_LABELS, "status")),
    _plain("started_at", "Начат"),
    _plain("done", "Выполнено"),
    _plain("total", "Всего"),
]

LEAVE_COLUMNS = [
    Col("name", "ФИО", hr._name),
    Col("kind", "Вид", _label(KIND_LABELS, "kind")),
    _plain("start_date", "С"),
    _plain("end_date", "По"),
    Col("days", "Дней", lambda r: hr.num(r["days"])),
    Col("status", "Статус", _label(LEAVE_STATUS_LABELS, "status")),
    _plain("message", "Сообщение"),
]


def _cell(value):
    """Даты — как ДД.ММ.ГГГГ; Decimal — число; управляющие символы, которые ломают xlsx, убираются."""
    if isinstance(value, date):
        return hr.fmt(value)
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, str):
        return ILLEGAL_XML.sub("", value)
    return value


def _as_text(cell) -> None:
    """Строка, начинающаяся с = + - @, остаётся текстом, а не формулой (защита от инъекции формул); значение не меняется."""
    if isinstance(cell.value, str) and cell.value.startswith(FORMULA_START):
        cell.data_type = "s"


def _file(sheets: list[tuple[str, list[str], list[list]]], name: str) -> dict:
    wb = Workbook()
    wb.remove(wb.active)
    for title, header, rows in sheets:
        ws = wb.create_sheet(title)
        ws.append([_cell(h) for h in header])
        for cell in ws[1]:
            cell.font = Font(bold=True)
            _as_text(cell)
        for row in rows:
            ws.append([_cell(v) for v in row])
            for cell in ws[ws.max_row]:
                _as_text(cell)
        for index, head in enumerate(header, 1):
            ws.column_dimensions[ws.cell(1, index).column_letter].width = max(12, min(40, len(head) + 4))
    buffer = io.BytesIO()
    wb.save(buffer)
    return {"fileName": XLSX_NAME.format(name), "dataBase64": base64.b64encode(buffer.getvalue()).decode("ascii")}


def _table(columns: list[Col], rows) -> tuple[list[str], list[list]]:
    return [c.header for c in columns], [[c.get(r) for c in columns] for r in rows]


def _answer_text(value) -> str:
    """Ответ анкеты в читаемый текст: chips — через запятую, links — «название: ссылка»."""
    if value is None:
        return ""
    if isinstance(value, list):
        parts = []
        for x in value:
            if isinstance(x, dict):
                parts.append(f"{x['label']}: {x.get('url', '')}" if x.get("label") else str(x.get("url", "")))
            else:
                parts.append(str(x))
        return ("; " if value and isinstance(value[0], dict) else ", ").join(parts)
    if isinstance(value, dict):
        return "; ".join(f"{k}: {v}" for k, v in value.items())
    return str(value)


def _form_columns(fields, taken: set[str]) -> list[Col]:
    """Колонки по ВСЕМ полям анкеты (и неактивным, и добавленным HR позже), кроме фото и полей, что уже есть в карточке."""
    out = []
    for f in fields:
        if f["kind"] == "photo" or f["key"] in COLUMN_KEYS:
            continue
        header = f["label"] if f["label"] not in taken else f"{f['label']} (анкета)"
        taken.add(header)
        out.append(Col("form_" + f["key"], header, lambda r, key=f["key"]: _answer_text((r["answers"] or {}).get(key))))
    return out


def _percent(fields, row, has_photo: bool) -> int:
    """Заполненность как на фронте (completeness.js): активные обязательные поля без manager_claim и фото, плюс фото."""
    items = []
    for f in fields:
        if not (f["active"] and f["required"]) or f["key"] in ("manager_claim", "photo") or f["kind"] == "photo":
            continue
        v = row[f["key"]] if f["key"] in COLUMN_KEYS else (row["answers"] or {}).get(f["key"])
        items.append(not (v is None or (isinstance(v, str) and not v.strip()) or v == [] or v == {}))
    items.append(has_photo)
    return round(sum(items) / len(items) * 100)


def _balances(session: Session, people: list[dict], leave_rows: list[dict]) -> dict[int, dict]:
    """Баланс отпуска всех сразу (2 запроса вместо 4 на человека): те же правила, что hr._balance."""
    policies = {r["country"]: r for r in session.execute(text(f"SELECT * FROM {hr.H}leave_policies")).mappings().all()}
    adjust = {r[0]: r[1] for r in session.execute(text(f"SELECT person_id, sum(delta_days) FROM {hr.H}leave_adjustments GROUP BY person_id")).all()}
    requests: dict[int, list] = {}
    for r in leave_rows:
        if r["status"] == "approved":
            requests.setdefault(r["person_id"], []).append((r["kind"], r["status"], r["end_date"], r["days"]))
    today = date.today()
    out = {}
    for p in people:
        policy = policies.get(p["country"] or "RU")
        b = None
        if policy is not None:
            b = calc.compute_balance(
                hired_at=p["hired_at"], accrual_per_month=policy["accrual_per_month"], first_leave_after_months=policy["first_leave_after_months"],
                adjust=adjust.get(p["id"], Decimal(0)), requests=requests.get(p["id"], []), today=today,
            )
        out[p["id"]] = {k: hr.num(v) for k, v in b.items() if k != "available_from"} if b else {}
    return out


PEOPLE_SQL = f"""SELECT p.id, p.user_id, p.email, p.first_name, p.last_name, p.title, p.manager_id, p.tag, p.team, p.show_in_map, p.is_archived, p.answers,
    d.label AS direction, m.first_name AS m_first, m.last_name AS m_last, u.email AS account_email,
    EXISTS (SELECT 1 FROM {hr.T}photos ph WHERE ph.person_id = p.id) AS has_photo,
    (SELECT count(*) FROM {hr.H}equipment e WHERE e.person_id = p.id AND e.returned_at IS NULL) AS equipment_on_hands,
    f.legal_name, f.birth_date, f.birthday_hidden, f.country, f.employment_type, f.hired_at, f.probation_until, f.dismissed_at, f.dismissal_reason,
    f.contract_no, f.contract_date, f.work_schedule, f.phone, f.personal_email, f.emergency_contact, f.notes{{sensitive_select}}
    FROM {hr.T}people p JOIN {hr.T}directions d ON d.id = p.direction_id LEFT JOIN {hr.T}people m ON m.id = p.manager_id
    LEFT JOIN {hr.U} u ON u.id = p.user_id LEFT JOIN {hr.H}employee_files f ON f.person_id = p.id{{sensitive_join}}
    ORDER BY p.is_archived, p.sort, p.id"""
SENSITIVE_SELECT = f""", s.salary, s.currency, s.pay_day_1, s.pay_day_2, s.bonus_note, s.tax_id, s.social_id, s.passport, s.bank_details,
    (SELECT count(*) FROM {hr.H}documents dc WHERE dc.person_id = p.id) AS documents_count"""
SENSITIVE_JOIN = f" LEFT JOIN {hr.H}employee_sensitive s ON s.person_id = p.id"
NAME = "p.first_name, p.last_name"


def _rows(session: Session, sql: str) -> list[dict]:
    return [dict(r) for r in session.execute(text(sql)).mappings().all()]


def export_people(session: Session, user: User) -> dict:
    sensitive = hr.is_responsible(session, user)
    fields = team_service._fields(session, False)
    people = _rows(session, PEOPLE_SQL.format(sensitive_select=SENSITIVE_SELECT if sensitive else "", sensitive_join=SENSITIVE_JOIN if sensitive else ""))
    leave_rows = _rows(
        session,
        f"""SELECT r.person_id, {NAME}, r.kind, r.start_date, r.end_date, r.days, r.status, r.message FROM {hr.H}leave_requests r
            JOIN {hr.T}people p ON p.id = r.person_id WHERE r.status IN ('approved', 'pending') ORDER BY r.start_date, r.id""",
    )
    balances = _balances(session, people, leave_rows)
    for p in people:
        p["completeness"] = _percent(fields, p, p["has_photo"])
        p["balance"] = balances[p["id"]]
    columns = EXPORT_COLUMNS + _form_columns(fields, {c.header for c in EXPORT_COLUMNS})
    equipment = _rows(
        session,
        f"""SELECT {NAME}, e.kind, e.name AS eq_name, e.serial, e.issued_at, e.return_due, e.returned_at, e.comment FROM {hr.H}equipment e
            JOIN {hr.T}people p ON p.id = e.person_id ORDER BY p.is_archived, p.sort, p.id, e.issued_at, e.id""",
    )
    history = _rows(
        session,
        f"""SELECT {NAME}, h.kind, h.effective_date, h.title AS h_title, h.old_value, h.new_value, h.comment, h.auto, u.full_name AS creator
            FROM {hr.H}employee_history h JOIN {hr.T}people p ON p.id = h.person_id LEFT JOIN {hr.U} u ON u.id = h.created_by
            {"" if sensitive else "WHERE h.kind <> 'salary'"} ORDER BY p.is_archived, p.sort, p.id, h.effective_date DESC, h.id DESC""",
    )
    checklists = _rows(
        session,
        f"""SELECT {NAME}, c.kind, c.title AS c_title, c.status, c.started_at, count(i.id) FILTER (WHERE i.done) AS done, count(i.id) AS total
            FROM {hr.H}checklists c JOIN {hr.T}people p ON p.id = c.person_id LEFT JOIN {hr.H}checklist_items i ON i.checklist_id = c.id
            GROUP BY c.id, p.id ORDER BY p.is_archived, p.sort, p.id, c.started_at DESC, c.id DESC""",
    )
    sheets = [
        ("Сотрудники", *_table(columns, people)),
        ("Оборудование", *_table(EQUIPMENT_COLUMNS, equipment)),
        ("История", *_table(HISTORY_COLUMNS, history)),
        ("Чек-листы", *_table(CHECKLIST_COLUMNS, checklists)),
        ("Отпуска", *_table(LEAVE_COLUMNS, leave_rows)),
    ]
    if sensitive:
        sheets.append(("Деньги и документы", *_table(SENSITIVE_COLUMNS, people)))
    log_action(session, user.id, "hr.export", hr.MODULE_ID, kind="people", rows=len(people), sensitive=sensitive)
    session.commit()
    return _file(sheets, f"people-{date.today().isoformat()}")


def export_leave(session: Session, user: User, start: str, end: str) -> dict:
    d_from, d_to = hr._date(start), hr._date(end)
    if d_to < d_from:
        hr.fail(422, hr.MSG_DATES)
    if (d_to - d_from).days > hr.CALENDAR_MAX_DAYS:
        hr.fail(422, hr.MSG_RANGE)
    rows = session.execute(
        text(
            f"""SELECT p.first_name, p.last_name, r.kind, r.start_date, r.end_date, r.days FROM {hr.H}leave_requests r
                JOIN {hr.T}people p ON p.id = r.person_id WHERE r.status = 'approved' AND r.start_date <= :t AND r.end_date >= :f
                ORDER BY r.start_date, r.id"""
        ),
        {"f": d_from, "t": d_to},
    ).mappings().all()
    leave = [[hr._name(r), KIND_LABELS.get(r["kind"], r["kind"]), r["start_date"], r["end_date"], float(r["days"])] for r in rows]
    balance = []
    today = date.today()
    for p in session.execute(text(f"SELECT id, first_name, last_name FROM {hr.T}people WHERE NOT is_archived ORDER BY sort, id")).mappings().all():
        _, b = hr._balance(session, p["id"], today)
        balance.append([hr._name(p), *((b["accrued"], b["used"], b["planned"], b["available"]) if b else ("", "", "", ""))])
    log_action(session, user.id, "hr.export", hr.MODULE_ID, kind="leave", date_from=d_from.isoformat(), date_to=d_to.isoformat(), rows=len(leave))
    session.commit()
    return _file(
        [
            ("Отпуска", ["ФИО", "Вид", "С", "По", "Дней"], leave),
            ("Баланс", ["ФИО", "Накоплено", "Использовано", "Запланировано", "Доступно"], balance),
        ],
        f"leave-{d_from.isoformat()}-{d_to.isoformat()}",
    )
