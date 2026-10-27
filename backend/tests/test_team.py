"""Модуль «Карта команды»: права, анкета и модерация, иерархия, конструктор полей, фото. Люди в тестах — вымышленные."""
import base64
import json
import os
from pathlib import Path

import psycopg
import pytest
from sqlalchemy import text

from tests.conftest import login, make_user
from tests.test_me import dept_id

BASE = "/modules/team"
JPEG = b"\xff\xd8\xff\xe0" + b"0" * 200


def url(raw: bytes = JPEG) -> str:
    return "data:image/jpeg;base64," + base64.b64encode(raw).decode()


PHOTO = {"full": url(), "thumb": url()}


@pytest.fixture()
def hr(client, db):
    make_user(db, "hr@example.com", "employee", [dept_id(db, "hr")], name="Эйч Арова")
    return login(client, "hr@example.com")


@pytest.fixture()
def emp(client, db):
    make_user(db, "emp@example.com", "employee", name="Иван Тестов")
    return login(client, "emp@example.com")


def add_person(db, first, last, manager=None, direction="ops", **kw) -> int:
    pid = db.execute(
        text(
            """INSERT INTO trendsetter_hub.team_people (first_name, last_name, title, manager_id, direction_id, is_ceo, show_in_map, is_archived, email, answers)
               VALUES (:f, :l, 'Должность', :m, :d, :ceo, :show, :arch, :email, CAST(:a AS jsonb)) RETURNING id"""
        ),
        {
            "f": first, "l": last, "m": manager, "d": direction, "ceo": kw.get("ceo", False), "show": kw.get("show", True),
            "arch": kw.get("archived", False), "email": kw.get("email"), "a": kw.get("answers", '{"telegram": "tg", "hobbies": ["чай"]}'),
        },
    ).scalar_one()
    db.commit()
    return pid


@pytest.fixture()
def tree(db):
    """CEO -> A -> B; CEO -> C."""
    ceo = add_person(db, "Главный", "Босс", None, "leadership", ceo=True)
    a = add_person(db, "Анна", "Альфа", ceo)
    b = add_person(db, "Борис", "Бета", a)
    c = add_person(db, "Вера", "Гамма", ceo, "mkt")
    return {"ceo": ceo, "a": a, "b": b, "c": c}


def values(**over) -> dict:
    v = {
        "first_name": "Иван", "last_name": "Тестов", "title": "Тестировщик", "manager_claim": "Альфа Анна", "responsibility": "Тесты",
        "ask_me_about": "Про тесты", "location": "Москва", "work_format": "Гибрид", "telegram": "@ivan_t", "hobbies": ["шахматы"], "gender": "Мужской",
    }
    return {**v, **over}


def submit(client, headers, vals=None, photo=PHOTO):
    return client.post(f"{BASE}/me/submission", json={"values": vals or values(), "photo": photo}, headers=headers)


# ---------- просмотр и права ----------


def test_structure_gets_trimmed_map_and_nothing_else(client, db, tree):
    make_user(db, "v@example.com", "viewer")
    h = login(client, "v@example.com")
    people = client.get(f"{BASE}/map", headers=h).json()["people"]
    assert len(people) == 4
    assert set(people[0]) == {"id", "name", "title", "managerId", "directionId", "isCeo", "isAssistant"}
    for path in ("/fields", f"/people/{tree['a']}/photo", "/me", "/hr/pending-count", "/hr/people"):
        assert client.get(BASE + path, headers=h).status_code == 403, path
    assert submit(client, h).status_code == 403


def test_view_sees_full_map_without_hidden_and_archived(client, db, tree, emp):
    add_person(db, "Скрыт", "Скрытов", tree["ceo"], show=False)
    add_person(db, "Архив", "Архивов", tree["ceo"], archived=True)
    data = client.get(f"{BASE}/map", headers=emp).json()
    names = [p["name"] for p in data["people"]]
    assert names == ["Босс Главный", "Альфа Анна", "Бета Борис", "Гамма Вера"]
    first = next(p for p in data["people"] if p["name"] == "Альфа Анна")
    assert first["telegram"] == "tg" and first["hobbies"] == ["чай"] and first["thumb"] is None
    assert {d["id"] for d in data["directions"]} == {"leadership", "ops", "mkt"}
    assert client.get(f"{BASE}/map").status_code == 401


