"""HR-досье, деньги и документы, личные права на модуль, уведомления, отпуска и календарь. Люди и данные вымышленные."""
import json
from datetime import date, timedelta

import pytest
from sqlalchemy import text

from tests.conftest import login, make_user
from tests.test_me import dept_id
from tests.test_team import add_person

BASE = "/modules/hr"
TODAY = date.today()


def iso(days: int) -> str:
    return (TODAY + timedelta(days=days)).isoformat()


def fmt(days: int) -> str:
    return (TODAY + timedelta(days=days)).strftime("%d.%m.%Y")


def audit(db, action):
    return db.execute(text("SELECT details FROM trendsetter_hub.audit_log WHERE action = :a ORDER BY id"), {"a": action}).scalars().all()


def link(db, person_id, user):
    db.execute(text("UPDATE trendsetter_hub.team_people SET user_id = :u WHERE id = :p"), {"u": user.id, "p": person_id})
    db.commit()


@pytest.fixture()
def admin(client, db):
    make_user(db, "admin@example.com", "admin")
    return login(client, "admin@example.com")


def grant(client, admin, user, module, permission):
    r = client.patch(f"/admin/users/{user.id}/module-permissions", json={"moduleId": module, "permission": permission}, headers=admin)
    assert r.status_code == 200, r.text


@pytest.fixture()
def hr(client, db):
    make_user(db, "hr@example.com", "employee", [dept_id(db, "hr")], name="Эйч Арова")
    return login(client, "hr@example.com")


@pytest.fixture()
def resp(client, db, admin):
    user = make_user(db, "resp@example.com", "employee", name="Ответ Ственный")
    grant(client, admin, user, "hr", "responsible")
    return login(client, "resp@example.com")


@pytest.fixture()
def person(db):
    return add_person(db, "Анна", "Альфа")


@pytest.fixture()
def team(client, db):
    """Руководитель m (с аккаунтом), сотрудники e и c с аккаунтами, все под m."""
    ceo = add_person(db, "Главный", "Босс", None, "leadership", ceo=True)
    mgr = add_person(db, "Мария", "Мэнэджер", ceo)
    emp = add_person(db, "Егор", "Ермолов", mgr)
    col = add_person(db, "Клим", "Коллегин", mgr)
    users = {}
    for key, pid, name in (("m", mgr, "Мэнэджер Мария"), ("e", emp, "Ермолов Егор"), ("c", col, "Коллегин Клим")):
        users[key] = make_user(db, f"{key}@example.com", "employee", name=name)
        link(db, pid, users[key])
    return {"ids": {"m": mgr, "e": emp, "c": col}, "users": users, **{k: login(client, f"{k}@example.com") for k in ("m", "e", "c")}}


def notes(client, headers, **params):
    return client.get("/core/notifications", params=params, headers=headers).json()


def request(client, headers, **over):
    body = {"kind": "annual", "start": iso(10), "end": iso(16), "message": "На связи в Telegram", **over}
    return client.post(f"{BASE}/me/leave/requests", json=body, headers=headers)


def set_hired(client, hr, person_id, months_ago, country="AM"):
    hired = TODAY - timedelta(days=31 * months_ago)
    r = client.patch(f"{BASE}/people/{person_id}/file", json={"hiredAt": hired.isoformat(), "country": country}, headers=hr)
    assert r.status_code == 200, r.text


# ---------- личные права на модуль ----------


def test_personal_permission_roundtrip(client, db, admin):
    user = make_user(db, "p@example.com", "employee")
    h = login(client, "p@example.com")
    assert client.get("/core/me", headers=h).json()["module_access"]["hr"] == "none"
    assert client.get(f"/admin/users/{user.id}/module-permissions", headers=admin).json() == {"permissions": {}}
    r = client.patch(f"/admin/users/{user.id}/module-permissions", json={"moduleId": "hr", "permission": "responsible"}, headers=admin)
    assert r.json() == {"permissions": {"hr": "responsible"}}
    me = client.get("/core/me", headers=h).json()  # действует сразу, без перелогина
    assert me["module_access"]["hr"] == "run" and me["module_responsible"]["hr"] is True and me["module_responsible"]["team"] is False
    client.patch(f"/admin/users/{user.id}/module-permissions", json={"moduleId": "hr", "permission": "view"}, headers=admin)
    me = client.get("/core/me", headers=h).json()
    assert me["module_access"]["hr"] == "view" and me["module_responsible"]["hr"] is False
    client.patch(f"/admin/users/{user.id}/module-permissions", json={"moduleId": "hr", "permission": None}, headers=admin)
    assert client.get("/core/me", headers=h).json()["module_access"]["hr"] == "none"
    assert [d["permission"] for d in audit(db, "core.user_permission_set")] == ["responsible", "view", None]


def test_personal_permission_validation_and_access(client, db, admin):
    user = make_user(db, "p@example.com", "employee")
    h = login(client, "p@example.com")
    url = f"/admin/users/{user.id}/module-permissions"
    assert client.patch(url, json={"moduleId": "nope", "permission": "run"}, headers=admin).status_code == 422
    assert client.patch(url, json={"moduleId": "hr", "permission": "boss"}, headers=admin).status_code == 422
    assert client.patch("/admin/users/9999/module-permissions", json={"moduleId": "hr", "permission": "run"}, headers=admin).status_code == 404
    assert client.get(url, headers=h).status_code == 403
    assert client.patch(url, json={"moduleId": "hr", "permission": "run"}, headers=h).status_code == 403
    assert client.get(url).status_code == 401


