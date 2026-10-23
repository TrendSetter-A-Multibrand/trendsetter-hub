"""HR: ежедневные напоминания (ModuleManifest.daily_job; запускаются из /core/me, не чаще раза в сутки).
Получатели — все с run на hr (день рождения — ещё и руководитель). Повторные запуски безвредны: каждое событие отмечается в hr_reminder_log
(ON CONFLICT DO NOTHING), уведомление создаётся только при успешной вставке. В журнал пишутся только счётчики."""
import calendar
from datetime import date, timedelta

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.audit import log_action
from app.core.notifications import notify
from app.modules.hr import service as hr

LINK = "/modules/hr"
ANNIVERSARY_YEARS = (1, 3, 5, 10)
PROBATION_DAYS = (14, 3, 0)
EQUIPMENT_DAYS = (3, 0)
KEEP_DAYS = 400
RUN_KIND = "_run"


def _once(session: Session, today: date, kind: str, key: int) -> bool:
    """True, если отметка создана сейчас (событие ещё не обрабатывалось сегодня)."""
    return session.execute(
        text(f"INSERT INTO {hr.H}reminder_log (day, kind, person_id) VALUES (:d, :k, :p) ON CONFLICT DO NOTHING RETURNING 1"),
        {"d": today, "k": kind, "p": key},
    ).first() is not None


def _anniversary(source: date, year: int) -> date:
    """Дата годовщины в указанном году; 29 февраля в невисокосный год — 28 февраля."""
    return date(year, source.month, min(source.day, calendar.monthrange(year, source.month)[1]))


def run_daily(session: Session, today: date | None = None) -> None:
    today = today or date.today()
    if not _once(session, today, RUN_KIND, 0):
        return
    session.execute(text(f"DELETE FROM {hr.H}reminder_log WHERE day < :d"), {"d": today - timedelta(days=KEEP_DAYS)})
    recipients = hr.hr_user_ids(session)
    counts = {"probation_ending": 0, "work_anniversary": 0, "birthday": 0, "equipment_return_due": 0, "checklist_overdue": 0}

    def send(kind: str, key: int, title: str, body: str, extra: set[int] = frozenset()) -> None:
        if _once(session, today, kind, key):
            notify(session, recipients | set(extra), kind, title, body, LINK)
            counts[kind] += 1

    # испытательный срок: за 14 и 3 дня и в день окончания
    dates = [today + timedelta(days=n) for n in PROBATION_DAYS]
    for r in session.execute(
        text(
            f"""SELECT p.id, p.first_name, p.last_name, f.probation_until FROM {hr.H}employee_files f JOIN {hr.T}people p ON p.id = f.person_id
                WHERE NOT p.is_archived AND f.probation_until = ANY(:d) ORDER BY p.id"""
        ),
        {"d": dates},
    ).mappings():
        send("probation_ending", r["id"], "Испытательный срок", f"Скоро заканчивается испытательный срок: {hr._name(r)} ({hr.fmt(r['probation_until'])})")

    # годовщины и дни рождения
    for r in session.execute(
        text(
            f"""SELECT p.id, p.first_name, p.last_name, f.hired_at, f.birth_date, mu.id AS manager_user_id
                FROM {hr.H}employee_files f JOIN {hr.T}people p ON p.id = f.person_id
                LEFT JOIN {hr.T}people mp ON mp.id = p.manager_id LEFT JOIN {hr.U} mu ON mu.id = mp.user_id AND mu.is_active
                WHERE NOT p.is_archived AND (f.hired_at IS NOT NULL OR f.birth_date IS NOT NULL) ORDER BY p.id"""
        )
    ).mappings():
        hired = r["hired_at"]
        if hired is not None and hired.year < today.year and _anniversary(hired, today.year) == today and today.year - hired.year in ANNIVERSARY_YEARS:
            send("work_anniversary", r["id"], "Годовщина работы", f"Годовщина работы: {hr._name(r)} — {today.year - hired.year} лет")
        birth = r["birth_date"]
        if birth is not None and _anniversary(birth, today.year) == today:
            manager = {r["manager_user_id"]} if r["manager_user_id"] is not None else set()
            send("birthday", r["id"], "День рождения", f"Сегодня день рождения: {hr._name(r)}", manager)

    # оборудование: срок возврата через 3 дня и в день срока; ключ — id записи, чтобы несколько единиц у одного человека не слипались
    for r in session.execute(
        text(
            f"""SELECT e.id, e.name, e.return_due, p.first_name, p.last_name FROM {hr.H}equipment e JOIN {hr.T}people p ON p.id = e.person_id
                WHERE e.returned_at IS NULL AND e.return_due = ANY(:d) ORDER BY e.id"""
        ),
        {"d": [today + timedelta(days=n) for n in EQUIPMENT_DAYS]},
    ).mappings():
        send("equipment_return_due", r["id"], "Возврат оборудования", f"Срок возврата оборудования: {hr._name(r)} — {r['name']} ({hr.fmt(r['return_due'])})")

    # просроченные пункты активных чек-листов: одно напоминание в день на чек-лист (ключ — id чек-листа)
    for r in session.execute(
        text(
            f"""SELECT c.id, p.first_name, p.last_name, count(*) AS n, (array_agg(i.title ORDER BY i.due_date, i.id))[1] AS first_title
                FROM {hr.H}checklist_items i JOIN {hr.H}checklists c ON c.id = i.checklist_id JOIN {hr.T}people p ON p.id = c.person_id
                WHERE c.status = 'active' AND NOT i.done AND i.due_date < :t GROUP BY c.id, p.first_name, p.last_name ORDER BY c.id"""
        ),
        {"t": today},
    ).mappings():
        more = f" и ещё {r['n'] - 1}" if r["n"] > 1 else ""
        send("checklist_overdue", r["id"], "Просрочен чек-лист", f"Просрочен пункт чек-листа: {r['first_title']}{more} ({hr._name(r)})")

    log_action(session, None, "hr.reminders_run", hr.MODULE_ID, **counts)
    session.commit()