def test_hr_endpoints_need_run_on_hr(client, db, emp, hr):
    for path in ("/hr/pending-count", "/hr/submissions", "/hr/people", "/hr/users", "/hr/fields"):
        assert client.get(BASE + path, headers=emp).status_code == 403, path
        assert client.get(BASE + path, headers=hr).status_code == 200, path
    make_user(db, "boss@example.com", "admin")
    assert client.get(f"{BASE}/hr/people", headers=login(client, "boss@example.com")).status_code == 200


def test_person_photo_only_for_visible(client, db, tree, emp, hr):
    hidden = add_person(db, "Скрыт", "Скрытов", tree["ceo"], show=False)
    for pid in (tree["a"], hidden):
        db.execute(text("INSERT INTO trendsetter_hub.team_photos (person_id, photo_full, photo_thumb) VALUES (:p, :f, :t)"), {"p": pid, "f": JPEG, "t": JPEG})
    db.commit()
    assert client.get(f"{BASE}/people/{tree['a']}/photo", headers=emp).json() == {"data": url()}
    assert client.get(f"{BASE}/people/{hidden}/photo", headers=emp).status_code == 404
    assert client.get(f"{BASE}/hr/people/{hidden}/photo", headers=hr).json() == {"data": url()}
    assert client.get(f"{BASE}/hr/people/{hidden}/photo", headers=emp).status_code == 403
    # в /map превью приходит data-URL
    thumb = next(p["thumb"] for p in client.get(f"{BASE}/map", headers=emp).json()["people"] if p["id"] == tree["a"])
    assert thumb == url()


# ---------- анкета и модерация ----------


def test_submission_validation(client, emp):
    assert submit(client, emp, photo=None).json()["detail"] == "Добавьте фото"
    for bad in ({"full": url(b"\x89PNG0000"), "thumb": url()}, {"full": "data:image/png;base64,AAAA", "thumb": url()}, {"full": "data:image/jpeg;base64,@@@", "thumb": url()}):
        assert submit(client, emp, photo=bad).status_code == 422
    big = b"\xff\xd8\xff" + b"0" * (300 * 1024)
    assert submit(client, emp, photo={"full": url(big), "thumb": url()}).status_code == 422
    assert submit(client, emp, photo={"full": url(), "thumb": url(b"\xff\xd8\xff" + b"0" * 31 * 1024)}).status_code == 422
    r = submit(client, emp, values(responsibility=""))
    assert r.status_code == 422 and "Зона ответственности" in r.json()["detail"]
    assert submit(client, emp, values(hobbies=["x"] * 21)).status_code == 422
    assert submit(client, emp, values(location="x" * 81)).status_code == 422
    assert submit(client, emp, values(socials=[{"label": "a", "url": "javascript:alert(1)"}])).status_code == 422
    assert submit(client, emp, values(socials=[{"label": "a", "url": "https://x.example"}] * 6)).status_code == 422
    assert submit(client, emp, values(email="не-почта")).status_code == 422
    assert client.post(f"{BASE}/me/submission", json={"values": values(), "photo": {"full": url()}}, headers=emp).status_code == 422


def test_gender_is_hr_only(client, db, tree, emp, hr):
    by_key = {f["key"]: f for f in client.get(f"{BASE}/hr/fields", headers=hr).json()}
    g = by_key["gender"]
    assert g["isSystem"] and g["required"] and g["kind"] == "select" and g["options"] == ["Мужской", "Женский"]
    assert client.patch(f"{BASE}/hr/fields/{g['id']}", json={"active": False}, headers=hr).status_code == 422
    assert client.patch(f"{BASE}/hr/fields/{g['id']}", json={"options": ["М", "Ж"]}, headers=hr).status_code == 422
    # обязательное при отправке; значение вне опций отклоняется
    no_gender = values()
    del no_gender["gender"]
    r = submit(client, emp, no_gender)
    assert r.status_code == 422 and "Пол" in r.json()["detail"]
    assert submit(client, emp, values(gender="Другое")).status_code == 422
    assert submit(client, emp, values(gender="Женский")).status_code == 200
    sub = client.get(f"{BASE}/hr/submissions", headers=hr).json()[0]
    pid = client.post(f"{BASE}/hr/submissions/{sub['id']}/approve", json={"directionId": "ops", "managerId": tree["b"]}, headers=hr).json()["id"]
    assert client.get(f"{BASE}/hr/people", headers=hr).json()[-1]["answers"]["gender"] == "Женский"
    # HR правит пол в карточке
    r = client.patch(f"{BASE}/hr/people/{pid}", json={"values": {"gender": "Мужской"}}, headers=hr)
    assert r.status_code == 200 and r.json()["answers"]["gender"] == "Мужской"
    # обычным пользователям пол нигде не отдаётся: ни в карте, ни в профиле, ни в extra
    for h in (emp, hr):
        mapped = client.get(f"{BASE}/map", headers=h).json()["people"]
        assert "gender" not in json.dumps(mapped) and "Мужской" not in json.dumps(mapped)
    mine = client.get(f"{BASE}/me", headers=emp).json()["person"]
    assert "gender" not in mine and mine["extra"] == [] and "Мужской" not in json.dumps(mine)