def test_personal_and_group_permissions_take_maximum(client, db, admin):
    user = make_user(db, "p@example.com", "employee")
    client.post("/admin/groups", json={"name": "Г", "permissions": {"hr": "run"}, "user_ids": [user.id]}, headers=admin)
    grant(client, admin, user, "hr", "responsible")
    me = client.get("/core/me", headers=login(client, "p@example.com")).json()
    assert me["module_access"]["hr"] == "run" and me["module_responsible"]["hr"] is True


# ---------- деньги и документы ----------


def test_hr_without_responsible_cannot_see_sensitive(client, hr, admin, person):
    f = client.get(f"{BASE}/people/{person}/file", headers=hr).json()
    assert f["canSeeSensitive"] is False and set(f["file"]) >= {"legalName", "hiredAt", "country"}
    assert "salary" not in json.dumps(f)
    assert client.get(f"{BASE}/people/{person}/sensitive", headers=hr).status_code == 403
    assert client.patch(f"{BASE}/people/{person}/sensitive", json={"salary": 1}, headers=hr).status_code == 403
    # admin имеет run, но не responsible (Q-G2)
    assert client.get(f"{BASE}/people/{person}/sensitive", headers=admin).status_code == 403
    assert client.get(f"{BASE}/people/{person}/file", headers=admin).status_code == 200


def test_employee_has_no_hr_access(client, db, person):
    make_user(db, "x@example.com", "employee")
    h = login(client, "x@example.com")
    assert client.get(f"{BASE}/people/{person}/file", headers=h).status_code == 403
    assert client.get(f"{BASE}/leave/requests", headers=h).status_code == 403
    assert client.get(f"{BASE}/leave/policies", headers=h).status_code == 403
    assert client.get(f"{BASE}/people/{person}/file").status_code == 401


def test_file_patch_validation_and_roundtrip(client, db, hr, person):
    url = f"{BASE}/people/{person}/file"
    body = {"legalName": " Альфа Анна Петровна ", "hiredAt": "2025-01-15", "country": "AM", "employmentType": "staff", "phone": ""}
    r = client.patch(url, json=body, headers=hr)
    assert r.status_code == 200, r.text
    f = r.json()["file"]
    assert f["legalName"] == "Альфа Анна Петровна" and f["hiredAt"] == "2025-01-15" and f["country"] == "AM" and f["phone"] is None
    assert client.patch(url, json={"country": "US"}, headers=hr).status_code == 422
    assert client.patch(url, json={"employmentType": "x"}, headers=hr).status_code == 422
    assert client.patch(url, json={"hiredAt": "15.01.2025"}, headers=hr).status_code == 422
    assert client.patch(url, json={"salary": 5}, headers=hr).status_code == 422  # чужое поле
    assert client.patch(url, json={"personalEmail": "bad"}, headers=hr).status_code == 422
    assert client.patch(url, json={"country": None}, headers=hr).json()["file"]["country"] is None
    assert client.get(f"{BASE}/people/9999/file", headers=hr).status_code == 404
    log = audit(db, "hr.file_update")
    assert log[0] == {"person_id": person, "fields": ["country", "employmentType", "hiredAt", "legalName", "phone"]}
    assert "Петровна" not in json.dumps(log, ensure_ascii=False)


def test_sensitive_roundtrip_and_values_not_logged(client, db, resp, person):
    url = f"{BASE}/people/{person}/sensitive"
    assert client.get(url, headers=resp).json()["salary"] is None
    body = {"salary": 123456.5, "currency": "RUB", "payDay1": 5, "payDay2": 20, "passport": "4500 987654", "taxId": "770012345678"}
    assert client.patch(url, json=body, headers=resp).status_code == 200
    got = client.get(url, headers=resp).json()
    assert got["salary"] == 123456.5 and got["passport"] == "4500 987654" and got["payDay2"] == 20 and got["bankDetails"] is None
    assert client.patch(url, json={"payDay1": 40}, headers=resp).status_code == 422
    assert client.patch(url, json={"salary": -1}, headers=resp).status_code == 422
    file_view = client.get(f"{BASE}/people/{person}/file", headers=resp).json()
    assert file_view["canSeeSensitive"] is True and "987654" not in json.dumps(file_view)
    dump = json.dumps(audit(db, "hr.sensitive_update"), ensure_ascii=False)
    assert "payDay2" in dump and "passport" in dump
    for secret in ("123456", "987654", "770012345678", "RUB"):
        assert secret not in dump
    # значения не утекают в карту и список людей HR
    assert "987654" not in json.dumps(client.get("/modules/team/map", headers=resp).json())
    assert "987654" not in json.dumps(client.get("/modules/team/hr/people", headers=resp).json())


def test_video_link_field_exists(client, hr):
    fields = client.get("/modules/team/hr/fields", headers=hr).json()
    keys = [f["key"] for f in fields]
    video = fields[keys.index("video_link")]
    assert video["kind"] == "links" and video["required"] is False and video["isSystem"] is False
    assert keys.index("video_link") == keys.index("socials") + 1


def test_my_file_exposes_only_four_fields(client, db, hr, resp, team):
    pid = team["ids"]["e"]
    assert client.get(f"{BASE}/me/file", headers=team["e"]).json() == {"person": {"id": pid, "name": "Ермолов Егор"}, "file": None}  # досье нет
    client.patch(f"{BASE}/people/{pid}/file", json={"legalName": "Ермолов Егор Игоревич", "hiredAt": "2025-01-15", "country": "RU", "workSchedule": "5/2", "phone": "+7000", "notes": "секрет", "birthDate": "1990-01-01"}, headers=hr)
    client.patch(f"{BASE}/people/{pid}/sensitive", json={"salary": 777777, "passport": "1234 567890"}, headers=resp)
    r = client.get(f"{BASE}/me/file", headers=team["e"])
    assert r.json() == {
        "person": {"id": pid, "name": "Ермолов Егор"},
        "file": {"legalName": "Ермолов Егор Игоревич", "hiredAt": "2025-01-15", "country": "RU", "workSchedule": "5/2"},
    }
    assert "777777" not in r.text and "567890" not in r.text and "секрет" not in r.text
    other = client.get(f"{BASE}/me/file", headers=team["c"]).json()  # коллега видит только своё (досье нет)
    assert other["person"]["name"] == "Коллегин Клим" and other["file"] is None
    make_user(db, "solo@example.com", "employee", name="Одинокий Человек")
    assert client.get(f"{BASE}/me/file", headers=login(client, "solo@example.com")).json() == {"person": None, "file": None}
    assert client.get(f"{BASE}/me/file").status_code == 401


