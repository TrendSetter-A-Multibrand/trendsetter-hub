"""Обратная связь (docs/TZ-feedback.md): анонимность, шифрование, права, разбор, валидация, лимит, /people."""
import json
import logging
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.core.models import User, UserModulePermission
from app.core.security import hash_password
from app.modules.feedback import service
from tests.conftest import login, make_user

BASE = "/modules/feedback"
EMP_EMAIL = "anon-author@example.com"
EMP_NAME = "Анонимов Тест Уникальный"
SECRET = "Секретная фраза про начальника отдела"
NOTE = "Внутренний комментарий читателя"


@pytest.fixture()
def h(client, db):
    """Заголовки по ролям: admin, sup (superuser без права), emp, viewer, reader (responsible на feedback),
    hr (responsible только на hr), viewrun (личное run на feedback). Возвращает ещё users (id по ролям)."""
    users = {
        "admin": make_user(db, "admin@example.com", "admin", name="Админов Админ"),
        "sup": make_user(db, "sup@example.com", "superuser", name="Супер Юзер"),
        "emp": make_user(db, EMP_EMAIL, "employee", name=EMP_NAME),
        "viewer": make_user(db, "viewer@example.com", "viewer", name="Зритель Зрителев"),
        "reader": make_user(db, "reader@example.com", "employee", name="Читатель Читателев"),
        "hr": make_user(db, "hr@example.com", "employee", name="Эйчар Эйчаров"),
        "viewrun": make_user(db, "viewrun@example.com", "employee", name="Просмотров Запуск"),
    }
    db.add(UserModulePermission(user_id=users["reader"].id, module_id="feedback", permission="responsible"))
    db.add(UserModulePermission(user_id=users["hr"].id, module_id="hr", permission="responsible"))
    db.add(UserModulePermission(user_id=users["viewrun"].id, module_id="feedback", permission="run"))
    db.commit()
    result = {role: login(client, f"{u.email}") for role, u in users.items()}
    result["users"] = {role: u.id for role, u in users.items()}
    return result


def send(client, headers, **over):
    body = {"kind": "complaint", "body": SECRET, "anonymous": True, **over}
    return client.post(BASE + "/messages", json=body, headers=headers)


def listing(client, headers, status="new", **params):
    return client.get(BASE + "/messages", params={"status": status, **params}, headers=headers)


def rows(db):
    db.rollback()
    return db.execute(text("SELECT * FROM trendsetter_hub.feedback_messages ORDER BY id")).mappings().all()


def audit_count(db):
    db.rollback()
    return db.execute(text("SELECT count(*) FROM trendsetter_hub.audit_log")).scalar_one()


def notes(db):
    db.rollback()
    return db.execute(text("SELECT user_id, kind, title, body, link FROM trendsetter_hub.notifications WHERE kind = 'feedback.new'")).all()


# ---------- анонимность ----------


def test_anonymous_post_leaves_no_trace_of_author(client, h, db, caplog):
    before = audit_count(db)
    caplog.set_level(logging.DEBUG)
    r = send(client, h["emp"])
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert audit_count(db) == before
    (row,) = rows(db)
    assert row["author_id"] is None and row["is_anonymous"] is True and row["contact_ok"] is False and row["updated_by"] is None
    raw = db.execute(text("SELECT row_to_json(f)::text FROM trendsetter_hub.feedback_messages f")).scalar_one()
    assert EMP_EMAIL not in raw and EMP_NAME not in raw and SECRET not in raw
    audit_text = " ".join(db.execute(text("SELECT coalesce(details::text, '') FROM trendsetter_hub.audit_log")).scalars())
    assert EMP_EMAIL not in audit_text and EMP_NAME not in audit_text
    for record in caplog.records:
        message = record.getMessage()
        assert EMP_EMAIL not in message and EMP_NAME not in message and SECRET not in message


def test_anonymous_message_is_not_in_mine(client, h):
    send(client, h["emp"])
    r = client.get(BASE + "/mine", headers=h["emp"])
    assert r.status_code == 200 and r.json() == {"items": []}


def test_anonymous_notifications_go_to_all_readers_only(client, h, db):
    send(client, h["emp"])
    got = notes(db)
    users = h["users"]
    assert sorted(n[0] for n in got) == sorted([users["admin"], users["reader"]])
    for _, kind, title, body, link in got:
        assert kind == "feedback.new" and body == "" and link == "/modules/feedback"


def test_anonymous_reader_author_also_notified(client, h, db):
    send(client, h["reader"])
    got = notes(db)
    assert sorted(n[0] for n in got) == sorted([h["users"]["admin"], h["users"]["reader"]])
    (row,) = rows(db)
    assert row["author_id"] is None