def test_submission_flow_new_person(client, db, tree, emp, hr):
    r = submit(client, emp, values(socials=[{"label": "Сайт", "url": "https://x.example"}]))
    assert r.status_code == 200 and r.json()["status"] == "pending"
    assert submit(client, emp).status_code == 409  # одна pending на пользователя
    # карта не изменилась, у HR бейдж +1, у сотрудника бейджа нет
    assert len(client.get(f"{BASE}/map", headers=emp).json()["people"]) == 4
    assert client.get("/core/me", headers=hr).json()["module_badges"] == {"hr": 1}
    assert client.get("/core/me", headers=emp).json()["module_badges"] == {}
    assert client.get(f"{BASE}/hr/pending-count", headers=hr).json() == {"count": 1}
    me = client.get(f"{BASE}/me", headers=emp).json()
    assert me["person"] is None and me["submission"]["status"] == "pending" and me["values"]["telegram"] == "ivan_t" and me["photo"] == url()
    sub = client.get(f"{BASE}/hr/submissions", headers=hr).json()[0]
    assert sub["userName"] == "Иван Тестов" and sub["hasPhoto"] and sub["thumb"] == url() and sub["current"] is None
    assert client.get(f"{BASE}/hr/submissions/{sub['id']}/photo", headers=hr).json() == {"data": url()}

    # без руководителя и направления одобрить нельзя
    assert client.post(f"{BASE}/hr/submissions/{sub['id']}/approve", json={}, headers=hr).status_code == 422
    assert client.post(f"{BASE}/hr/submissions/{sub['id']}/approve", json={"directionId": "ops"}, headers=hr).status_code == 422
    r = client.post(f"{BASE}/hr/submissions/{sub['id']}/approve", json={"directionId": "ops", "managerId": tree["b"], "tag": "СТМ"}, headers=hr)
    assert r.status_code == 200, r.text
    person = r.json()
    assert person["name"] == "Тестов Иван" and person["managerId"] == tree["b"] and person["tag"] == "СТМ" and person["hasPhoto"]
    assert person["telegram"] == "ivan_t" and person["socials"][0]["url"] == "https://x.example" and person["answers"]["manager_claim"] == "Альфа Анна"
    assert person["userEmail"] == "emp@example.com" and person["email"] is None
    assert client.post(f"{BASE}/hr/submissions/{sub['id']}/approve", json={}, headers=hr).status_code == 409
    assert "Тестов Иван" in [p["name"] for p in client.get(f"{BASE}/map", headers=emp).json()["people"]]
    assert client.get("/core/me", headers=hr).json()["module_badges"] == {}
    log = db.execute(text("SELECT details::text FROM trendsetter_hub.audit_log WHERE action IN ('team.submit', 'team.approve')")).scalars().all()
    assert len(log) == 2 and not any("ivan_t" in x or "Иван" in x for x in log)  # значения анкеты в журнал не попадают

    # повторная правка: снова заявка; manager_claim уже не обязателен; фото не обязательно (есть в карточке)
    v = values(responsibility="Новое")
    del v["manager_claim"]
    assert submit(client, emp, v, photo=None).status_code == 200
    mapped = next(p for p in client.get(f"{BASE}/map", headers=emp).json()["people"] if p["name"] == "Тестов Иван")
    assert mapped["responsibility"] == "Тесты"  # в карте старая версия
    sub2 = client.get(f"{BASE}/hr/submissions", headers=hr).json()[0]
    assert sub2["personId"] == person["id"] and sub2["current"]["responsibility"] == "Тесты"
    assert client.post(f"{BASE}/hr/submissions/{sub2['id']}/approve", json={}, headers=hr).status_code == 200
    assert client.get(f"{BASE}/hr/people", headers=hr).json()[-1]["answers"]["responsibility"] == "Новое"