def test_my_compensation_own_only(client, db, hr, resp, team):
    e, c = team["ids"]["e"], team["ids"]["c"]
    url = f"{BASE}/me/compensation"
    assert client.get(url, headers=team["e"]).json() == {"person": {"id": e, "name": "Ермолов Егор"}, "compensation": None}  # записи нет
    client.patch(f"{BASE}/people/{e}/sensitive", json={"salary": 777777.5, "currency": "RUB", "payDay1": 5, "payDay2": 20, "passport": "1234 567890", "taxId": "770012345678", "bankDetails": "СЧЁТ-42", "bonusNote": "премия-секрет"}, headers=resp)
    client.patch(f"{BASE}/people/{c}/sensitive", json={"salary": 111222}, headers=resp)
    r = client.get(url, headers=team["e"])
    assert r.json() == {"person": {"id": e, "name": "Ермолов Егор"}, "compensation": {"salary": 777777.5, "currency": "RUB", "payDay1": 5, "payDay2": 20}}
    for secret in ("567890", "770012345678", "СЧЁТ", "премия", "111222"):
        assert secret not in r.text
    other = client.get(url, headers=team["c"]).json()
    assert other["person"]["id"] == c and other["compensation"]["salary"] == 111222 and "777777" not in json.dumps(other)
    assert client.get(url).status_code == 401
    dump = json.dumps(audit(db, "hr.compensation_view"), ensure_ascii=False)
    assert audit(db, "hr.compensation_view")[0] == {"person_id": e}
    for secret in ("777777", "111222", "RUB"):
        assert secret not in dump
    # деньги не утекают в другие «свои» эндпоинты, карту и список людей
    for u in (f"{BASE}/me/file", f"{BASE}/me/leave"):
        assert "777777" not in client.get(u, headers=team["e"]).text, u
    for h in (resp, hr):
        for u in ("/modules/team/map", "/modules/team/hr/people"):
            assert "777777" not in client.get(u, headers=h).text, u


def test_my_compensation_requires_user_id_link(client, db, resp):
    pid = add_person(db, "Одинокий", "Человек")
    user = make_user(db, "solo@example.com", "employee", name="Одинокий Человек")  # имя совпадает, user_id не привязан
    client.patch(f"{BASE}/people/{pid}/sensitive", json={"salary": 999000}, headers=resp)
    me = login(client, "solo@example.com")
    assert client.get(f"{BASE}/me/compensation", headers=me).json() == {"person": None, "compensation": None}
    assert audit(db, "hr.compensation_view") == []
    link(db, pid, user)
    assert client.get(f"{BASE}/me/compensation", headers=me).json()["compensation"]["salary"] == 999000


def test_notification_links(client, hr, team):
    req = request(client, team["e"]).json()
    assert notes(client, team["m"])[0]["link"] == "/profile?section=approvals"
    client.post(f"{BASE}/leave/requests/{req['id']}/decision", json={"approve": True}, headers=team["m"])
    assert notes(client, team["e"])[0]["link"] == "/profile?section=leave"
    assert notes(client, team["c"])[0]["link"] == "/modules/team" and notes(client, hr)[0]["link"] == "/modules/team"
    rej = request(client, team["e"], start=iso(30), end=iso(31)).json()
    client.post(f"{BASE}/leave/requests/{rej['id']}/decision", json={"approve": False, "comment": "нет"}, headers=team["m"])
    assert notes(client, team["e"])[0]["link"] == "/profile?section=leave"


def test_hr_link_for_request_without_manager_account(client, db, hr):
    boss = add_person(db, "Без", "Аккаунта")
    low = add_person(db, "Низов", "Иван", boss)
    link(db, low, make_user(db, "low@example.com", "employee", name="Низов Иван"))
    request(client, login(client, "low@example.com"))
    assert notes(client, hr)[0]["link"] == "/modules/hr"


# ---------- уведомления ----------


def test_notifications_list_and_read(client, db, team):
    from app.core.notifications import notify

    u = team["users"]["e"]
    notify(db, [u.id], "k", "Первое", "тело", "/profile")
    db.commit()
    notify(db, [u.id], "k", "Второе")
    db.commit()
    assert client.get("/core/me", headers=team["e"]).json()["unread_notifications"] == 2
    items = notes(client, team["e"])
    assert [n["title"] for n in items] == ["Второе", "Первое"] and items[1]["link"] == "/profile" and items[0]["read"] is False
    assert len(notes(client, team["e"], limit=1)) == 1
    assert notes(client, team["c"]) == []  # чужие не видны
    client.post("/core/notifications/read", json={"ids": [items[0]["id"]]}, headers=team["c"])  # чужой id игнорируется
    assert client.get("/core/me", headers=team["e"]).json()["unread_notifications"] == 2
    assert client.post("/core/notifications/read", json={"ids": [items[0]["id"]]}, headers=team["e"]).json() == {"ok": True}
    assert [n["title"] for n in notes(client, team["e"], unread=1)] == ["Первое"]
    client.post("/core/notifications/read", json={"ids": None}, headers=team["e"])
    assert client.get("/core/me", headers=team["e"]).json()["unread_notifications"] == 0
    assert all(n["read"] for n in notes(client, team["e"]))
    assert client.get("/core/notifications").status_code == 401


