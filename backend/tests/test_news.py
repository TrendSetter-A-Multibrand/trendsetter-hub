"""Новости компании: права, черновики, валидация, выборки и время, публикация, RSVP, видимость имён, плашка, журнал."""
import json
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from app.core.models import UserModulePermission
from app.modules.news import service
from tests.conftest import login, make_user

NOW = datetime(2026, 11, 1, 12, 0, tzinfo=timezone.utc)
BASE = "/modules/news"


@pytest.fixture(autouse=True)
def clock(monkeypatch):
    state = {"now": NOW}
    monkeypatch.setattr(service, "_now", lambda: state["now"])
    return state


def iso(hours=0.0, base=NOW):
    return (base + timedelta(hours=hours)).isoformat()


class Headers:
    """Заголовки по ролям; вход выполняется при первом обращении (bcrypt медленный, нужны не все роли)."""

    def __init__(self, client, users):
        self._client, self.users, self._cache = client, users, {}

    def __getattr__(self, role):
        if role.startswith("_") or role not in self.users:
            raise AttributeError(role)
        if role not in self._cache:
            self._cache[role] = login(self._client, f"{role}@example.com")
        return self._cache[role]


@pytest.fixture()
def h(client, db):
    """Роли: admin, sup (superuser), emp, emp2, viewer, editor (employee с «Ответственный» на news)."""
    users = {
        "admin": make_user(db, "admin@example.com", "admin", name="Админ"),
        "sup": make_user(db, "sup@example.com", "superuser", name="Руководитель"),
        "emp": make_user(db, "emp@example.com", "employee", name="Борис Сотрудников"),
        "emp2": make_user(db, "emp2@example.com", "employee", name="Анна Сотрудникова"),
        "viewer": make_user(db, "viewer@example.com", "viewer", name="Зритель"),
        "editor": make_user(db, "editor@example.com", "employee", name="Редактор"),
    }
    db.add(UserModulePermission(user_id=users["editor"].id, module_id="news", permission="responsible"))
    db.commit()
    return Headers(client, users)


def post(client, path, headers, body=None):
    return client.post(BASE + path, json=body or {}, headers=headers)


def make_event(client, headers, **over):
    payload = {"kind": "event", "title": "Событие", "startsAt": iso(48), "status": "published", **over}
    r = post(client, "/items", headers, payload)
    assert r.status_code == 200, r.text
    return r.json()


def make_news(client, headers, **over):
    payload = {"kind": "news", "title": "Новость", "status": "published", **over}
    r = post(client, "/items", headers, payload)
    assert r.status_code == 200, r.text
    return r.json()