def test_reject_cancel_and_replace(client, emp, hr):
    sid = submit(client, emp).json()["id"]
    r = client.patch(f"{BASE}/me/submission", json={"values": values(title="Ведущий тестировщик"), "photo": None}, headers=emp)
    assert r.status_code == 200 and r.json()["id"] == sid
    assert client.get(f"{BASE}/hr/submissions", headers=hr).json()[0]["values"]["title"] == "Ведущий тестировщик"
    assert client.post(f"{BASE}/hr/submissions/{sid}/reject", json={"comment": "  "}, headers=hr).status_code == 422
    assert client.post(f"{BASE}/hr/submissions/{sid}/reject", json={"comment": "x" * 501}, headers=hr).status_code == 422
    assert client.post(f"{BASE}/hr/submissions/{sid}/reject", json={"comment": "Нужно другое фото"}, headers=hr).json() == {"ok": True}
    assert client.post(f"{BASE}/hr/submissions/{sid}/reject", json={"comment": "ещё"}, headers=hr).status_code == 409
    sub = client.get(f"{BASE}/me", headers=emp).json()["submission"]
    assert sub["status"] == "rejected" and sub["reviewComment"] == "Нужно другое фото"
    assert client.get(f"{BASE}/hr/submissions?status=rejected", headers=hr).json()[0]["id"] == sid
    assert client.get(f"{BASE}/hr/submissions?status=all", headers=hr).status_code == 200
    # после отказа можно отправить заново; отзыв
    assert submit(client, emp).status_code == 200
    assert client.post(f"{BASE}/me/submission/cancel", headers=emp).json() == {"ok": True}
    assert client.post(f"{BASE}/me/submission/cancel", headers=emp).status_code == 404
    assert client.patch(f"{BASE}/me/submission", json={"values": values(), "photo": None}, headers=emp).status_code == 404


def test_email_match_links_seed_person_and_approve_with_person_id(client, db, tree, emp, hr):
    pid = add_person(db, "Иван", "Тестов", tree["a"], email="EMP@example.com", answers='{"hobbies": ["чай"], "extra": "старое"}')
    assert client.get(f"{BASE}/me", headers=emp).json()["person"]["id"] == pid
    submit(client, emp)
    assert db.execute(text("SELECT user_id IS NOT NULL FROM trendsetter_hub.team_people WHERE id = :p"), {"p": pid}).scalar()
    sub = client.get(f"{BASE}/hr/submissions", headers=hr).json()[0]
    assert sub["personId"] == pid
    r = client.post(f"{BASE}/hr/submissions/{sub['id']}/approve", json={"showInMap": False}, headers=hr).json()
    assert r["id"] == pid and r["showInMap"] is False and r["answers"]["extra"] == "старое"  # прежние ответы не теряются
    assert "Тестов Иван" not in [p["name"] for p in client.get(f"{BASE}/map", headers=emp).json()["people"]]


def test_approve_joins_existing_person(client, db, tree, emp, hr):
    pid = add_person(db, "Иван", "Тестов", tree["a"])  # карточка без user_id и без почты
    sid = submit(client, emp).json()["id"]
    r = client.post(f"{BASE}/hr/submissions/{sid}/approve", json={"personId": pid}, headers=hr)
    assert r.status_code == 200 and r.json()["id"] == pid and r.json()["userId"] is not None
    other = make_user_other(db, client)
    sid2 = submit(client, other).json()["id"]
    assert client.post(f"{BASE}/hr/submissions/{sid2}/approve", json={"personId": pid}, headers=hr).status_code == 409


def _owner(db, pid):
    return db.execute(text("SELECT user_id FROM trendsetter_hub.team_people WHERE id = :p"), {"p": pid}).scalar()


