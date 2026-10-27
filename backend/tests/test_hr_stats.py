"""HR: сводка над таблицей «Сотрудники» (GET /modules/hr/stats). Люди и данные вымышленные."""
import json
from datetime import date, timedelta

import pytest
from sqlalchemy import event, text

from app.modules.hr import stats as hr_stats
from tests.conftest import login, make_user
from tests.test_hr import BASE, TODAY, admin, hr, person, resp, team  # noqa: F401
from tests.test_team import add_person

URL = f"{BASE}/stats"


@pytest.fixture()
def viewer(client, db):
    make_user(db, "v@example.com", "viewer")
    return login(client, "v@example.com")


@pytest.fixture()
def outsider(client, db):
    make_user(db, "o@example.com", "employee", name="Посторонний Пётр")
    return login(client, "o@example.com")


def dossier(db, person_id, **cols):
    names = ["person_id", *cols]
    db.execute(
        text(f"INSERT INTO trendsetter_hub.hr_employee_files ({', '.join(names)}) VALUES ({', '.join(':' + n for n in names)})"),
        {"person_id": person_id, **cols},
    )
    db.commit()


def leave(db, person_id, start, end, kind="annual", status="approved"):
    db.execute(
        text(
            """INSERT INTO trendsetter_hub.hr_leave_requests (person_id, kind, start_date, end_date, days, status)
               VALUES (:p, :k, :s, :e, :d, :st)"""
        ),
        {"p": person_id, "k": kind, "s": TODAY + timedelta(days=start), "e": TODAY + timedelta(days=end), "d": end - start + 1, "st": status},
    )
    db.commit()


def get(client, hr):
    r = client.get(URL, headers=hr)
    assert r.status_code == 200, r.text
    return r.json()


def walk(node):
    if isinstance(node, dict):
        for k, v in node.items():
            yield k, v
            yield from walk(v)
    elif isinstance(node, list):
        for v in node:
            yield from walk(v)


def years_ago(d: date, years: int) -> date:
    try:
        return d.replace(year=d.year - years)
    except ValueError:  # 29 февраля
        return d.replace(year=d.year - years, day=28)


def test_rights(client, hr, team, viewer, outsider):
    assert client.get(URL).status_code == 401
    for who in (team["e"], team["m"], viewer, outsider):
        assert client.get(URL, headers=who).status_code == 403
    assert client.get(URL, headers=hr).status_code == 200


def test_scope_archived_hidden_and_upcoming(client, db, hr):
    a = add_person(db, "Анна", "Альфа")
    add_person(db, "Скрыт", "Скрытов", show=False)
    gone = add_person(db, "Архив", "Архивов", archived=True)
    dossier(db, gone, birth_date=date(1990, 1, 1), hired_at=date(2020, 1, 1), country="RU")
    soon = add_person(db, "Будущий", "Бетов")
    dossier(db, soon, hired_at=TODAY + timedelta(days=5))
    dossier(db, a, hired_at=TODAY - timedelta(days=400))
    s = get(client, hr)
    assert s["total"] == 3 and s["hiddenFromMap"] == 1 and s["upcomingHires"] == 1
    assert s["country"] == {"known": 0, "items": []}
    assert s["tenure"]["known"] == 1 and s["age"]["known"] == 0
    assert s["newcomers"]["count"] == 0
    assert s["directions"] == [{"id": "ops", "count": 3}]


def test_buckets_sum_and_boundaries(client, db, hr):
    on = add_person(db, "Ровно", "Двадцатьпятов")
    before = add_person(db, "Накануне", "Двадцатьпятов")
    dossier(db, on, birth_date=years_ago(TODAY, 25))
    dossier(db, before, birth_date=years_ago(TODAY + timedelta(days=1), 25))
    s = get(client, hr)
    assert [b["key"] for b in s["age"]["buckets"]] == list(hr_stats.AGE_KEYS)
    assert [b["key"] for b in s["tenure"]["buckets"]] == list(hr_stats.TENURE_KEYS)
    counts = {b["key"]: b["count"] for b in s["age"]["buckets"]}
    assert counts["25_34"] == 1 and counts["under_25"] == 1
    assert sum(counts.values()) == s["age"]["known"] == 2
    assert sum(b["count"] for b in s["tenure"]["buckets"]) == s["tenure"]["known"]


def test_age_out_of_range_is_unknown(client, db, hr):
    p = add_person(db, "Юный", "Юнов")
    dossier(db, p, birth_date=TODAY - timedelta(days=365 * 5))
    assert get(client, hr)["age"]["known"] == 0


def test_averages_need_three(client, db, hr):
    ids = [add_person(db, f"Имя{i}", f"Фамилия{i}") for i in range(3)]
    for i, pid in enumerate(ids[:2]):
        dossier(db, pid, birth_date=date(TODAY.year - 30 - i, 1, 1), hired_at=TODAY - timedelta(days=400 + i))
    s = get(client, hr)
    assert s["age"]["average"] is None and s["tenure"]["averageMonths"] is None
    dossier(db, ids[2], birth_date=date(TODAY.year - 40, 1, 1), hired_at=TODAY - timedelta(days=800))
    s = get(client, hr)
    assert isinstance(s["age"]["average"], float) and isinstance(s["tenure"]["averageMonths"], int)


