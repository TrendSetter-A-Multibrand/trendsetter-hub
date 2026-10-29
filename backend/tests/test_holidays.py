"""Производственный календарь: права, запись диапазоном, валидация без частичной записи, чтение, удаление, журнал."""
import json

import pytest
from sqlalchemy import text

from app.core.models import UserModulePermission
from tests.conftest import login, make_user

BASE = "/modules/holidays"
NY = "Новогодние каникулы"


@pytest.fixture()
def h(client, db):
    """Заголовки по ролям: admin, sup (superuser без права), emp, viewer, editor (responsible на holidays), news_editor (responsible только на news)."""
    users = {
        "admin": make_user(db, "admin@example.com", "admin"),
        "sup": make_user(db, "sup@example.com", "superuser"),
        "emp": make_user(db, "emp@example.com", "employee"),
        "viewer": make_user(db, "viewer@example.com", "viewer"),
        "editor": make_user(db, "editor@example.com", "employee"),
        "news_editor": make_user(db, "news_editor@example.com", "employee"),
    }
    db.add(UserModulePermission(user_id=users["editor"].id, module_id="holidays", permission="responsible"))
    db.add(UserModulePermission(user_id=users["news_editor"].id, module_id="news", permission="responsible"))
    db.commit()
    return {role: login(client, f"{role}@example.com") for role in users}


def put(client, headers, **over):
    body = {"country": "RU", "start": "2027-01-01", "end": "2027-01-08", "kind": "holiday", "name": NY, **over}
    return client.post(BASE + "/days", json=body, headers=headers)


def drop(client, headers, **over):
    body = {"country": "RU", "start": "2027-01-01", "end": "2027-01-08", **over}
    return client.post(BASE + "/days/delete", json=body, headers=headers)


def get(client, headers, start="2027-01-01", end="2027-12-31"):
    return client.get(BASE + "/days", params={"start": start, "end": end}, headers=headers)


def count_rows(db):
    return db.execute(text("SELECT count(*) FROM trendsetter_hub.holidays_days")).scalar_one()


def audit(db):
    rows = db.execute(text("SELECT action, module_id, details FROM trendsetter_hub.audit_log WHERE module_id = 'holidays' ORDER BY id")).all()
    return [tuple(r) for r in rows]


# ---------- права ----------


def test_no_token_is_401(client):
    assert client.get(BASE + "/days", params={"start": "2027-01-01", "end": "2027-01-31"}).status_code == 401
    assert client.post(BASE + "/days", json={}).status_code == 401
    assert client.post(BASE + "/days/delete", json={}).status_code == 401


def test_viewer_cannot_read(client, h):
    assert get(client, h["viewer"]).status_code == 403


def test_employee_reads_but_cannot_write(client, h, db):
    assert get(client, h["emp"]).status_code == 200
    assert put(client, h["emp"]).status_code == 403
    assert drop(client, h["emp"]).status_code == 403
    assert count_rows(db) == 0


def test_superuser_without_right_cannot_write(client, h):
    assert put(client, h["sup"]).status_code == 403
    assert drop(client, h["sup"]).status_code == 403


def test_responsible_and_admin_can_write(client, h):
    assert put(client, h["editor"]).status_code == 200
    assert put(client, h["admin"], country="AM").status_code == 200
    assert get(client, h["editor"]).status_code == 200
    assert get(client, h["admin"]).status_code == 200


def test_news_responsible_cannot_write(client, h):
    assert put(client, h["news_editor"]).status_code == 403
    assert drop(client, h["news_editor"]).status_code == 403


def test_me_exposes_responsible(client, h):
    me = client.get("/core/me", headers=h["editor"]).json()
    assert me["module_responsible"]["holidays"] is True


# ---------- запись диапазоном ----------


def test_range_saved_in_one_action_including_weekend(client, h):
    r = put(client, h["editor"])
    assert r.status_code == 200, r.text
    days = r.json()["days"]
    assert [d["date"] for d in days] == [f"2027-01-0{i}" for i in range(1, 9)]  # 02 и 03 января — сб и вс
    assert all(d["country"] == "RU" and d["kind"] == "holiday" and d["name"] == NY for d in days)
    assert get(client, h["emp"], "2027-01-01", "2027-01-31").json()["days"] == days


def test_upsert_overwrites_only_part_of_range(client, h):
    put(client, h["editor"])
    r = put(client, h["editor"], start="2027-01-05", end="2027-01-06", kind="day_off", name=None)
    assert r.status_code == 200, r.text
    by_date = {d["date"]: d for d in get(client, h["editor"]).json()["days"]}
    assert len(by_date) == 8
    assert by_date["2027-01-04"]["kind"] == "holiday" and by_date["2027-01-07"]["kind"] == "holiday"
    assert by_date["2027-01-05"]["kind"] == "day_off" and by_date["2027-01-05"]["name"] is None
    assert by_date["2027-01-06"]["kind"] == "day_off"


def test_day_off_and_short_allowed_on_saturday(client, h):
    assert put(client, h["editor"], start="2027-01-02", end="2027-01-02", kind="day_off", name=None).status_code == 200
    assert put(client, h["editor"], start="2027-01-09", end="2027-01-09", kind="short", name=None).status_code == 200


def test_workday_on_weekend_allowed(client, h):
    r = put(client, h["editor"], start="2027-01-02", end="2027-01-03", kind="workday", name="Перенос")
    assert r.status_code == 200
    assert [d["kind"] for d in r.json()["days"]] == ["workday", "workday"]