# ---------- заявки на отпуск ----------


def test_full_cycle_approve(client, db, hr, team):
    set_hired(client, hr, team["ids"]["e"], 12)
    r = request(client, team["e"])
    assert r.status_code == 200, r.text
    req = r.json()
    assert req["status"] == "pending" and req["days"] == 7 and req["personName"] == "Ермолов Егор" and req["message"] == "На связи в Telegram"
    # уведомление — руководителю-пользователю; HR и коллега не получают
    assert [n["title"] for n in notes(client, team["m"])] == ["Заявка на отпуск"]
    assert notes(client, hr) == [] and notes(client, team["c"]) == []
    assert [a["id"] for a in client.get(f"{BASE}/me/approvals", headers=team["m"]).json()] == [req["id"]]
    assert client.get(f"{BASE}/me/approvals", headers=team["c"]).json() == []
    # согласовать может только руководитель (или HR)
    assert client.post(f"{BASE}/leave/requests/{req['id']}/decision", json={"approve": True}, headers=team["c"]).status_code == 403
    d = client.post(f"{BASE}/leave/requests/{req['id']}/decision", json={"approve": True}, headers=team["m"])
    assert d.status_code == 200, d.text
    assert d.json()["status"] == "approved" and d.json()["decidedBy"] == "Мэнэджер Мария" and d.json()["decidedAt"]
    col = notes(client, team["c"])
    assert len(col) == 1 and col[0]["kind"] == "leave_approved"
    assert col[0]["body"] == f"Ермолов Егор не будет на работе с {fmt(10)} по {fmt(16)}. Сообщение: На связи в Telegram"
    assert len(notes(client, hr)) == 1  # HR — коллега по правилу ТЗ
    assert [n["kind"] for n in notes(client, team["m"])] == ["leave_request"]  # инициатор решения не уведомляется
    assert [n["kind"] for n in notes(client, team["e"])] == ["leave_decision"]
    again = client.post(f"{BASE}/leave/requests/{req['id']}/decision", json={"approve": False, "comment": "поздно"}, headers=team["m"])
    assert again.status_code == 409
    # баланс: 12 месяцев ≈ 28 дней, 7 запланировано
    mine = client.get(f"{BASE}/me/leave", headers=team["e"]).json()
    assert mine["person"]["name"] == "Ермолов Егор" and mine["approver"] == {"name": "Мэнэджер Мария"} and mine["policy"]["country"] == "AM"
    b = mine["balance"]
    assert b["planned"] == 7 and b["used"] == 0 and b["availableFrom"] is None and b["available"] == round(b["accrued"] + b["adjust"] - 7, 2)
    assert [x["id"] for x in mine["requests"]] == [req["id"]]
    assert "Telegram" not in json.dumps(audit(db, "hr.leave_request"), ensure_ascii=False)
    assert audit(db, "hr.leave_approve") == [{"request_id": req["id"], "person_id": team["ids"]["e"]}]


def test_reject_requires_comment(client, team):
    req = request(client, team["e"]).json()
    url = f"{BASE}/leave/requests/{req['id']}/decision"
    assert client.post(url, json={"approve": False}, headers=team["m"]).status_code == 422
    assert client.post(url, json={"approve": False, "comment": "  "}, headers=team["m"]).status_code == 422
    assert client.post(url, json={"approve": False, "comment": "x" * 501}, headers=team["m"]).status_code == 422
    r = client.post(url, json={"approve": False, "comment": "Горит проект"}, headers=team["m"])
    assert r.json()["status"] == "rejected" and r.json()["decisionComment"] == "Горит проект"
    note = [n for n in notes(client, team["e"]) if n["kind"] == "leave_decision"][0]
    assert "Горит проект" in note["body"]
    assert notes(client, team["c"]) == []  # коллегам об отказе не сообщаем
    assert client.get(f"{BASE}/me/leave", headers=team["e"]).json()["balance"] is None  # HR не указал дату приёма


def test_cancel_pending_and_approved(client, team):
    first = request(client, team["e"]).json()
    c = client.post(f"{BASE}/me/leave/requests/{first['id']}/cancel", headers=team["e"])
    assert c.status_code == 200 and c.json()["status"] == "cancelled"
    assert client.post(f"{BASE}/me/leave/requests/{first['id']}/cancel", headers=team["e"]).status_code == 409
    second = request(client, team["e"]).json()  # даты освободились после отмены
    client.post(f"{BASE}/leave/requests/{second['id']}/decision", json={"approve": True}, headers=team["m"])
    assert client.post(f"{BASE}/me/leave/requests/{second['id']}/cancel", headers=team["c"]).status_code == 404  # чужую нельзя
    assert len(notes(client, team["c"])) == 1
    assert client.post(f"{BASE}/me/leave/requests/{second['id']}/cancel", headers=team["e"]).json()["status"] == "cancelled"
    assert [n["kind"] for n in notes(client, team["c"])] == ["leave_cancelled", "leave_approved"]
    assert [n["kind"] for n in notes(client, team["m"])].count("leave_cancelled") == 1  # руководитель — коллега


def test_cannot_cancel_started_approved(client, hr, team):
    body = {"kind": "annual", "start": iso(-3), "end": iso(3), "status": "approved"}
    r = client.post(f"{BASE}/people/{team['ids']['e']}/leave/requests", json=body, headers=hr)
    assert r.status_code == 200, r.text
    assert client.post(f"{BASE}/me/leave/requests/{r.json()['id']}/cancel", headers=team["e"]).status_code == 409


