"""HR: сводка над таблицей «Сотрудники» (карточки-числа и разбивки для кольцевых диаграмм). Только чтение, без записи в журнал.

Читает team_people, team_directions, team_form_fields, hr_employee_files и hr_leave_requests; таблица денег и реквизитов не читается.
Охват: все неархивные карточки (как фильтр «Работают»). TODO(Q-HA2): скрытые из карты входят, их число отдельно в hiddenFromMap.
Больничные не показываются. TODO(Q-HA3): совпадает с service.calendar().
Пол: колонки в досье нет; берётся из ответа анкеты answers.gender ('male' / 'female'), заполнение — отдельная задача. TODO(Q-HA1)

ПРАВИЛО НА БУДУЩЕЕ: сейчас эндпойнт открыт только праву run на hr (эти люди и так видят досье каждого). Если доступ откроют шире
(руководителям, team, главной), нужно новое ТЗ с обязательным подавлением малых групп (k >= 3, включая итоги) и ревью приватности.
В ответе нет дат рождения, возрастов по людям, перекрёстных разрезов и денег.
"""
from collections import Counter
from datetime import date, timedelta

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.modules.hr import leave as calc
from app.modules.hr.service import COUNTRIES, EMPLOYMENT_TYPES, H, T

MIN_FOR_AVERAGE = 3
NEWCOMER_DAYS = 90
DISMISSED_DAYS = 90
LEAVE_SOON_DAYS = 14
TOP_MANAGERS = 10
AGE_MIN, AGE_MAX = 14, 100
GENDERS = ("male", "female")

AGE_KEYS = ("under_25", "25_34", "35_44", "45_54", "55_plus")
TENURE_KEYS = ("lt_3m", "3_12m", "1_3y", "3_5y", "5y_plus")


def _name(p) -> str:
    return f"{p['last_name']} {p['first_name']}".strip()


def full_years(born: date, today: date) -> int:
    return today.year - born.year - ((today.month, today.day) < (born.month, born.day))


def age_key(age: int) -> str:
    if age < 25:
        return "under_25"
    if age < 35:
        return "25_34"
    if age < 45:
        return "35_44"
    if age < 55:
        return "45_54"
    return "55_plus"


def tenure_key(months: int) -> str:
    if months < 3:
        return "lt_3m"
    if months < 12:
        return "3_12m"
    if months < 36:
        return "1_3y"
    if months < 60:
        return "3_5y"
    return "5y_plus"