def test_name_match_any_order_and_yo(client, db, tree):
    make_user(db, "yo@example.com", "employee", name="Фёдор  Тёмный!")
    h = login(client, "yo@example.com")
    pid = add_person(db, "Федор", "Темный", tree["a"])  # без почты и user_id; «Фамилия Имя» против «Имя Фамилия»
    r = client.get(f"{BASE}/me", headers=h).json()
    assert r["person"]["id"] == pid and r["values"]["first_name"] == "Федор"
    assert _owner(db, pid) is None  # GET ничего не пишет
    assert submit(client, h, values(first_name="Федор", last_name="Темный")).status_code == 200
    assert _owner(db, pid) is not None  # привязка при первой отправке


def test_name_match_ambiguous_or_taken_or_archived_is_ignored(client, db, tree, emp):
    a = add_person(db, "Иван", "Тестов", tree["a"])
    add_person(db, "Тестов", "Иван", tree["a"])  # вторая с тем же набором слов
    assert client.get(f"{BASE}/me", headers=emp).json()["person"] is None
    db.execute(text("UPDATE trendsetter_hub.team_people SET is_archived = true WHERE id = :p"), {"p": a})
    db.commit()
    assert client.get(f"{BASE}/me", headers=emp).json()["person"] is not None  # осталась ровно одна свободная
    other = make_user_other(db, client)
    uid = db.execute(text("SELECT id FROM trendsetter_hub.users WHERE email = 'other@example.com'")).scalar()
    db.execute(text("UPDATE trendsetter_hub.team_people SET user_id = :u WHERE first_name = 'Тестов'"), {"u": uid})
    db.commit()
    assert client.get(f"{BASE}/me", headers=emp).json()["person"] is None  # карточка занята другим аккаунтом
    assert other  # токен другого пользователя получен


def test_new_person_is_prefilled_from_account(client, db, tree, emp):
    r = client.get(f"{BASE}/me", headers=emp).json()
    assert r["person"] is None
    assert r["values"] == {"email": "emp@example.com", "first_name": "Иван", "last_name": "Тестов"}
    make_user(db, "three@example.com", "employee", name="Анна Мария Ли")
    r = client.get(f"{BASE}/me", headers=login(client, "three@example.com")).json()
    assert r["values"] == {"email": "three@example.com"}


def make_user_other(db, client):
    make_user(db, "other@example.com", "employee")
    return login(client, "other@example.com")


# ---------- HR: люди, иерархия ----------


def test_hr_creates_updates_people(client, db, tree, hr):
    r = client.post(
        f"{BASE}/hr/people",
        json={"firstName": "Пётр", "lastName": "Новый", "title": "Аналитик", "directionId": "an", "managerId": tree["c"], "tag": "Аналитика", "values": {"telegram": "@pn", "hobbies": ["кофе"]}, "photo": PHOTO},
        headers=hr,
    )
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["telegram"] == "pn" and p["hasPhoto"] and p["thumb"] == url() and p["showInMap"] is True and p["isArchived"] is False
    assert client.post(f"{BASE}/hr/people", json={"firstName": "A", "lastName": "B", "title": "T", "directionId": "an"}, headers=hr).status_code == 422
    assert client.post(f"{BASE}/hr/people", json={"firstName": "A", "lastName": "B", "title": "T", "directionId": "nope", "managerId": tree["c"]}, headers=hr).status_code == 422
    assert client.post(f"{BASE}/hr/people", json={"firstName": "A", "lastName": "B", "title": "T", "directionId": "an", "managerId": 99999}, headers=hr).status_code == 422
    # почта уникальна без учёта регистра
    assert client.patch(f"{BASE}/hr/people/{p['id']}", json={"email": "Pn@example.com"}, headers=hr).status_code == 200
    assert client.patch(f"{BASE}/hr/people/{tree['a']}", json={"email": "pn@EXAMPLE.com"}, headers=hr).status_code == 409
    r = client.patch(f"{BASE}/hr/people/{p['id']}", json={"title": "Старший", "showInMap": False, "tag": "", "values": {"location": "Ереван"}}, headers=hr).json()
    assert r["title"] == "Старший" and r["showInMap"] is False and r["tag"] is None and r["location"] == "Ереван" and r["telegram"] == "pn"
    assert client.patch(f"{BASE}/hr/people/99999", json={"title": "x"}, headers=hr).status_code == 404
    # «Добавить в карту» из пользователя
    users = client.get(f"{BASE}/hr/users", headers=hr).json()
    me_user = next(u for u in users if u["email"] == "hr@example.com")
    assert me_user["personId"] is None
    r = client.post(f"{BASE}/hr/people", json={"firstName": "Эйч", "lastName": "Арова", "title": "HR", "directionId": "hr", "managerId": tree["ceo"], "userId": me_user["id"]}, headers=hr)
    assert r.status_code == 200 and r.json()["userId"] == me_user["id"]
    assert client.post(f"{BASE}/hr/people", json={"firstName": "Э", "lastName": "А", "title": "HR", "directionId": "hr", "managerId": tree["ceo"], "userId": me_user["id"]}, headers=hr).status_code == 409
    assert next(u for u in client.get(f"{BASE}/hr/users", headers=hr).json() if u["id"] == me_user["id"])["personId"] == r.json()["id"]