def test_anonymous_with_contact_ok_is_422(client, h, db):
    assert send(client, h["emp"], contactOk=True).status_code == 422
    assert rows(db) == []


def test_anonymous_thanks_with_recipient_allowed(client, h, db):
    r = send(client, h["emp"], kind="thanks", recipientId=h["users"]["reader"])
    assert r.status_code == 200 and r.json() == {"ok": True}
    (row,) = rows(db)
    assert row["author_id"] is None and row["recipient_id"] == h["users"]["reader"]


# ---------- шифрование ----------


def test_body_and_note_are_encrypted_in_db(client, h, db):
    send(client, h["emp"])
    mid = rows(db)[0]["id"]
    r = client.patch(f"{BASE}/messages/{mid}", json={"note": NOTE}, headers=h["reader"])
    assert r.status_code == 200
    (row,) = rows(db)
    assert row["body"].startswith("enc:v1:") and SECRET not in row["body"]
    assert row["note"].startswith("enc:v1:") and NOTE not in row["note"]
    item = listing(client, h["reader"]).json()["items"][0]
    assert item["body"] == SECRET and item["note"] == NOTE


def test_plaintext_insert_rejected_by_check(db):
    with pytest.raises(IntegrityError):
        db.execute(text("INSERT INTO trendsetter_hub.feedback_messages (kind, body, is_anonymous) VALUES ('idea', 'открытый текст', true)"))
    db.rollback()
    with pytest.raises(IntegrityError):
        db.execute(text("INSERT INTO trendsetter_hub.feedback_messages (kind, body, is_anonymous, note) VALUES ('idea', 'enc:v1:x', true, 'открытый')"))
    db.rollback()


def test_no_key_is_503_and_nothing_written(client, h, db, monkeypatch):
    monkeypatch.delenv("HUB_PII_KEY")
    assert send(client, h["emp"]).status_code == 503
    assert send(client, h["emp"], anonymous=False).status_code == 503
    assert rows(db) == []
    assert notes(db) == []


# ---------- права ----------


def test_no_token_is_401(client):
    assert client.get(BASE + "/messages", params={"status": "new"}).status_code == 401
    assert client.post(BASE + "/messages", json={}).status_code == 401
    assert client.patch(BASE + "/messages/1", json={"status": "closed"}).status_code == 401
    assert client.get(BASE + "/mine").status_code == 401
    assert client.get(BASE + "/people").status_code == 401


def test_reader_routes_permissions(client, h):
    send(client, h["emp"])
    for role in ("emp", "sup", "hr", "viewrun", "viewer"):
        assert listing(client, h[role]).status_code == 403, role
        assert client.patch(f"{BASE}/messages/1", json={"status": "closed"}, headers=h[role]).status_code == 403, role
    for role in ("reader", "admin"):
        assert listing(client, h[role]).status_code == 200, role
        assert client.patch(f"{BASE}/messages/1", json={"status": "in_progress"}, headers=h[role]).status_code == 200, role


def test_viewer_cannot_send_or_read_own(client, h):
    assert send(client, h["viewer"]).status_code == 403
    assert client.get(BASE + "/people", headers=h["viewer"]).status_code == 403
    assert client.get(BASE + "/mine", headers=h["viewer"]).status_code == 403


def test_senders_for_all_levels(client, h):
    for role in ("emp", "sup", "admin", "reader", "hr", "viewrun"):
        assert send(client, h[role]).status_code == 200, role


def test_group_responsible_makes_reader(client, h, db):
    from app.core.models import AccessGroup, AccessGroupMember, AccessGroupPermission

    group = AccessGroup(name="Разбор")
    db.add(group)
    db.flush()
    db.add(AccessGroupPermission(group_id=group.id, module_id="feedback", permission="responsible"))
    db.add(AccessGroupMember(group_id=group.id, user_id=h["users"]["emp"]))
    db.commit()
    assert listing(client, h["emp"]).status_code == 200
    send(client, h["sup"])
    assert h["users"]["emp"] in [n[0] for n in notes(db)]


def test_onboarding_user_is_403(client, db):
    user = User(
        email="newbie@example.com", full_name="Новичок", password_hash=hash_password("Newbie-pass-123"), access_level=None, is_active=True,
        must_change_password=True, onboarding=True, onboarding_expires_at=datetime.now(UTC) + timedelta(days=7),
    )
    db.add(user)
    db.commit()
    headers = login(client, "newbie@example.com", "Newbie-pass-123")
    for r in (client.get(BASE + "/people", headers=headers), client.post(BASE + "/messages", json={"kind": "idea", "body": "x", "anonymous": True}, headers=headers)):
        assert r.status_code == 403 and r.json()["code"] == "onboarding_required"