def test_overlap_past_and_validation(client, team):
    assert request(client, team["e"]).status_code == 200
    assert request(client, team["e"], start=iso(16), end=iso(20)).status_code == 409  # пересечение по последнему дню
    assert request(client, team["e"], start=iso(17), end=iso(20)).status_code == 200  # смежные даты можно
    assert request(client, team["e"], start=iso(-2), end=iso(2), kind="unpaid").status_code == 422  # прошлое
    assert request(client, team["e"], start=iso(40), end=iso(30)).status_code == 422
    assert request(client, team["e"], start="01.01.2030", end="02.01.2030").status_code == 422
    assert request(client, team["e"], kind="holiday", start=iso(50), end=iso(51)).status_code == 422
    assert request(client, team["e"], start=iso(50), end=iso(51), message="x" * 1001).status_code == 422
    assert request(client, team["e"], start=iso(50), end=iso(51), kind="sick").status_code == 200


def test_first_leave_not_before_policy_date(client, hr, team):
    pid = team["ids"]["e"]
    client.patch(f"{BASE}/people/{pid}/file", json={"hiredAt": iso(-60), "country": "RU"}, headers=hr)
    b = client.get(f"{BASE}/me/leave", headers=team["e"]).json()["balance"]
    assert b["availableFrom"] is not None and b["accrued"] > 0
    right = date.fromisoformat(b["availableFrom"])
    r = request(client, team["e"], start=(right - timedelta(days=1)).isoformat(), end=(right + timedelta(days=3)).isoformat())
    assert r.status_code == 422 and r.json()["detail"] == f"Право на отпуск возникает с {right.strftime('%d.%m.%Y')}"
    assert request(client, team["e"], start=right.isoformat(), end=(right + timedelta(days=3)).isoformat()).status_code == 200
    assert request(client, team["e"], kind="unpaid", start=iso(5), end=iso(6)).status_code == 200  # ограничение только для ежегодного


def test_no_person_card(client, db):
    make_user(db, "solo@example.com", "employee", name="Одинокий Человек")
    h = login(client, "solo@example.com")
    assert client.get(f"{BASE}/me/leave", headers=h).json() == {"person": None, "policy": None, "balance": None, "requests": [], "approver": None}
    assert request(client, h).status_code == 422


def test_manager_without_account_goes_to_hr(client, db, hr, team):
    ceo = db.execute(text("SELECT id FROM trendsetter_hub.team_people WHERE is_ceo")).scalar_one()
    boss = add_person(db, "Без", "Аккаунта", ceo)  # руководитель без аккаунта
    low = add_person(db, "Низов", "Иван", boss)
    user = make_user(db, "low@example.com", "employee", name="Низов Иван")
    link(db, low, user)
    h = login(client, "low@example.com")
    assert client.get("/core/me", headers=hr).json()["module_badges"] == {}
    req = request(client, h).json()
    assert [n["kind"] for n in notes(client, hr)] == ["leave_request"]
    assert client.get("/core/me", headers=hr).json()["module_badges"] == {"hr": 1}  # заявка ждёт HR
    assert client.get(f"{BASE}/me/leave", headers=h).json()["approver"] is None
    assert client.post(f"{BASE}/leave/requests/{req['id']}/decision", json={"approve": True}, headers=h).status_code == 403
    assert client.post(f"{BASE}/leave/requests/{req['id']}/decision", json={"approve": True}, headers=hr).json()["status"] == "approved"
    assert client.get("/core/me", headers=hr).json()["module_badges"] == {}
    # заявка, которую согласует руководитель-пользователь, бейдж HR не увеличивает
    assert request(client, team["e"], start=iso(100), end=iso(101)).status_code == 200
    assert client.get("/core/me", headers=hr).json()["module_badges"] == {}


def test_hr_creates_for_employee_and_adjusts(client, db, hr, team):
    pid = team["ids"]["e"]
    set_hired(client, hr, pid, 12)
    body = {"kind": "annual", "start": iso(-40), "end": iso(-27), "message": "м", "status": "approved"}
    past = client.post(f"{BASE}/people/{pid}/leave/requests", json=body, headers=hr)
    assert past.status_code == 200 and past.json()["status"] == "approved" and past.json()["days"] == 14
    assert notes(client, team["c"]) == []  # задним числом — без уведомления коллегам
    assert notes(client, team["m"]) == []  # approver не уведомляется
    future = client.post(f"{BASE}/people/{pid}/leave/requests", json={"kind": "unpaid", "start": iso(5), "end": iso(6), "status": "approved"}, headers=hr)
    assert future.status_code == 200 and len(notes(client, team["c"])) == 1
    bad = client.post(f"{BASE}/people/{pid}/leave/requests", json={"kind": "annual", "start": iso(-30), "end": iso(-29), "status": "pending"}, headers=hr)
    assert bad.status_code == 422  # статус только approved
    before = client.get(f"{BASE}/me/leave", headers=team["e"]).json()["balance"]
    assert before["used"] == 14
    a = client.post(f"{BASE}/people/{pid}/leave/adjustments", json={"deltaDays": 5, "reason": "Остаток с прошлого места"}, headers=hr)
    assert a.status_code == 200 and a.json()["deltaDays"] == 5 and a.json()["reason"] == "Остаток с прошлого места"
    client.post(f"{BASE}/people/{pid}/leave/adjustments", json={"deltaDays": -2, "reason": "Корректировка"}, headers=hr)
    assert client.post(f"{BASE}/people/{pid}/leave/adjustments", json={"deltaDays": 0, "reason": "x"}, headers=hr).status_code == 422
    assert client.post(f"{BASE}/people/{pid}/leave/adjustments", json={"deltaDays": 1, "reason": ""}, headers=hr).status_code == 422
    after = client.get(f"{BASE}/me/leave", headers=team["e"]).json()["balance"]
    assert after["adjust"] == 3 and after["available"] == round(before["available"] + 3, 2)
    block = client.get(f"{BASE}/people/{pid}/file", headers=hr).json()["leave"]
    assert [x["deltaDays"] for x in block["adjustments"]] == [-2, 5] and len(block["requests"]) == 2 and block["balance"]["used"] == 14
    assert len(audit(db, "hr.leave_adjust")) == 2