def test_cycle_is_forbidden(client, tree, hr):
    for pid, mgr in ((tree["a"], tree["a"]), (tree["a"], tree["b"]), (tree["ceo"], tree["b"])):
        r = client.patch(f"{BASE}/hr/people/{pid}", json={"managerId": mgr}, headers=hr)
        assert r.status_code == 422, (pid, mgr)
    assert client.patch(f"{BASE}/hr/people/{tree['b']}", json={"managerId": tree["c"]}, headers=hr).json()["managerId"] == tree["c"]
    assert client.patch(f"{BASE}/hr/people/{tree['b']}", json={"managerId": None}, headers=hr).status_code == 422


def test_archive_with_reports_needs_reassign(client, tree, hr, emp):
    r = client.patch(f"{BASE}/hr/people/{tree['a']}", json={"isArchived": True}, headers=hr)
    assert r.status_code == 409 and r.json()["detail"] == "Сначала переназначьте подчинённых"
    assert client.patch(f"{BASE}/hr/people/{tree['a']}", json={"isArchived": True, "reassignTo": tree["b"]}, headers=hr).status_code == 422  # подчинённый
    assert client.patch(f"{BASE}/hr/people/{tree['a']}", json={"isArchived": True, "reassignTo": tree["a"]}, headers=hr).status_code == 422
    r = client.patch(f"{BASE}/hr/people/{tree['a']}", json={"isArchived": True, "reassignTo": tree["c"]}, headers=hr)
    assert r.status_code == 200 and r.json()["isArchived"] is True
    people = {p["id"]: p for p in client.get(f"{BASE}/map", headers=emp).json()["people"]}
    assert tree["a"] not in people and people[tree["b"]]["managerId"] == tree["c"]
    # без подчинённых архивируется сразу и возвращается обратно
    assert client.patch(f"{BASE}/hr/people/{tree['b']}", json={"isArchived": True}, headers=hr).status_code == 200
    assert client.patch(f"{BASE}/hr/people/{tree['b']}", json={"isArchived": False}, headers=hr).json()["isArchived"] is False
    assert client.patch(f"{BASE}/hr/people/{tree['ceo']}", json={"isArchived": True, "reassignTo": tree["c"]}, headers=hr).status_code == 422
    assert tree["a"] in {p["id"] for p in client.get(f"{BASE}/hr/people", headers=hr).json()}


# ---------- конструктор полей ----------