def test_badge_only_for_readers(client, h):
    send(client, h["emp"])
    send(client, h["sup"], anonymous=False)
    for role in ("reader", "admin"):
        assert client.get("/core/me", headers=h[role]).json()["module_badges"].get("feedback") == 2, role
    for role in ("sup", "emp", "hr"):
        assert client.get("/core/me", headers=h[role]).json()["module_badges"].get("feedback") is None, role
    mid = listing(client, h["reader"]).json()["items"][0]["id"]
    client.patch(f"{BASE}/messages/{mid}", json={"status": "closed"}, headers=h["reader"])
    assert client.get("/core/me", headers=h["admin"]).json()["module_badges"].get("feedback") == 1


# ---------- разбор ----------


def test_patch_status_and_note(client, h, db):
    send(client, h["emp"])
    mid = rows(db)[0]["id"]
    r = client.patch(f"{BASE}/messages/{mid}", json={"status": "in_progress", "note": f"  {NOTE}  "}, headers=h["reader"])
    assert r.status_code == 200
    item = r.json()
    assert item["status"] == "in_progress" and item["note"] == NOTE and item["updatedByName"] == "Читатель Читателев"
    assert item["anonymous"] is True and item["authorName"] is None
    (row,) = rows(db)
    assert row["updated_by"] == h["users"]["reader"]
    # обратно в «Новое» и очистка комментария
    r = client.patch(f"{BASE}/messages/{mid}", json={"status": "new", "note": "   "}, headers=h["admin"])
    assert r.json()["status"] == "new" and r.json()["note"] is None
    assert rows(db)[0]["note"] is None
    r = client.patch(f"{BASE}/messages/{mid}", json={"note": NOTE}, headers=h["admin"])
    r = client.patch(f"{BASE}/messages/{mid}", json={"note": None}, headers=h["admin"])
    assert r.status_code == 200 and r.json()["note"] is None


def test_patch_validation(client, h):
    send(client, h["emp"])
    assert client.patch(f"{BASE}/messages/1", json={}, headers=h["reader"]).status_code == 422
    assert client.patch(f"{BASE}/messages/1", json={"status": "bad"}, headers=h["reader"]).status_code == 422
    assert client.patch(f"{BASE}/messages/1", json={"status": None}, headers=h["reader"]).status_code == 422
    assert client.patch(f"{BASE}/messages/1", json={"note": "я" * 2001}, headers=h["reader"]).status_code == 422
    assert client.patch(f"{BASE}/messages/1", json={"extra": 1}, headers=h["reader"]).status_code == 422
    assert client.patch(f"{BASE}/messages/999", json={"status": "closed"}, headers=h["reader"]).status_code == 404


def test_update_audit_has_no_text(client, h, db):
    send(client, h["emp"])
    client.patch(f"{BASE}/messages/1", json={"status": "closed", "note": NOTE}, headers=h["reader"])
    client.patch(f"{BASE}/messages/1", json={"note": NOTE + "2"}, headers=h["reader"])
    db.rollback()
    log = db.execute(text("SELECT action, user_id, details FROM trendsetter_hub.audit_log WHERE module_id = 'feedback' ORDER BY id")).all()
    assert [(a, d) for a, _, d in log] == [
        ("feedback.update", {"id": 1, "status": "closed", "fields": ["note", "status"]}),
        ("feedback.update", {"id": 1, "fields": ["note"]}),
    ]
    assert NOTE not in json.dumps([d for _, _, d in log], ensure_ascii=False)


def test_list_filters_counts_and_paging(client, h):
    for i in range(3):
        send(client, h["emp"], kind="idea", body=f"идея {i}")
    send(client, h["emp"], kind="thanks", body="спасибо")
    client.patch(f"{BASE}/messages/1", json={"status": "closed"}, headers=h["reader"])
    r = listing(client, h["reader"]).json()
    assert r["total"] == 3 and r["counts"] == {"new": 3, "in_progress": 0, "closed": 1}
    assert [i["id"] for i in r["items"]] == [4, 3, 2]
    r = listing(client, h["reader"], kind="idea", limit=1, offset=1).json()
    assert r["total"] == 2 and [i["id"] for i in r["items"]] == [2] and r["counts"]["closed"] == 1
    assert listing(client, h["reader"], status="bad").status_code == 422
    assert client.get(BASE + "/messages", headers=h["reader"]).status_code == 422
    assert listing(client, h["reader"], kind="bad").status_code == 422
    assert listing(client, h["reader"], limit=101).status_code == 422


# ---------- валидация ----------