def _text_groups(values: list, options: list[str]) -> dict:
    """Группировка ответов анкеты: trim, схлопывание пробелов, без учёта регистра; подпись — вариант поля или частое написание."""
    spellings: dict[str, Counter] = {}
    for v in values:
        if not isinstance(v, str):
            continue
        s = " ".join(v.split())
        if s:
            spellings.setdefault(s.casefold(), Counter())[s] += 1
    by_option = {o.casefold(): o for o in options}
    items = []
    for key, counter in spellings.items():
        label = by_option.get(key) or sorted(counter.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
        items.append({"label": label, "count": sum(counter.values())})
    items.sort(key=lambda i: (-i["count"], i["label"]))
    return {"known": sum(i["count"] for i in items), "items": items}


def _keyed(values: list, order: tuple) -> dict:
    counts = Counter(v for v in values if v in order)
    return {"known": sum(counts.values()), "items": [{"key": k, "count": counts[k]} for k in order if counts[k] > 0]}


def _leave_lists(rows, today: date, soon_until: date) -> dict:
    now, soon = {}, {}
    for r in rows:  # уже отсортированы по start_date, id: у человека берётся самая ранняя заявка
        item = {
            "personId": r["person_id"], "name": _name(r), "directionId": r["direction_id"], "kind": r["kind"],
            "start": r["start_date"].isoformat(), "end": r["end_date"].isoformat(),
        }
        if r["start_date"] <= today <= r["end_date"]:
            now.setdefault(r["person_id"], item)
        elif today < r["start_date"] <= soon_until:
            soon.setdefault(r["person_id"], item)
    key = lambda i: (i["start"], i["personId"])  # noqa: E731
    return {"soonDays": LEAVE_SOON_DAYS, "now": sorted(now.values(), key=key), "soon": sorted(soon.values(), key=key)}


def get_stats(session: Session, today: date | None = None) -> dict:
    today = today or date.today()
    people = session.execute(
        text(
            f"""SELECT p.id, p.first_name, p.last_name, p.direction_id, p.team, p.user_id, p.show_in_map, p.manager_id, p.answers,
                       f.birth_date, f.hired_at, f.probation_until, f.country, f.employment_type
                FROM {T}people p LEFT JOIN {H}employee_files f ON f.person_id = p.id
                WHERE NOT p.is_archived"""
        )
    ).mappings().all()
    directions = session.execute(text(f"SELECT id FROM {T}directions ORDER BY sort, id")).scalars().all()
    options = {
        r["key"]: [o for o in (r["options"] or []) if isinstance(o, str)]
        for r in session.execute(text(f"SELECT key, options FROM {T}form_fields WHERE key IN ('location', 'work_format')")).mappings()
    }
    dismissed = session.execute(
        text(
            f"""SELECT count(*) FROM {T}people p JOIN {H}employee_files f ON f.person_id = p.id
                WHERE p.is_archived AND f.dismissed_at BETWEEN :a AND :b"""
        ),
        {"a": today - timedelta(days=DISMISSED_DAYS), "b": today},
    ).scalar_one()
    leave_rows = session.execute(
        text(
            f"""SELECT r.person_id, p.first_name, p.last_name, p.direction_id, r.kind, r.start_date, r.end_date
                FROM {H}leave_requests r JOIN {T}people p ON p.id = r.person_id
                WHERE r.status = 'approved' AND r.kind <> 'sick' AND NOT p.is_archived
                AND r.start_date <= :soon AND r.end_date >= :today ORDER BY r.start_date, r.id"""
        ),
        {"today": today, "soon": today + timedelta(days=LEAVE_SOON_DAYS)},
    ).mappings().all()

    by_direction = Counter(p["direction_id"] for p in people)
    teams = {" ".join(p["team"].split()).casefold() for p in people if p["team"] and p["team"].strip()}

    ages = [a for a in (full_years(p["birth_date"], today) for p in people if p["birth_date"]) if AGE_MIN <= a <= AGE_MAX]
    age_counts = Counter(age_key(a) for a in ages)
    months = [calc.full_months(p["hired_at"], today) for p in people if p["hired_at"] and p["hired_at"] <= today]
    tenure_counts = Counter(tenure_key(x) for x in months)

    newcomers = sorted(
        (p for p in people if p["hired_at"] and today - timedelta(days=NEWCOMER_DAYS) <= p["hired_at"] <= today),
        key=lambda p: (-p["hired_at"].toordinal(), p["id"]),
    )
    probation = sum(
        1 for p in people if p["probation_until"] and p["probation_until"] >= today and (p["hired_at"] is None or p["hired_at"] <= today)
    )

    working = {p["id"]: p for p in people}
    reports = Counter(p["manager_id"] for p in people if p["manager_id"] in working)
    top = sorted(reports.items(), key=lambda kv: (-kv[1], _name(working[kv[0]]), kv[0]))
    answers = [(p["answers"] or {}) for p in people]

    return {
        "asOf": today.isoformat(),
        "total": len(people),
        "withAccount": sum(1 for p in people if p["user_id"] is not None),
        "hiddenFromMap": sum(1 for p in people if not p["show_in_map"]),  # TODO(Q-HA2)
        "upcomingHires": sum(1 for p in people if p["hired_at"] and p["hired_at"] > today),
        "directions": [{"id": d, "count": by_direction[d]} for d in directions if by_direction[d] > 0],
        "teamsCount": len(teams),
        "location": _text_groups([a.get("location") for a in answers], options.get("location", [])),
        "workFormat": _text_groups([a.get("work_format") for a in answers], options.get("work_format", [])),
        "gender": _keyed([a.get("gender") for a in answers], GENDERS),  # TODO(Q-HA1): поле анкеты пока не заведено
        "country": _keyed([p["country"] for p in people], COUNTRIES),
        "employmentType": _keyed([p["employment_type"] for p in people], EMPLOYMENT_TYPES),
        "age": {
            "known": len(ages),
            "average": round(sum(ages) / len(ages), 1) if len(ages) >= MIN_FOR_AVERAGE else None,
            "buckets": [{"key": k, "count": age_counts[k]} for k in AGE_KEYS],
        },
        "tenure": {
            "known": len(months),
            "averageMonths": round(sum(months) / len(months)) if len(months) >= MIN_FOR_AVERAGE else None,
            "buckets": [{"key": k, "count": tenure_counts[k]} for k in TENURE_KEYS],
        },
        "newcomers": {
            "days": NEWCOMER_DAYS, "count": len(newcomers),
            "people": [
                {"personId": p["id"], "name": _name(p), "directionId": p["direction_id"], "hiredAt": p["hired_at"].isoformat()}
                for p in newcomers
            ],
        },
        "dismissed": {"days": DISMISSED_DAYS, "count": dismissed},
        "probation": {"count": probation},
        "leave": _leave_lists(leave_rows, today, today + timedelta(days=LEAVE_SOON_DAYS)),
        "managers": {
            "count": len(reports),
            "avgSpan": round(sum(reports.values()) / len(reports), 1) if reports else None,
            "top": [
                {"personId": mid, "name": _name(working[mid]), "directionId": working[mid]["direction_id"], "reports": n}
                for mid, n in top[:TOP_MANAGERS]
            ],
        },
    }