def test_no_personal_dates_or_money(client, db, hr):
    born = date(1990, 5, 17)
    p = add_person(db, "Анна", "Альфа")
    dossier(db, p, birth_date=born, hired_at=TODAY - timedelta(days=30), probation_until=TODAY + timedelta(days=30), country="AM")
    db.execute(text("INSERT INTO trendsetter_hub.hr_employee_sensitive (person_id, salary, currency) VALUES (:p, 123456, 'AMD')"), {"p": p})
    db.commit()
    leave(db, p, 1, 3)
    s = get(client, hr)
    assert not {"birthDate", "salary", "currency", "passport"} & {k for k, _ in walk(s)}
    values = {v for _, v in walk(s) if isinstance(v, str)}
    assert born.isoformat() not in values and born.strftime("%d.%m.%Y") not in values
    for k, v in walk(s):
        if isinstance(v, str) and len(v) == 10 and v[4] == "-" and v[7] == "-":
            assert k in {"asOf", "hiredAt", "start", "end"}, k


def test_leave_lists(client, db, hr):
    now = add_person(db, "Сейчас", "Отпускин")
    s14 = add_person(db, "Через14", "Отпускин")
    s15 = add_person(db, "Через15", "Отпускин")
    pend = add_person(db, "Ожидает", "Отпускин")
    rej = add_person(db, "Отказ", "Отпускин")
    sick = add_person(db, "Болен", "Отпускин")
    leave(db, now, 0, 5)
    leave(db, now, 20, 25)
    leave(db, s14, 14, 20)
    leave(db, s15, 15, 20)
    leave(db, pend, 0, 5, status="pending")
    leave(db, rej, 0, 5, status="rejected")
    leave(db, sick, 0, 5, kind="sick")
    s = get(client, hr)["leave"]
    assert [i["personId"] for i in s["now"]] == [now]
    assert [i["personId"] for i in s["soon"]] == [s14]
    assert s["soonDays"] == 14


def test_newcomers_and_dismissed_windows(client, db, hr):
    in_ = add_person(db, "Новый", "Девяностов")
    out = add_person(db, "Старый", "Девяносто-Первый")
    dossier(db, in_, hired_at=TODAY - timedelta(days=90))
    dossier(db, out, hired_at=TODAY - timedelta(days=91))
    left = add_person(db, "Ушёл", "Ушедов", archived=True)
    dossier(db, left, dismissed_at=TODAY - timedelta(days=10))
    left_old = add_person(db, "Давно", "Ушедов", archived=True)
    dossier(db, left_old, dismissed_at=TODAY - timedelta(days=91))
    add_person(db, "Без", "Даты", archived=True)
    s = get(client, hr)
    assert [p["personId"] for p in s["newcomers"]["people"]] == [in_] and s["newcomers"]["count"] == 1
    assert s["dismissed"]["count"] == 1


def test_managers(client, db, hr):
    boss = add_person(db, "Борис", "Босс")
    other = add_person(db, "Ольга", "Другая")
    for i in range(3):
        add_person(db, f"Под{i}", "Чинённый", boss)
    add_person(db, "Архивный", "Чинённый", boss, archived=True)
    add_person(db, "Один", "Чинённый", other)
    s = get(client, hr)["managers"]
    assert s["count"] == 2 and s["avgSpan"] == 2.0
    assert [(t["personId"], t["reports"]) for t in s["top"]] == [(boss, 3), (other, 1)]
    for i in range(12):
        chief = add_person(db, f"Рук{i:02d}", "Руков")
        add_person(db, f"Под{i:02d}", "Руков", chief)
    top = get(client, hr)["managers"]["top"]
    assert len(top) == 10 and [t["reports"] for t in top] == sorted((t["reports"] for t in top), reverse=True)


def test_location_normalization_and_gender(client, db, hr):
    for i, v in enumerate(("москва ", "Москва", "МОСКВА", "", "  ", None, 5, "Ереван")):
        gender = "male" if i < 2 else "female" if i == 2 else "x"
        add_person(db, f"Имя{i}", "Локов", answers=json.dumps({"location": v, "gender": gender}))
    s = get(client, hr)
    assert s["location"] == {"known": 4, "items": [{"label": "Москва", "count": 3}, {"label": "Ереван", "count": 1}]}
    assert s["gender"] == {"known": 3, "items": [{"key": "male", "count": 2}, {"key": "female", "count": 1}]}


def test_does_not_write_audit_log(client, db, hr):
    before = db.execute(text("SELECT count(*) FROM trendsetter_hub.audit_log")).scalar_one()
    get(client, hr)
    assert db.execute(text("SELECT count(*) FROM trendsetter_hub.audit_log")).scalar_one() == before


def test_query_count_independent_of_people(client, db, engine, hr):
    counter = []

    def count(*_args):
        counter.append(1)

    event.listen(engine, "before_cursor_execute", count)
    try:
        add_person(db, "Один", "Первый")
        counter.clear()
        get(client, hr)
        few = len(counter)
        for i in range(15):
            p = add_person(db, f"Имя{i}", "Многов")
            dossier(db, p, hired_at=TODAY)
            leave(db, p, 0, 3)
        counter.clear()
        get(client, hr)
        assert len(counter) == few
    finally:
        event.remove(engine, "before_cursor_execute", count)