def test_validation(client, h, db):
    assert send(client, h["emp"], body="").status_code == 422
    assert send(client, h["emp"], body="   ").status_code == 422
    assert send(client, h["emp"], body="я" * 3001).status_code == 422
    assert send(client, h["emp"], body="я" * 3000).status_code == 200
    assert send(client, h["emp"], kind="bad").status_code == 422
    assert send(client, h["emp"], kind="idea", recipientId=h["users"]["reader"]).status_code == 422
    assert send(client, h["emp"], kind="thanks", recipientId=h["users"]["emp"], anonymous=False).status_code == 422
    assert send(client, h["emp"], kind="thanks", recipientId=9999).status_code == 422
    inactive = make_user(db, "off@example.com", "employee", active=False)
    assert send(client, h["emp"], kind="thanks", recipientId=inactive.id).status_code == 422
    assert send(client, h["emp"], extra=1).status_code == 422
    assert len(rows(db)) == 1


# ---------- именная отправка ----------


def test_named_message(client, h, db):
    recipient = h["users"]["reader"]
    r = send(client, h["emp"], kind="thanks", body="Спасибо за помощь с отчётом", anonymous=False, contactOk=True, recipientId=recipient)
    assert r.status_code == 200
    data = r.json()
    assert data["kind"] == "thanks" and data["body"] == "Спасибо за помощь с отчётом" and data["recipientName"] == "Читатель Читателев"
    assert data["contactOk"] is True and data["status"] == "new" and "note" not in data and "createdAt" in data
    (row,) = rows(db)
    assert row["author_id"] == h["users"]["emp"] and row["is_anonymous"] is False and row["updated_by"] is None
    log = db.execute(text("SELECT user_id, action, details FROM trendsetter_hub.audit_log WHERE module_id = 'feedback'")).all()
    assert [tuple(x) for x in log] == [(h["users"]["emp"], "feedback.create", {"id": row["id"], "kind": "thanks"})]
    mine = client.get(BASE + "/mine", headers=h["emp"]).json()["items"]
    assert [i["id"] for i in mine] == [row["id"]] and mine[0]["status"] == "new" and "note" not in mine[0]
    item = listing(client, h["reader"]).json()["items"][0]
    assert item["authorName"] == EMP_NAME and item["contactOk"] is True and item["anonymous"] is False
    assert client.get(BASE + "/mine", headers=h["reader"]).json() == {"items": []}
    # адресат ничего не получает (он — читатель, получает одно общее уведомление, как все читатели)
    assert sum(1 for n in notes(db) if n[0] == recipient) == 1


def test_deleted_author_is_marked(client, h, db):
    send(client, h["emp"], anonymous=False)
    db.execute(text("DELETE FROM trendsetter_hub.users WHERE id = :id"), {"id": h["users"]["emp"]})
    db.commit()
    assert listing(client, h["reader"]).json()["items"][0]["authorName"] == service.MSG_AUTHOR_DELETED


# ---------- лимит ----------


def test_daily_limit_and_window(client, h, monkeypatch):
    clock = {"now": 1000.0}
    monkeypatch.setattr(service, "_monotonic", lambda: clock["now"])
    for i in range(10):
        assert send(client, h["emp"], anonymous=bool(i % 2)).status_code == 200
    r = send(client, h["emp"])
    assert r.status_code == 429 and r.json()["detail"] == service.MSG_TOO_MANY
    assert send(client, h["sup"]).status_code == 200  # у другого пользователя свой лимит
    clock["now"] += service.WINDOW_SECONDS + 1
    assert send(client, h["emp"]).status_code == 200


def test_no_key_does_not_spend_limit(client, h, monkeypatch):
    key = __import__("os").environ["HUB_PII_KEY"]
    monkeypatch.delenv("HUB_PII_KEY")
    for _ in range(12):
        assert send(client, h["emp"]).status_code == 503
    monkeypatch.setenv("HUB_PII_KEY", key)
    for _ in range(10):
        assert send(client, h["emp"]).status_code == 200
    assert send(client, h["emp"]).status_code == 429


def test_limit_key_is_hmac_not_user_id(client, h):
    send(client, h["emp"])
    assert all(len(k) == 64 and not k.isdigit() for k in service._limits)
    assert str(h["users"]["emp"]) not in service._limits


# ---------- /people ----------


def test_people(client, h, db):
    make_user(db, "off@example.com", "employee", active=False, name="Отключённый Сотрудник")
    db.add(User(email="nb@example.com", full_name="Новичок Онбординг", password_hash="x", access_level=None, onboarding=True, must_change_password=True))
    db.commit()
    names = [p["fullName"] for p in client.get(BASE + "/people", headers=h["emp"]).json()]
    assert EMP_NAME not in names and "Отключённый Сотрудник" not in names and "Новичок Онбординг" not in names
    assert "Читатель Читателев" in names and names == sorted(names)
    ids = [p["id"] for p in client.get(BASE + "/people", headers=h["emp"]).json()]
    assert h["users"]["emp"] not in ids