def test_fields_constructor(client, hr, emp):
    fields = client.get(f"{BASE}/hr/fields", headers=hr).json()
    by_key = {f["key"]: f for f in fields}
    assert [f["key"] for f in fields][:3] == ["first_name", "last_name", "title"] and by_key["socials"]["isSystem"] is False
    assert client.get(f"{BASE}/fields", headers=emp).json() == fields
    # новое поле
    assert client.post(f"{BASE}/hr/fields", json={"key": "Bad Key", "label": "x", "kind": "text"}, headers=hr).status_code == 422
    assert client.post(f"{BASE}/hr/fields", json={"key": "pet", "label": "x", "kind": "photo"}, headers=hr).status_code == 422
    assert client.post(f"{BASE}/hr/fields", json={"key": "pet", "label": "x", "kind": "weird"}, headers=hr).status_code == 422
    r = client.post(f"{BASE}/hr/fields", json={"key": "pet", "label": "Питомец", "kind": "select", "required": True, "options": ["Кот", "Пёс"]}, headers=hr)
    assert r.status_code == 200 and r.json()["isSystem"] is False and r.json()["sort"] > by_key["photo"]["sort"]
    fid = r.json()["id"]
    assert client.post(f"{BASE}/hr/fields", json={"key": "pet", "label": "Ещё", "kind": "text"}, headers=hr).status_code == 409
    # новое обязательное поле подхватывается анкетой без деплоя
    assert submit(client, emp).json()["detail"] == "Заполните поле «Питомец»"
    assert submit(client, emp, values(pet="Хомяк")).status_code == 200  # свой вариант допустим
    # скрытие: системное нельзя, обычное можно; ключ и тип не меняются
    assert client.patch(f"{BASE}/hr/fields/{by_key['title']['id']}", json={"active": False}, headers=hr).status_code == 422
    assert client.patch(f"{BASE}/hr/fields/{by_key['title']['id']}", json={"key": "x"}, headers=hr).status_code == 422
    assert client.patch(f"{BASE}/hr/fields/{by_key['title']['id']}", json={"kind": "textarea"}, headers=hr).status_code == 422
    r = client.patch(f"{BASE}/hr/fields/{by_key['title']['id']}", json={"label": "Позиция", "hint": "подсказка", "required": False}, headers=hr).json()
    assert r["label"] == "Позиция" and r["hint"] == "подсказка" and r["required"] is False and r["key"] == "title"
    assert client.patch(f"{BASE}/hr/fields/{fid}", json={"active": False}, headers=hr).json()["active"] is False
    assert "pet" not in [f["key"] for f in client.get(f"{BASE}/fields", headers=emp).json()]
    assert "pet" in [f["key"] for f in client.get(f"{BASE}/hr/fields", headers=hr).json()]
    assert client.patch(f"{BASE}/hr/fields/99999", json={"label": "x"}, headers=hr).status_code == 404
    # порядок
    ids = [f["id"] for f in client.get(f"{BASE}/hr/fields", headers=hr).json()]
    r = client.patch(f"{BASE}/hr/fields/reorder", json={"ids": [ids[2], ids[0]]}, headers=hr)
    assert r.status_code == 200 and [f["id"] for f in r.json()][:3] == [ids[2], ids[0], ids[1]]
    assert client.patch(f"{BASE}/hr/fields/reorder", json={"ids": [ids[0], ids[0]]}, headers=hr).status_code == 422
    assert client.patch(f"{BASE}/hr/fields/reorder", json={"ids": [99999]}, headers=hr).status_code == 422
    assert client.patch(f"{BASE}/hr/fields/reorder", json={"ids": []}, headers=emp).status_code == 403


def test_hidden_field_keeps_answers(client, db, tree, emp, hr):
    soc = next(f for f in client.get(f"{BASE}/hr/fields", headers=hr).json() if f["key"] == "socials")
    sid = submit(client, emp, values(socials=[{"label": "Сайт", "url": "https://x.example"}])).json()["id"]
    client.post(f"{BASE}/hr/submissions/{sid}/approve", json={"directionId": "ops", "managerId": tree["a"]}, headers=hr)
    client.patch(f"{BASE}/hr/fields/{soc['id']}", json={"active": False}, headers=hr)
    sid = submit(client, emp, values(socials=[{"label": "Другое", "url": "https://y.example"}])).json()["id"]  # скрытое поле игнорируется
    r = client.post(f"{BASE}/hr/submissions/{sid}/approve", json={}, headers=hr).json()
    assert r["socials"][0]["label"] == "Сайт"


def test_alembic_downgrade_drops_only_team_tables(database):
    import subprocess
    import sys

    env = {**os.environ, "HUB_MIGRATION_DATABASE_URL": database["db_dsn"].replace("postgresql://", "postgresql+psycopg://", 1)}
    cwd = Path(__file__).resolve().parents[1]
    subprocess.run([sys.executable, "-m", "alembic", "downgrade", "0003"], cwd=cwd, env=env, check=True)
    try:
        with psycopg.connect(database["db_dsn"]) as conn:
            assert conn.execute("SELECT count(*) FROM pg_tables WHERE schemaname = 'trendsetter_hub' AND tablename LIKE 'team\\_%'").fetchone() == (0,)
            assert conn.execute("SELECT to_regclass('trendsetter_hub.users')").fetchone()[0] is not None
            assert conn.execute("SELECT to_regclass('trendsetter_hub.warehouse_receipts')").fetchone()[0] is not None
    finally:
        subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=cwd, env=env, check=True)