def test_hr_request_list_filters(client, hr, team):
    a = request(client, team["e"]).json()
    request(client, team["c"], start=iso(30), end=iso(31))
    client.post(f"{BASE}/leave/requests/{a['id']}/decision", json={"approve": True}, headers=team["m"])
    assert len(client.get(f"{BASE}/leave/requests", headers=hr).json()) == 2
    assert [r["status"] for r in client.get(f"{BASE}/leave/requests?status=pending", headers=hr).json()] == ["pending"]
    only = client.get(f"{BASE}/leave/requests?status=all&personId={team['ids']['e']}", headers=hr).json()
    assert [r["personId"] for r in only] == [team["ids"]["e"]]
    assert client.get(f"{BASE}/leave/requests?status=weird", headers=hr).status_code == 422


def test_hr_cancels_requests_and_awaiting_flag(client, db, hr, team):
    pid = team["ids"]["e"]
    set_hired(client, hr, pid, 12)
    req = request(client, team["e"]).json()
    assert req["awaitingHr"] is False  # есть руководитель с аккаунтом
    ceo = db.execute(text("SELECT id FROM trendsetter_hub.team_people WHERE is_ceo")).scalar_one()
    low = add_person(db, "Низов", "Иван", add_person(db, "Без", "Аккаунта", ceo))
    link(db, low, make_user(db, "low@example.com", "employee", name="Низов Иван"))
    waiting = request(client, login(client, "low@example.com")).json()
    assert waiting["awaitingHr"] is True
    assert [r["awaitingHr"] for r in client.get(f"{BASE}/leave/requests?status=pending", headers=hr).json()].count(True) == 1
    assert client.post(f"{BASE}/leave/requests/{req['id']}/cancel", headers=team["e"]).status_code == 403  # не HR
    client.post(f"{BASE}/leave/requests/{req['id']}/decision", json={"approve": True}, headers=team["m"])
    assert client.get(f"{BASE}/me/leave", headers=team["e"]).json()["balance"]["planned"] == 7
    r = client.post(f"{BASE}/leave/requests/{req['id']}/cancel", headers=hr)
    assert r.status_code == 200 and r.json()["status"] == "cancelled" and r.json()["awaitingHr"] is False
    assert client.get(f"{BASE}/me/leave", headers=team["e"]).json()["balance"]["planned"] == 0
    assert [n["kind"] for n in notes(client, team["c"])][0] == "leave_cancelled"
    mine = notes(client, team["e"])[0]
    assert mine["kind"] == "leave_cancelled_by_hr" and mine["title"] == "HR отменил заявку" and mine["link"] == "/profile?section=leave"
    assert client.post(f"{BASE}/leave/requests/{req['id']}/cancel", headers=hr).status_code == 409
    rej = request(client, team["e"], start=iso(30), end=iso(31)).json()
    client.post(f"{BASE}/leave/requests/{rej['id']}/decision", json={"approve": False, "comment": "нет"}, headers=team["m"])
    assert client.post(f"{BASE}/leave/requests/{rej['id']}/cancel", headers=hr).status_code == 409
    assert client.post(f"{BASE}/leave/requests/9999/cancel", headers=hr).status_code == 404
    # прошедшая заявка: баланс пересчитывается, коллегам тишина
    past = client.post(f"{BASE}/people/{pid}/leave/requests", json={"kind": "annual", "start": iso(-40), "end": iso(-27), "status": "approved"}, headers=hr).json()
    assert client.get(f"{BASE}/me/leave", headers=team["e"]).json()["balance"]["used"] == 14
    before = len(notes(client, team["c"]))
    assert client.post(f"{BASE}/leave/requests/{past['id']}/cancel", headers=hr).json()["status"] == "cancelled"
    assert client.get(f"{BASE}/me/leave", headers=team["e"]).json()["balance"]["used"] == 0
    assert len(notes(client, team["c"])) == before
    assert audit(db, "hr.leave_cancel")[-1] == {"request_id": past["id"], "person_id": pid, "by_hr": True}


# ---------- календарь ----------


def test_calendar_hides_messages_and_sick(client, db, hr, team):
    pid = team["ids"]["e"]
    for kind, start in (("annual", 10), ("sick", 40), ("unpaid", 60)):
        body = {"kind": kind, "start": iso(start), "end": iso(start + 2), "message": "секрет", "status": "approved"}
        client.post(f"{BASE}/people/{pid}/leave/requests", json=body, headers=hr)
    client.post(f"{BASE}/people/{team['ids']['c']}/leave/requests", json={"kind": "annual", "start": iso(10), "end": iso(12)}, headers=hr)  # pending
    r = client.get(f"{BASE}/leave/calendar", params={"from": iso(0), "to": iso(90)}, headers=team["c"])  # обычный сотрудник: team для всех
    assert r.status_code == 200
    items = r.json()
    assert [i["kind"] for i in items] == ["annual", "unpaid"]
    assert set(items[0]) == {"personId", "name", "directionId", "kind", "start", "end"} and items[0]["name"] == "Ермолов Егор"
    assert "секрет" not in r.text
    assert client.get(f"{BASE}/leave/calendar", params={"from": iso(11), "to": iso(20)}, headers=team["c"]).json()[0]["start"] == iso(10)
    assert client.get(f"{BASE}/leave/calendar", params={"from": iso(20), "to": iso(30)}, headers=team["c"]).json() == []
    db.execute(text("UPDATE trendsetter_hub.team_people SET is_archived = true WHERE id = :p"), {"p": pid})  # архивных в календаре нет
    db.commit()
    assert client.get(f"{BASE}/leave/calendar", params={"from": iso(0), "to": iso(90)}, headers=team["c"]).json() == []