def feed(client, headers):
    r = client.get(BASE + "/feed", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def tab(client, headers, name, **params):
    r = client.get(BASE + "/items", params={"tab": name, **params}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def ids(items):
    return [i["id"] for i in items]


def audit(db):
    rows = db.execute(text("SELECT action, module_id, details FROM trendsetter_hub.audit_log WHERE module_id = 'news' ORDER BY id")).all()
    return [(a, mod, d) for a, mod, d in rows]


# ---------- 1. права ----------

ENDPOINTS = [
    ("get", "/feed", None),
    ("get", "/banner", None),
    ("post", "/items/1/rsvp", {"answer": "yes"}),
    ("get", "/items/1/responses", None),
    ("get", "/items?tab=current", None),
    ("get", "/items?tab=past", None),
    ("get", "/items?tab=drafts", None),
    ("post", "/items", {"kind": "news", "title": "Т"}),
    ("patch", "/items/1", {"pinned": True}),
    ("post", "/items/1/delete", None),
    ("post", "/banner", {"text": "Т"}),
    ("post", "/banner/off", None),
]
EDITOR_ENDPOINTS = ENDPOINTS[4:]


def call(client, method, path, headers=None, body=None):
    return client.request(method.upper(), BASE + path, json=body, headers=headers or {})


@pytest.mark.parametrize("method,path,body", ENDPOINTS)
def test_no_token_is_401(client, method, path, body):
    assert call(client, method, path, None, body).status_code == 401


@pytest.mark.parametrize("method,path,body", ENDPOINTS)
def test_viewer_is_403_everywhere(client, h, method, path, body):
    assert call(client, method, path, h.viewer, body).status_code == 403


@pytest.mark.parametrize("method,path,body", EDITOR_ENDPOINTS)
@pytest.mark.parametrize("role", ["emp", "sup"])
def test_non_editor_is_403_on_editor_endpoints(client, h, role, method, path, body):
    assert call(client, method, path, getattr(h, role), body).status_code == 403


def test_readers_get_feed_banner_and_rsvp(client, h):
    event = make_event(client, h.admin, rsvpEnabled=True)
    for role in ("emp", "sup", "editor", "admin"):
        headers = getattr(h, role)
        assert client.get(BASE + "/feed", headers=headers).status_code == 200
        assert client.get(BASE + "/banner", headers=headers).status_code == 200
        assert post(client, f"/items/{event['id']}/rsvp", headers, {"answer": "yes"}).status_code == 200


def test_editor_and_admin_can_do_everything(client, h):
    for role in ("editor", "admin"):
        headers = getattr(h, role)
        item = make_news(client, headers)
        assert tab(client, headers, "current")["total"] >= 1
        assert client.patch(f"{BASE}/items/{item['id']}", json={"pinned": True}, headers=headers).status_code == 200
        assert post(client, "/banner", headers, {"text": f"Плашка {role}"}).status_code == 200
        assert post(client, "/banner/off", headers).status_code == 200
        assert post(client, f"/items/{item['id']}/delete", headers).json() == {"ok": True}


# ---------- 2. черновик ----------


def test_draft_is_hidden_from_everyone_but_drafts_tab(client, h):
    draft = make_event(client, h.admin, status="draft", rsvpEnabled=True)
    assert ids(feed(client, h.emp)["events"]) == []
    assert ids(feed(client, h.admin)["events"]) == []
    assert draft["id"] not in ids(tab(client, h.admin, "current")["items"])
    assert draft["id"] not in ids(tab(client, h.admin, "past")["items"])
    assert ids(tab(client, h.admin, "drafts")["items"]) == [draft["id"]]
    assert post(client, f"/items/{draft['id']}/rsvp", h.emp, {"answer": "yes"}).status_code == 404
    assert client.get(f"{BASE}/items/{draft['id']}/responses", headers=h.emp).status_code == 404
    assert client.get(f"{BASE}/items/{draft['id']}/responses", headers=h.admin).status_code == 200


# ---------- 3. валидация ----------


@pytest.mark.parametrize(
    "payload",
    [
        {"kind": "event", "title": "Т"},
        {"kind": "event", "title": "Т", "startsAt": iso(10), "endsAt": iso(5)},
        {"kind": "event", "title": "Т", "startsAt": iso(10), "rsvpDeadline": iso(11)},
        {"kind": "news", "title": "Т", "place": "Офис"},
        {"kind": "news", "title": "Т", "startsAt": iso(10)},
        {"kind": "news", "title": "Т", "rsvpEnabled": True},
        {"kind": "news", "title": "Т", "rsvpNamesPublic": True},
        {"kind": "event", "title": "Т", "startsAt": "2026-11-05T10:00:00"},
        {"kind": "news", "title": ""},
        {"kind": "news", "title": "   "},
        {"kind": "news", "title": "я" * 201},
        {"kind": "news", "title": "Т", "body": "я" * 5001},
        {"kind": "other", "title": "Т"},
    ],
)
def test_create_validation_is_422(client, h, payload):
    assert post(client, "/items", h.admin, payload).status_code == 422


def test_validation_messages_and_normalization(client, h):
    r = post(client, "/items", h.admin, {"kind": "event", "title": "Т"})
    assert r.json()["detail"] == service.MSG_START_REQUIRED
    r = post(client, "/items", h.admin, {"kind": "event", "title": "Т", "startsAt": iso(10), "endsAt": iso(5)})
    assert r.json()["detail"] == service.MSG_END_BEFORE_START
    r = post(client, "/items", h.admin, {"kind": "event", "title": "Т", "startsAt": iso(10), "rsvpDeadline": iso(11)})
    assert r.json()["detail"] == service.MSG_DEADLINE_AFTER_START
    ok = make_event(client, h.admin, title="  Название  ", place="   ", body="  текст ")
    assert (ok["title"], ok["place"], ok["body"]) == ("Название", None, "текст")
    assert make_news(client, h.admin, body="")["body"] == ""


def test_patch_validation(client, h):
    event = make_event(client, h.admin)
    url = f"{BASE}/items/{event['id']}"
    assert client.patch(url, json={"kind": "news"}, headers=h.admin).status_code == 422
    assert client.patch(url, json={"startsAt": None}, headers=h.admin).status_code == 422
    assert client.patch(url, json={"title": None}, headers=h.admin).status_code == 422
    assert client.patch(url, json={"endsAt": iso(1)}, headers=h.admin).status_code == 422  # раньше начала
    assert client.patch(f"{BASE}/items/99999", json={"pinned": True}, headers=h.admin).status_code == 404
    news = make_news(client, h.admin)
    assert client.patch(f"{BASE}/items/{news['id']}", json={"rsvpEnabled": True}, headers=h.admin).status_code == 422
    # null для необязательных полей допустим
    assert client.patch(url, json={"endsAt": iso(60)}, headers=h.admin).status_code == 200
    r = client.patch(url, json={"endsAt": None, "place": None}, headers=h.admin)
    assert r.status_code == 200 and r.json()["endsAt"] is None


@pytest.mark.parametrize("params", [{"tab": "x"}, {"tab": "current", "limit": 0}, {"tab": "current", "limit": 101}, {"tab": "current", "offset": -1}])
def test_list_params_validation(client, h, params):
    assert client.get(BASE + "/items", params=params, headers=h.admin).status_code == 422


def test_delete_missing_is_404(client, h):
    assert post(client, "/items/99999/delete", h.admin).status_code == 404


# ---------- 4. выборки и время ----------


def test_past_events_leave_feed_and_current(client, h):
    ended = make_event(client, h.admin, startsAt=iso(-30), endsAt=iso(-2))
    no_end = make_event(client, h.admin, startsAt=iso(-1))
    pinned_past = make_event(client, h.admin, startsAt=iso(-5), pinned=True)
    archived = make_event(client, h.admin, startsAt=iso(20))
    client.patch(f"{BASE}/items/{archived['id']}", json={"archived": True}, headers=h.admin)
    future = make_event(client, h.admin, startsAt=iso(5))
    gone = {ended["id"], no_end["id"], pinned_past["id"], archived["id"]}
    assert ids(feed(client, h.emp)["events"]) == [future["id"]]
    assert ids(tab(client, h.admin, "current")["items"]) == [future["id"]]
    assert set(ids(tab(client, h.admin, "past")["items"])) == gone


def test_event_boundary_moves_with_time(client, h, clock):
    event = make_event(client, h.admin, startsAt=iso(2), endsAt=iso(3))
    assert ids(feed(client, h.emp)["events"]) == [event["id"]]
    clock["now"] = NOW + timedelta(hours=3)  # ровно окончание: ещё не прошло
    assert ids(feed(client, h.emp)["events"]) == [event["id"]]
    clock["now"] = NOW + timedelta(hours=3, seconds=1)
    assert ids(feed(client, h.emp)["events"]) == []
    assert ids(tab(client, h.admin, "past")["items"]) == [event["id"]]


def test_archived_news_only_in_past(client, h):
    news = make_news(client, h.admin)
    client.patch(f"{BASE}/items/{news['id']}", json={"archived": True}, headers=h.admin)
    assert feed(client, h.emp)["news"] == []
    assert news["id"] not in ids(tab(client, h.admin, "current")["items"])
    assert ids(tab(client, h.admin, "past")["items"]) == [news["id"]]


def test_feed_order_and_limit(client, h, clock):
    old = make_news(client, h.admin, title="старая")
    clock["now"] = NOW + timedelta(hours=1)
    new = make_news(client, h.admin, title="новая")
    clock["now"] = NOW + timedelta(hours=2)
    pinned = make_news(client, h.admin, title="закреплённая", pinned=True)
    # закреплённые идут первыми, остальные — по дате публикации по убыванию
    assert ids(feed(client, h.emp)["news"]) == [pinned["id"], new["id"], old["id"]]
    e_late = make_event(client, h.admin, startsAt=iso(40))
    e_early = make_event(client, h.admin, startsAt=iso(10))
    e_pinned = make_event(client, h.admin, startsAt=iso(60), pinned=True)
    assert ids(feed(client, h.emp)["events"]) == [e_pinned["id"], e_early["id"], e_late["id"]]
    for _ in range(7):
        make_news(client, h.admin)
        make_event(client, h.admin)
    data = feed(client, h.emp)
    assert len(data["news"]) == 5 and len(data["events"]) == 5


def test_items_pagination(client, h):
    for _ in range(3):
        make_news(client, h.admin)
    page = tab(client, h.admin, "current", limit=2, offset=0)
    assert page["total"] == 3 and len(page["items"]) == 2
    assert len(tab(client, h.admin, "current", limit=2, offset=2)["items"]) == 1


# ---------- 5. публикация ----------


def test_publish_sets_published_at_once(client, h, clock):
    item = make_news(client, h.admin, status="draft")
    assert item["publishedAt"] is None
    url = f"{BASE}/items/{item['id']}"
    first = client.patch(url, json={"status": "published"}, headers=h.admin).json()
    assert first["publishedAt"] == NOW.isoformat()
    assert client.patch(url, json={"status": "draft"}, headers=h.admin).json()["status"] == "draft"
    clock["now"] = NOW + timedelta(days=1)
    again = client.patch(url, json={"status": "published"}, headers=h.admin).json()
    assert again["publishedAt"] == first["publishedAt"]


# ---------- 6. RSVP ----------


def rsvp(client, headers, item_id, answer):
    return post(client, f"/items/{item_id}/rsvp", headers, {"answer": answer})


def test_rsvp_upsert_and_counts(client, h):
    event = make_event(client, h.admin, rsvpEnabled=True, rsvpDeadline=iso(24))
    r = rsvp(client, h.emp, event["id"], "yes").json()
    assert r["rsvp"] == {"open": True, "counts": {"yes": 1, "maybe": 0, "no": 0}, "myAnswer": "yes", "canSeeNames": False}
    r = rsvp(client, h.emp, event["id"], "no").json()
    assert r["rsvp"]["counts"] == {"yes": 0, "maybe": 0, "no": 1} and r["rsvp"]["myAnswer"] == "no"
    r = rsvp(client, h.emp2, event["id"], "maybe").json()
    assert r["rsvp"]["counts"] == {"yes": 0, "maybe": 1, "no": 1} and r["rsvp"]["myAnswer"] == "maybe"
    assert feed(client, h.emp)["events"][0]["rsvp"]["myAnswer"] == "no"
    assert rsvp(client, h.emp, event["id"], "perhaps").status_code == 422


def test_rsvp_closed_cases(client, h, clock):
    with_deadline = make_event(client, h.admin, rsvpEnabled=True, rsvpDeadline=iso(24))
    no_deadline = make_event(client, h.admin, rsvpEnabled=True, startsAt=iso(30))
    archived = make_event(client, h.admin, rsvpEnabled=True)
    client.patch(f"{BASE}/items/{archived['id']}", json={"archived": True}, headers=h.admin)
    news = make_news(client, h.admin)
    off = make_event(client, h.admin)
    assert rsvp(client, h.emp, archived["id"], "yes").json()["detail"] == service.MSG_RSVP_CLOSED
    assert rsvp(client, h.emp, news["id"], "yes").json()["detail"] == service.MSG_RSVP_OFF
    assert rsvp(client, h.emp, off["id"], "yes").json()["detail"] == service.MSG_RSVP_OFF
    assert rsvp(client, h.emp, 99999, "yes").status_code == 404
    clock["now"] = NOW + timedelta(hours=25)  # после срока ответа, до начала
    r = rsvp(client, h.emp, with_deadline["id"], "yes")
    assert r.status_code == 409 and r.json()["detail"] == service.MSG_RSVP_CLOSED
    assert rsvp(client, h.emp, no_deadline["id"], "yes").status_code == 200
    clock["now"] = NOW + timedelta(hours=31)  # после начала
    assert rsvp(client, h.emp, no_deadline["id"], "yes").status_code == 409
    closed = feed(client, h.emp)["events"]
    assert all(e["rsvp"]["open"] is False for e in closed if e["id"] == no_deadline["id"])


def test_rsvp_inactive_user_not_counted_and_sorted_names(client, h, db):
    event = make_event(client, h.admin, rsvpEnabled=True, rsvpNamesPublic=True)
    rsvp(client, h.emp, event["id"], "yes")
    rsvp(client, h.emp2, event["id"], "yes")
    ghost = make_user(db, "ghost@example.com", "employee", name="Ушедший")
    db.execute(
        text("INSERT INTO trendsetter_hub.news_rsvp (item_id, user_id, answer) VALUES (:i, :u, 'yes')"), {"i": event["id"], "u": ghost.id}
    )
    db.commit()
    assert tab(client, h.admin, "current")["items"][0]["rsvp"]["counts"]["yes"] == 3
    db.execute(text("UPDATE trendsetter_hub.users SET is_active = false WHERE id = :u"), {"u": ghost.id})
    db.commit()
    assert tab(client, h.admin, "current")["items"][0]["rsvp"]["counts"]["yes"] == 2
    names = [p["name"] for p in client.get(f"{BASE}/items/{event['id']}/responses", headers=h.admin).json()["yes"]]
    assert names == ["Анна Сотрудникова", "Борис Сотрудников"]


def test_rsvp_disable_keeps_answers(client, h):
    event = make_event(client, h.admin, rsvpEnabled=True)
    rsvp(client, h.emp, event["id"], "yes")
    url = f"{BASE}/items/{event['id']}"
    off = client.patch(url, json={"rsvpEnabled": False}, headers=h.admin).json()
    assert off["rsvp"] is None and off["rsvpEnabled"] is False
    assert feed(client, h.emp)["events"][0]["rsvp"] is None
    on = client.patch(url, json={"rsvpEnabled": True}, headers=h.admin).json()
    assert on["rsvp"]["counts"] == {"yes": 1, "maybe": 0, "no": 0}


def test_news_has_null_event_fields(client, h):
    news = make_news(client, h.admin)
    for key in ("place", "startsAt", "endsAt", "rsvpDeadline", "rsvp"):
        assert news[key] is None
    assert news["rsvpEnabled"] is False and news["rsvpNamesPublic"] is False


# ---------- 7. видимость имён ----------


def test_names_visibility(client, h):
    event = make_event(client, h.admin, rsvpEnabled=True)
    rsvp(client, h.emp, event["id"], "yes")
    rsvp(client, h.emp2, event["id"], "no")
    url = f"{BASE}/items/{event['id']}/responses"
    assert client.get(url, headers=h.emp).status_code == 403
    item = feed(client, h.emp)["events"][0]
    assert item["rsvp"]["canSeeNames"] is False and item["rsvp"]["counts"] == {"yes": 1, "maybe": 0, "no": 1}
    assert feed(client, h.editor)["events"][0]["rsvp"]["canSeeNames"] is True
    full = client.get(url, headers=h.editor)
    assert full.status_code == 200 and [p["name"] for p in full.json()["yes"]] == ["Борис Сотрудников"]
    assert client.patch(f"{BASE}/items/{event['id']}", json={"rsvpNamesPublic": True}, headers=h.admin).status_code == 200
    r = client.get(url, headers=h.emp)
    assert r.status_code == 200
    assert [p["name"] for p in r.json()["yes"]] == ["Борис Сотрудников"] and [p["name"] for p in r.json()["no"]] == ["Анна Сотрудникова"]
    assert r.json()["maybe"] == []
    assert feed(client, h.emp)["events"][0]["rsvp"]["canSeeNames"] is True
    assert client.get(url, headers=h.viewer).status_code == 403


def test_public_names_stay_readable_after_event_is_over(client, h, clock):
    event = make_event(client, h.admin, rsvpEnabled=True, rsvpNamesPublic=True)
    rsvp(client, h.emp, event["id"], "yes")
    clock["now"] = NOW + timedelta(days=10)
    assert client.get(f"{BASE}/items/{event['id']}/responses", headers=h.emp2).status_code == 200


def test_names_public_change_is_logged(client, h, db):
    event = make_event(client, h.admin, rsvpEnabled=True)
    client.patch(f"{BASE}/items/{event['id']}", json={"rsvpNamesPublic": True}, headers=h.admin)
    action, module_id, details = audit(db)[-1]
    assert (action, module_id) == ("news.update", "news") and details["fields"] == ["rsvpNamesPublic"]


# ---------- 8. плашка ----------


def active_count(db):
    return db.execute(text("SELECT count(*) FROM trendsetter_hub.news_banners WHERE active")).scalar_one()


def test_banner_id_rules(client, h, db, clock):
    assert client.get(BASE + "/banner", headers=h.emp).json() == {"banner": None}
    first = post(client, "/banner", h.admin, {"text": "  Офис закрыт  "}).json()["banner"]
    assert first["text"] == "Офис закрыт" and first["endsAt"] is None
    assert client.get(BASE + "/banner", headers=h.emp).json()["banner"]["id"] == first["id"]
    same = post(client, "/banner", h.admin, {"text": "Офис закрыт", "endsAt": iso(5)}).json()["banner"]
    assert same["id"] == first["id"] and same["endsAt"] == iso(5)
    other = post(client, "/banner", h.admin, {"text": "Другое"}).json()["banner"]
    assert other["id"] != first["id"]
    assert active_count(db) == 1
    assert post(client, "/banner/off", h.admin).json() == {"banner": None}
    assert client.get(BASE + "/banner", headers=h.emp).json() == {"banner": None}
    assert active_count(db) == 0
    again = post(client, "/banner", h.admin, {"text": "Другое"}).json()["banner"]
    assert again["id"] not in (first["id"], other["id"])
    assert active_count(db) == 1
    # истёкшая — не отдаётся
    post(client, "/banner", h.admin, {"text": "Короткая", "endsAt": iso(1)})
    clock["now"] = NOW + timedelta(hours=2)
    assert client.get(BASE + "/banner", headers=h.emp).json() == {"banner": None}
    assert active_count(db) == 1
    post(client, "/banner/off", h.admin)
    assert active_count(db) == 0


def test_banner_validation(client, h):
    assert post(client, "/banner", h.admin, {"text": "Т", "endsAt": iso(-1)}).status_code == 422
    assert post(client, "/banner", h.admin, {"text": "   "}).status_code == 422
    assert post(client, "/banner", h.admin, {"text": "я" * 301}).status_code == 422
    assert post(client, "/banner", h.admin, {"text": "Т", "endsAt": "2030-01-01T10:00:00"}).status_code == 422


# ---------- 9. журнал ----------

SECRETS = ("СекретныйЗаголовок", "СекретныйТекст", "СекретноеМесто", "СекретнаяПлашка")
ALLOWED_KEYS = {"news_id", "banner_id", "kind", "status", "fields"}


def test_audit_actions_and_no_texts(client, h, db):
    event = make_event(
        client, h.editor, title=SECRETS[0], body=SECRETS[1], place=SECRETS[2], rsvpEnabled=True, status="draft"
    )
    url = f"{BASE}/items/{event['id']}"
    client.patch(url, json={"title": SECRETS[0] + "2", "pinned": True}, headers=h.editor)
    client.patch(url, json={"status": "published"}, headers=h.editor)
    rsvp(client, h.emp, event["id"], "yes")
    client.get(f"{url}/responses", headers=h.editor)
    client.patch(url, json={"archived": True}, headers=h.editor)
    client.patch(url, json={"archived": False}, headers=h.editor)
    client.patch(url, json={"status": "draft"}, headers=h.editor)
    news = make_news(client, h.editor, title=SECRETS[0])
    post(client, f"/items/{news['id']}/delete", h.editor)
    post(client, "/banner", h.editor, {"text": SECRETS[3]})
    post(client, "/banner", h.editor, {"text": SECRETS[3], "endsAt": iso(3)})
    post(client, "/banner/off", h.editor)
    post(client, "/banner/off", h.editor)  # активной нет — записи нет
    rows = audit(db)
    assert [a for a, _, _ in rows] == [
        "news.create",
        "news.update",
        "news.publish",
        "news.archive",
        "news.unarchive",
        "news.unpublish",
        "news.create",
        "news.delete",
        "news.banner_set",
        "news.banner_update",
        "news.banner_off",
    ]
    assert rows[1][2]["fields"] == ["pinned", "title"]
    assert rows[0][2] == {"news_id": event["id"], "kind": "event", "status": "draft"}
    assert rows[7][2] == {"news_id": news["id"], "kind": "news"}
    for _, module_id, details in rows:
        assert module_id == "news" and set(details) <= ALLOWED_KEYS
        dumped = json.dumps(details, ensure_ascii=False)
        assert not any(secret in dumped for secret in SECRETS)


def test_patch_without_changes_is_not_logged(client, h, db):
    news = make_news(client, h.admin, title="Т")
    before = len(audit(db))
    r = client.patch(f"{BASE}/items/{news['id']}", json={"title": "Т", "pinned": False, "status": "published"}, headers=h.admin)
    assert r.status_code == 200
    assert len(audit(db)) == before