def test_extra_shows_active_custom_fields_only_to_viewers(client, db, tree, emp, hr):
    soc = next(f for f in client.get(f"{BASE}/hr/fields", headers=hr).json() if f["key"] == "socials")
    pet = client.post(f"{BASE}/hr/fields", json={"key": "pet", "label": "Питомец", "kind": "text"}, headers=hr).json()
    client.patch(f"{BASE}/hr/people/{tree['a']}", json={"values": {"pet": "Кот", "socials": [{"label": "Сайт", "url": "https://x.example"}]}}, headers=hr)
    find = lambda h: next(p for p in client.get(f"{BASE}/map", headers=h).json()["people"] if p["id"] == tree["a"])  # noqa: E731
    assert find(emp)["extra"] == [{"key": "pet", "label": "Питомец", "kind": "text", "value": "Кот"}]  # socials отдаётся в socials[]
    assert find(emp)["socials"][0]["url"] == "https://x.example"
    assert [p["extra"] for p in client.get(f"{BASE}/map", headers=emp).json()["people"] if p["id"] == tree["b"]] == [[]]  # пустые пропускаются
    hr_p = next(p for p in client.get(f"{BASE}/hr/people", headers=hr).json() if p["id"] == tree["a"])
    assert [e["key"] for e in hr_p["extra"]] == ["pet"]
    client.patch(f"{BASE}/hr/fields/{pet['id']}", json={"active": False}, headers=hr)  # скрытое поле не отдаётся
    assert find(emp)["extra"] == []
    make_user(db, "v@example.com", "viewer")
    viewer = next(p for p in client.get(f"{BASE}/map", headers=login(client, "v@example.com")).json()["people"] if p["id"] == tree["a"])
    assert "extra" not in viewer and "pet" not in str(viewer)


def test_hr_directions(client, tree, emp, hr):
    r = client.get(f"{BASE}/hr/directions", headers=hr).json()
    assert len(r) == 11 and r[0]["id"] == "leadership" and set(r[0]) == {"id", "label", "shortName", "color", "avatarInk"}
    assert "spec" in [d["id"] for d in r]  # пустое направление
    assert client.get(f"{BASE}/hr/directions", headers=emp).status_code == 403


def test_names_in_hr_person_and_own(client, db, tree, emp, hr):
    p = next(x for x in client.get(f"{BASE}/hr/people", headers=hr).json() if x["id"] == tree["a"])
    assert p["firstName"] == "Анна" and p["lastName"] == "Альфа"
    sid = submit(client, emp).json()["id"]
    client.post(f"{BASE}/hr/submissions/{sid}/approve", json={"directionId": "ops", "managerId": tree["a"]}, headers=hr)
    own = client.get(f"{BASE}/me", headers=emp).json()["person"]
    assert own["firstName"] == "Иван" and own["lastName"] == "Тестов"


def test_rejected_submission_prefills_and_keeps_photo(client, db, emp, hr):
    sid = submit(client, emp, values(responsibility="Черновик")).json()["id"]
    client.post(f"{BASE}/hr/submissions/{sid}/reject", json={"comment": "Уточните"}, headers=hr)
    me = client.get(f"{BASE}/me", headers=emp).json()  # карточки нет, но значения и фото берутся из отклонённой заявки
    assert me["person"] is None and me["values"]["responsibility"] == "Черновик" and me["photo"] == url()
    r = submit(client, emp, values(responsibility="Исправлено"), photo=None)  # фото повторно не нужно
    assert r.status_code == 200, r.text
    assert client.get(f"{BASE}/hr/submissions/{r.json()['id']}/photo", headers=hr).json() == {"data": url()}
    # после новой pending значения берутся из неё
    assert client.get(f"{BASE}/me", headers=emp).json()["values"]["responsibility"] == "Исправлено"
    # без отклонённой заявки фото по-прежнему обязательно
    make_user(db, "n@example.com", "employee")
    assert submit(client, login(client, "n@example.com"), photo=None).json()["detail"] == "Добавьте фото"
