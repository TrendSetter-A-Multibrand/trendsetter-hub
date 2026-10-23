"""HR: экспорт в Excel (сотрудники, отпуска и баланс). Права: run на hr. Деньги, документы, паспорта и прочее из employee_sensitive/documents
в файл не попадают никогда. В журнал пишутся только вид и диапазон."""
import base64
import io
from datetime import date

from openpyxl import Workbook
from openpyxl.styles import Font
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.audit import log_action
from app.core.models import User
from app.modules.hr import service as hr
from app.modules.team import service as team_service

XLSX_NAME = "{}.xlsx"
KIND_LABELS = {"annual": "Ежегодный", "unpaid": "Без сохранения", "study": "Учебный", "sick": "Больничный", "other": "Другое"}
COLUMN_KEYS = {"first_name": "first_name", "last_name": "last_name", "title": "title", "email": "email"}
COUNTRY_LABELS = {"RU": "Россия", "AM": "Армения"}


def _cell(value):
    """Даты — как ДД.ММ.ГГГГ."""
    return hr.fmt(value) if isinstance(value, date) else value


def _file(sheets: list[tuple[str, list[str], list[list]]], name: str) -> dict:
    wb = Workbook()
    wb.remove(wb.active)
    for title, header, rows in sheets:
        ws = wb.create_sheet(title)
        ws.append(header)
        for cell in ws[1]:
            cell.font = Font(bold=True)
        for row in rows:
            ws.append([_cell(v) for v in row])
            for cell in ws[ws.max_row]:
                if isinstance(cell.value, str) and cell.value.startswith("="):
                    cell.data_type = "s"  # текст «=...» остаётся текстом, а не формулой (защита от инъекции формул)
        for index, head in enumerate(header, 1):
            ws.column_dimensions[ws.cell(1, index).column_letter].width = max(12, min(40, len(head) + 4))
    buffer = io.BytesIO()
    wb.save(buffer)
    return {"fileName": XLSX_NAME.format(name), "dataBase64": base64.b64encode(buffer.getvalue()).decode("ascii")}


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


def export_people(session: Session, user: User) -> dict:
    fields = team_service._fields(session, True)
    rows = session.execute(
        text(
            f"""SELECT p.id, p.first_name, p.last_name, p.title, p.email, p.answers, p.is_archived, p.direction_id, p.manager_id,
                d.label AS direction, m.first_name AS m_first, m.last_name AS m_last, f.country, f.hired_at,
                EXISTS (SELECT 1 FROM {hr.T}photos ph WHERE ph.person_id = p.id) AS has_photo
                FROM {hr.T}people p JOIN {hr.T}directions d ON d.id = p.direction_id LEFT JOIN {hr.T}people m ON m.id = p.manager_id
                LEFT JOIN {hr.H}employee_files f ON f.person_id = p.id ORDER BY p.is_archived, p.sort, p.id"""
        )
    ).mappings().all()
    data = []
    for r in rows:
        a = r["answers"] or {}
        data.append([
            hr._name(r), r["title"], r["direction"], hr._name({"first_name": r["m_first"], "last_name": r["m_last"]}) if r["manager_id"] else "",
            "Уволен" if r["is_archived"] else "Работает", COUNTRY_LABELS.get(r["country"], ""), r["hired_at"] or "",
            _percent(fields, r, r["has_photo"]), r["email"] or "", a.get("telegram") or "", a.get("location") or "", a.get("work_format") or "",
        ])
    header = ["ФИО", "Должность", "Направление", "Руководитель", "Статус", "Страна", "Дата приёма", "Заполнено, %", "Почта", "Telegram", "Локация", "Формат работы"]
    log_action(session, user.id, "hr.export", hr.MODULE_ID, kind="people", rows=len(data))
    session.commit()
    return _file([("Сотрудники", header, data)], f"people-{date.today().isoformat()}")


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