def test_calendar_validation_and_access(client, db, team):
    url = f"{BASE}/leave/calendar"
    assert client.get(url, params={"from": iso(0), "to": iso(400)}, headers=team["c"]).status_code == 200
    assert client.get(url, params={"from": iso(0), "to": iso(401)}, headers=team["c"]).status_code == 422
    assert client.get(url, params={"from": iso(5), "to": iso(1)}, headers=team["c"]).status_code == 422
    assert client.get(url, params={"from": "x", "to": iso(1)}, headers=team["c"]).status_code == 422
    assert client.get(url, params={"from": iso(0)}, headers=team["c"]).status_code == 422
    make_user(db, "v@example.com", "viewer")  # structure: только схема
    assert client.get(url, params={"from": iso(0), "to": iso(1)}, headers=login(client, "v@example.com")).status_code == 403
    assert client.get(url, params={"from": iso(0), "to": iso(1)}).status_code == 401


# ---------- нормы отпуска ----------


def test_policies_defaults_and_update(client, db, hr, resp):
    pol = {p["country"]: p for p in client.get(f"{BASE}/leave/policies", headers=hr).json()}
    assert pol["RU"] == {"country": "RU", "daysPerYear": 28, "accruePerMonth": 2.333, "firstLeaveAfterMonths": 6}
    assert pol["AM"]["firstLeaveAfterMonths"] == 0
    assert client.patch(f"{BASE}/leave/policies/AM", json={"daysPerYear": 30}, headers=hr).status_code == 403
    body = {"daysPerYear": 30, "accruePerMonth": 2.5, "firstLeaveAfterMonths": 3}
    r = client.patch(f"{BASE}/leave/policies/AM", json=body, headers=resp)
    assert r.json() == {"country": "AM", "daysPerYear": 30, "accruePerMonth": 2.5, "firstLeaveAfterMonths": 3}
    assert client.patch(f"{BASE}/leave/policies/AM", json={"daysPerYear": -1}, headers=resp).status_code == 422
    assert client.patch(f"{BASE}/leave/policies/AM", json={"firstLeaveAfterMonths": 1.5}, headers=resp).status_code == 422
    assert client.patch(f"{BASE}/leave/policies/US", json={"daysPerYear": 1}, headers=resp).status_code == 404
    assert audit(db, "hr.policy_update")[0] == {"country": "AM", "fields": ["accruePerMonth", "daysPerYear", "firstLeaveAfterMonths"]}


# ---------- документы сотрудника ----------

PDF = b"%PDF-1.4\n" + bytes(range(256)) * 4
SECRET_FILE_NAME = "Секретный паспорт Иванова.pdf"


def b64(data: bytes) -> str:
    import base64

    return base64.b64encode(data).decode()


def doc_body(**kw):
    return {"category": "contract", "title": "Трудовой договор", "fileName": "contract.pdf", "dataBase64": b64(PDF), **kw}


def upload(client, headers, person, **kw):
    return client.post(f"{BASE}/people/{person}/documents", json=doc_body(**kw), headers=headers)


def test_documents_require_responsible(client, db, hr, admin, resp, person):
    doc = upload(client, resp, person).json()["id"]
    for h in (hr, admin):
        assert client.get(f"{BASE}/people/{person}/documents", headers=h).status_code == 403
        assert upload(client, h, person).status_code == 403
        assert client.get(f"{BASE}/documents/{doc}", headers=h).status_code == 403
        assert client.post(f"{BASE}/documents/{doc}/delete", headers=h).status_code == 403
    assert client.get(f"{BASE}/people/{person}/documents", headers=resp).status_code == 200
    assert client.get(f"{BASE}/documents/{doc}", headers=resp).status_code == 200


def test_document_roundtrip_same_bytes(client, db, resp, person):
    import base64

    r = upload(client, resp, person, title="  Договор  ", fileName="C:\\fake\\dir/../my\x00 file\n.PDF")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["title"] == "Договор" and d["fileName"] == "my file.PDF" and d["mime"] == "application/pdf"
    assert d["sizeBytes"] == len(PDF) and d["uploadedBy"] == "Ответ Ственный" and d["category"] == "contract" and d["uploadedAt"]
    assert set(d) == {"id", "category", "title", "fileName", "mime", "sizeBytes", "uploadedBy", "uploadedAt", "visibleToEmployee"}
    assert client.get(f"{BASE}/people/{person}/documents", headers=resp).json() == [d]
    got = client.get(f"{BASE}/documents/{d['id']}", headers=resp).json()
    assert got["fileName"] == "my file.PDF" and got["mime"] == "application/pdf" and got["sizeBytes"] == len(PDF)
    assert base64.b64decode(got["dataBase64"]) == PDF


def test_document_mime_set_by_server(client, resp, person):
    assert upload(client, resp, person, fileName="a.txt", dataBase64=b64("текст".encode())).json()["mime"] == "text/plain"
    assert upload(client, resp, person, fileName="x.jpeg", dataBase64=b64(b"\xff\xd8\xff\xe0" + b"1" * 10)).json()["mime"] == "image/jpeg"
    assert upload(client, resp, person, fileName="x.png", dataBase64=b64(b"\x89PNG\r\n" + b"1")).json()["mime"] == "image/png"
    assert upload(client, resp, person, fileName="x.docx", dataBase64=b64(b"PK\x03\x04" + b"1")).status_code == 200
    assert upload(client, resp, person, fileName="x.xls", dataBase64=b64(b"\xd0\xcf\x11\xe0" + b"1")).status_code == 200