# ---------- валидация (422, ничего не записано) ----------


@pytest.mark.parametrize(
    "over",
    [
        {"kind": "workday", "start": "2027-01-02", "end": "2027-01-04"},  # в диапазоне есть понедельник
        {"name": None},
        {"name": "   "},
        {"name": "я" * 101},
        {"start": "2027-01-01", "end": "2027-02-01"},  # 32 дня
        {"start": "2027-01-08", "end": "2027-01-01"},
        {"start": "1999-12-30", "end": "1999-12-31"},
        {"start": "2100-12-31", "end": "2101-01-01"},
        {"country": "US"},
        {"kind": "weekend"},
        {"extra": 1},
    ],
)
def test_invalid_write_is_422_and_writes_nothing(client, h, db, over):
    r = put(client, h["editor"], **over)
    assert r.status_code == 422, r.text
    assert count_rows(db) == 0
    assert audit(db) == []


def test_workday_error_lists_bad_dates(client, h):
    r = put(client, h["editor"], kind="workday", start="2027-01-01", end="2027-01-08")
    assert r.status_code == 422
    assert "04.01.2027" in r.json()["detail"] and "08.01.2027" not in r.json()["detail"]  # показано не больше 5 дат


def test_blank_name_for_day_off_becomes_null(client, h):
    r = put(client, h["editor"], kind="day_off", name="  ", start="2027-01-11", end="2027-01-11")
    assert r.status_code == 200
    assert r.json()["days"][0]["name"] is None


def test_31_days_allowed(client, h):
    assert put(client, h["editor"], start="2027-01-01", end="2027-01-31", kind="day_off", name=None).status_code == 200


def test_range_across_year_boundary(client, h):
    r = put(client, h["editor"], start="2026-12-30", end="2027-01-02")
    assert r.status_code == 200
    assert len(r.json()["days"]) == 4


# ---------- чтение ----------


def test_get_inclusive_sorted_both_countries(client, h):
    put(client, h["editor"], country="RU", start="2027-01-02", end="2027-01-03")
    put(client, h["editor"], country="AM", start="2027-01-03", end="2027-01-04")
    put(client, h["editor"], country="RU", start="2027-01-01", end="2027-01-01")
    body = get(client, h["emp"], "2027-01-01", "2027-01-03").json()
    assert body["start"] == "2027-01-01" and body["end"] == "2027-01-03"
    assert [(d["country"], d["date"]) for d in body["days"]] == [
        ("AM", "2027-01-03"),
        ("RU", "2027-01-01"),
        ("RU", "2027-01-02"),
        ("RU", "2027-01-03"),
    ]
    assert set(body["days"][0]) == {"country", "date", "kind", "name"}


def test_get_period_limits(client, h):
    assert get(client, h["emp"], "2027-01-01", "2028-02-05").status_code == 200  # 400 дней разницы
    assert get(client, h["emp"], "2027-01-01", "2028-02-06").status_code == 422  # 401
    assert get(client, h["emp"], "2027-01-10", "2027-01-01").status_code == 422
    assert get(client, h["emp"], "1999-01-01", "1999-02-01").status_code == 422
    assert client.get(BASE + "/days", params={"start": "2027-01-01"}, headers=h["emp"]).status_code == 422


# ---------- удаление ----------


def test_delete_range_counts_and_keeps_neighbours(client, h):
    put(client, h["editor"])
    put(client, h["editor"], country="AM")
    r = drop(client, h["editor"], start="2027-01-03", end="2027-01-05")
    assert r.status_code == 200 and r.json() == {"count": 3}
    assert drop(client, h["editor"], start="2027-01-03", end="2027-01-05").json() == {"count": 0}
    days = get(client, h["editor"]).json()["days"]
    ru = [d["date"] for d in days if d["country"] == "RU"]
    assert ru == ["2027-01-01", "2027-01-02", "2027-01-06", "2027-01-07", "2027-01-08"]
    assert len([d for d in days if d["country"] == "AM"]) == 8


@pytest.mark.parametrize("over", [{"start": "2027-01-08", "end": "2027-01-01"}, {"start": "2027-01-01", "end": "2027-02-01"}, {"start": "1999-01-01", "end": "1999-01-02"}])
def test_delete_invalid_range_is_422(client, h, over):
    assert drop(client, h["editor"], **over).status_code == 422


# ---------- журнал ----------


def test_audit_set_and_delete_without_names(client, h, db):
    put(client, h["editor"])
    drop(client, h["editor"], start="2027-01-20", end="2027-01-21")  # нечего удалять — записи нет
    assert [a[0] for a in audit(db)] == ["holidays.set"]
    drop(client, h["editor"], start="2027-01-01", end="2027-01-02")
    rows = audit(db)
    assert [a[0] for a in rows] == ["holidays.set", "holidays.delete"]
    assert all(a[1] == "holidays" for a in rows)
    assert set(rows[0][2]) == {"country", "start", "end", "kind", "count"}
    assert rows[0][2] == {"country": "RU", "start": "2027-01-01", "end": "2027-01-08", "kind": "holiday", "count": 8}
    assert set(rows[1][2]) == {"country", "start", "end", "count"} and rows[1][2]["count"] == 2
    assert NY not in json.dumps([a[2] for a in rows], ensure_ascii=False)