def test_document_validation(client, resp, person):
    assert upload(client, resp, person, dataBase64=b64(b"%PDF" + b"0" * (8 * 1024 * 1024))).status_code == 413
    assert upload(client, resp, person, dataBase64=b64(b"%PDF" + b"0" * (8 * 1024 * 1024 - 4))).status_code == 200  # ровно 8 МБ
    for name in ("virus.exe", "noext", "a.pdf.html", "a.", ".pdf.svg", ""):
        assert upload(client, resp, person, fileName=name).status_code == 422, name
    # расширение не совпадает с содержимым
    assert upload(client, resp, person, fileName="a.png").status_code == 422
    assert upload(client, resp, person, fileName="a.pdf", dataBase64=b64(b"MZ\x90\x00" + b"1" * 10)).status_code == 422
    assert upload(client, resp, person, fileName="a.docx", dataBase64=b64(b"%PDF-1")).status_code == 422
    assert upload(client, resp, person, fileName="a.txt", dataBase64=b64(b"abc\x00def")).status_code == 422
    assert upload(client, resp, person, fileName="a.txt", dataBase64=b64(b"\xff\xfe\xfa")).status_code == 422
    # битый base64, пусто
    assert upload(client, resp, person, dataBase64="не base64!!").status_code == 422
    assert upload(client, resp, person, dataBase64="abc").status_code == 422
    assert upload(client, resp, person, dataBase64="").status_code == 422
    # категория и название
    assert upload(client, resp, person, category="secret").status_code == 422
    assert upload(client, resp, person, title="   ").status_code == 422
    assert upload(client, resp, person, title="я" * 121).status_code == 422
    assert upload(client, resp, person, title="я" * 120).status_code == 200
    assert client.post(f"{BASE}/people/{person}/documents", json={"category": "other"}, headers=resp).status_code == 422


def test_document_long_file_name_keeps_extension(client, resp, person):
    d = upload(client, resp, person, fileName="а" * 300 + ".pdf").json()
    assert len(d["fileName"]) == 120 and d["fileName"].endswith(".pdf")


def test_document_limit_50(client, db, resp, person):
    for i in range(50):
        assert upload(client, resp, person, title=f"d{i}").status_code == 200
    r = upload(client, resp, person)
    assert r.status_code == 409 and "50" in r.json()["detail"]
    other = add_person(db, "Борис", "Бета")
    assert upload(client, resp, other).status_code == 200  # лимит на человека, а не общий
    first = client.get(f"{BASE}/people/{person}/documents", headers=resp).json()[0]["id"]
    assert client.post(f"{BASE}/documents/{first}/delete", headers=resp).status_code == 200
    assert upload(client, resp, person).status_code == 200


def test_document_delete_cascades_file(client, db, resp, person):
    doc = upload(client, resp, person).json()["id"]
    q = text("SELECT count(*) FROM trendsetter_hub.hr_document_files WHERE document_id = :i")
    assert db.execute(q, {"i": doc}).scalar_one() == 1
    assert client.post(f"{BASE}/documents/{doc}/delete", headers=resp).json() == {"ok": True}
    db.rollback()
    assert db.execute(q, {"i": doc}).scalar_one() == 0
    assert client.get(f"{BASE}/documents/{doc}", headers=resp).status_code == 404
    assert client.post(f"{BASE}/documents/{doc}/delete", headers=resp).status_code == 404
    assert client.get(f"{BASE}/people/{person}/documents", headers=resp).json() == []


def test_deleting_person_removes_documents(client, db, resp, person):
    doc = upload(client, resp, person).json()["id"]
    db.execute(text("DELETE FROM trendsetter_hub.team_people WHERE id = :p"), {"p": person})
    db.commit()
    for t, col in (("hr_documents", "id"), ("hr_document_files", "document_id")):
        assert db.execute(text(f"SELECT count(*) FROM trendsetter_hub.{t} WHERE {col} = :i"), {"i": doc}).scalar_one() == 0


def test_document_unknown_person_or_doc_is_404(client, resp, person):
    assert client.get(f"{BASE}/people/999999/documents", headers=resp).status_code == 404
    assert upload(client, resp, 999999).status_code == 404
    assert client.get(f"{BASE}/documents/999999", headers=resp).status_code == 404
    assert client.post(f"{BASE}/documents/999999/delete", headers=resp).status_code == 404


def test_document_audit_has_no_personal_data(client, db, resp, person):
    doc = upload(client, resp, person, title="Паспорт Иванова", fileName=SECRET_FILE_NAME, category="id_doc").json()["id"]
    client.get(f"{BASE}/documents/{doc}", headers=resp)
    client.post(f"{BASE}/documents/{doc}/delete", headers=resp)
    for action in ("hr.document_upload", "hr.document_download", "hr.document_delete"):
        rows = audit(db, action)
        assert rows == [{"document_id": doc, "person_id": person, "category": "id_doc"}], action
        dump = json.dumps(rows, ensure_ascii=False)
        assert "Иванов" not in dump and "pdf" not in dump.lower() and "Секретный" not in dump


def test_documents_not_leaked_to_other_endpoints(client, db, resp, hr, person):
    upload(client, resp, person, title="Уникальныйзаголовок", fileName="uniqfilename.pdf")
    urls = [f"{BASE}/people/{person}/file", f"{BASE}/people/{person}/sensitive", "/modules/team/map", "/modules/team/hr/people", f"{BASE}/me/file", f"{BASE}/me/leave"]
    for h in (resp, hr):
        for url in urls:
            body = client.get(url, headers=h).text
            assert "Уникальный" not in body and "uniqfilename" not in body, url
