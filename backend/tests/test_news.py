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
    ("post", "/pinned-order", {"kind": "news", "ids": []}),
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


def test_color_validation_and_storage(client, h, db):
    assert make_news(client, h.admin)["color"] is None
    news = make_news(client, h.admin, color="blue")
    assert news["color"] == "blue"
    assert make_event(client, h.admin, color="pink")["color"] == "pink"
    assert db.execute(text("SELECT color FROM trendsetter_hub.news_items WHERE id = :i"), {"i": news["id"]}).scalar_one() == "blue"
    for bad in ("#A22325", "purple", "", 5):
        assert post(client, "/items", h.admin, {"kind": "news", "title": "Т", "color": bad}).status_code == 422
    url = f"{BASE}/items/{news['id']}"
    assert client.patch(url, json={"color": "#fff"}, headers=h.admin).status_code == 422
    r = client.patch(url, json={"color": "gray"}, headers=h.admin)
    assert r.status_code == 200 and r.json()["color"] == "gray"
    assert {i["color"] for i in feed(client, h.emp)["news"]} >= {"gray"}  # читатель получает поле
    r = client.patch(url, json={"color": None}, headers=h.admin)
    assert r.status_code == 200 and r.json()["color"] is None


def test_color_change_is_logged_by_field_name_only(client, h, db):
    news = make_news(client, h.admin)
    r = client.patch(f"{BASE}/items/{news['id']}", json={"color": "green"}, headers=h.admin)
    assert r.status_code == 200
    action, module_id, details = audit(db)[-1]
    assert (action, module_id) == ("news.update", "news") and details["fields"] == ["color"]
    assert "green" not in json.dumps(details)
    before = len(audit(db))
    client.patch(f"{BASE}/items/{news['id']}", json={"color": "green"}, headers=h.admin)
    assert len(audit(db)) == before


def test_db_rejects_unknown_color(db):
    from sqlalchemy.exc import IntegrityError

    with pytest.raises(IntegrityError):
        db.execute(text("INSERT INTO trendsetter_hub.news_items (kind, title, color) VALUES ('news', 'Т', 'purple')"))
    db.rollback()


@pytest.mark.parametrize("params", [{"tab": "x"}, {"tab": "current", "limit": 0}, {"tab": "current", "limit": 101}, {"tab": "current", "offset": -1}])
def test_list_params_validation(client, h, params):
    assert client.get(BASE + "/items", params=params, headers=h.admin).status_code == 422


def test_list_kind_filter_splits_every_tab(client, h):
    cur_news, cur_event = make_news(client, h.admin), make_event(client, h.admin)
    arch_news = make_news(client, h.admin, title="Архив")
    client.patch(f"{BASE}/items/{arch_news['id']}", json={"archived": True}, headers=h.admin)
    draft_news, draft_event = make_news(client, h.admin, status="draft"), make_event(client, h.admin, status="draft")
    rev_news, rev_event = propose(client, h.emp), propose(client, h.emp, kind="event", startsAt=iso(48))
    rej_news, rej_event = propose(client, h.emp2), propose(client, h.emp2, kind="event", startsAt=iso(48))
    assert decide(client, h.editor, rej_news, "reject").status_code == 200
    assert decide(client, h.editor, rej_event, "reject").status_code == 200
    expected = {
        "current": ([cur_news["id"]], [cur_event["id"]]),
        "past": ([arch_news["id"], rej_news["id"]], [rej_event["id"]]),
        "drafts": ([draft_news["id"]], [draft_event["id"]]),
        "review": ([rev_news["id"]], [rev_event["id"]]),
    }
    for name, (news_ids, event_ids) in expected.items():
        news = tab(client, h.admin, name, kind="news")
        events = tab(client, h.admin, name, kind="event")
        assert sorted(ids(news["items"])) == sorted(news_ids) and news["total"] == len(news_ids), name
        assert sorted(ids(events["items"])) == sorted(event_ids) and events["total"] == len(event_ids), name
        assert {i["kind"] for i in news["items"]} <= {"news"} and {i["kind"] for i in events["items"]} <= {"event"}
        both = tab(client, h.admin, name)
        assert sorted(ids(both["items"])) == sorted(news_ids + event_ids) and both["total"] == len(news_ids + event_ids)
    # скобки в условии past: отклонённое событие не попадает в kind=news
    assert rej_event["id"] not in ids(tab(client, h.admin, "past", kind="news")["items"])
    assert tab(client, h.admin, "past", kind="news", limit=1)["total"] == 2


def test_list_kind_validation(client, h):
    assert client.get(BASE + "/items", params={"tab": "current", "kind": "x"}, headers=h.admin).status_code == 422


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
ALLOWED_KEYS = {"news_id", "banner_id", "kind", "status", "fields", "count"}


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


# ---------- предложка и модерация (PR 1, docs/TZ-news-moderation.md) ----------

PROPOSAL_ENDPOINTS = [
    ("get", "/proposals/mine", None),
    ("post", "/proposals", {"kind": "news", "title": "Т"}),
    ("patch", "/proposals/1", {"title": "Т"}),
]
REVIEW_ENDPOINTS = [
    ("get", "/items?tab=review", None),
    ("post", "/items/1/approve", {"expectedUpdatedAt": NOW.isoformat()}),
    ("post", "/items/1/return", {"comment": "К", "expectedUpdatedAt": NOW.isoformat()}),
    ("post", "/items/1/reject", {"comment": "К", "expectedUpdatedAt": NOW.isoformat()}),
]


def propose(client, headers, **over):
    r = post(client, "/proposals", headers, {"kind": "news", "title": "Предложение", **over})
    assert r.status_code == 200, r.text
    return r.json()


def decide(client, headers, item, action, comment="Комментарий", expected=None):
    body = {"expectedUpdatedAt": expected or item["updatedAt"]}
    if action != "approve":
        body["comment"] = comment
    return client.post(f"{BASE}/items/{item['id']}/{action}", json=body, headers=headers)


def mine(client, headers):
    return client.get(BASE + "/proposals/mine", headers=headers).json()["items"]


def notifications(db):
    db.rollback()
    return db.execute(text("SELECT user_id, kind, title, body, link FROM trendsetter_hub.notifications ORDER BY id")).all()


@pytest.mark.parametrize("method,path,body", PROPOSAL_ENDPOINTS + REVIEW_ENDPOINTS)
def test_proposals_no_token_is_401(client, method, path, body):
    assert call(client, method, path, None, body).status_code == 401


@pytest.mark.parametrize("method,path,body", PROPOSAL_ENDPOINTS + REVIEW_ENDPOINTS)
def test_proposals_viewer_is_403(client, h, method, path, body):
    assert call(client, method, path, h.viewer, body).status_code == 403


@pytest.mark.parametrize("method,path,body", REVIEW_ENDPOINTS)
@pytest.mark.parametrize("role", ["emp", "sup"])
def test_review_endpoints_forbidden_for_non_editor(client, h, role, method, path, body):
    assert call(client, method, path, getattr(h, role), body).status_code == 403


def test_proposal_endpoints_open_for_readers_and_editors(client, h):
    for role in ("emp", "editor", "admin"):
        assert client.get(BASE + "/proposals/mine", headers=getattr(h, role)).json() == {"items": []}
        assert propose(client, getattr(h, role))["status"] == "pending"
    for role in ("editor", "admin"):
        assert tab(client, getattr(h, role), "review")["total"] == 3


def test_proposal_is_created_pending(client, h):
    p = propose(client, h.emp, color="green", body="Текст")
    assert p["status"] == "pending" and p["pinned"] is False and p["color"] == "green" and p["publishedAt"] is None
    assert p["review"]["submittedAt"] == NOW.isoformat()
    assert p["review"]["author"]["name"] == "Борис Сотрудников"
    assert p["review"]["reviewComment"] is None and p["review"]["reviewedAt"] is None
    for extra in ({"pinned": True}, {"status": "published"}):
        assert post(client, "/proposals", h.emp, {"kind": "news", "title": "Т", **extra}).status_code == 422
    assert post(client, "/proposals", h.emp, {"kind": "event", "title": "Т"}).status_code == 422
    assert post(client, "/proposals", h.emp, {"kind": "news", "title": "Т", "place": "М"}).status_code == 422


def test_review_key_only_in_editor_lists_and_proposals(client, h):
    make_news(client, h.editor)
    p = propose(client, h.emp)
    current = tab(client, h.editor, "current")["items"]
    assert [i["review"] for i in current] == [None]
    assert tab(client, h.editor, "review")["items"][0]["review"]["author"]["name"] == "Борис Сотрудников"
    assert p["id"] not in ids(current)
    decide(client, h.editor, p, "approve")
    f = feed(client, h.emp)
    assert len(f["news"]) == 2 and all("review" not in i for i in f["news"] + f["events"])


def test_proposal_hidden_until_approved(client, h):
    p = propose(client, h.emp)
    assert feed(client, h.emp) == {"events": [], "news": []}
    for name in ("current", "past", "drafts"):
        assert tab(client, h.editor, name)["items"] == []
    assert ids(tab(client, h.editor, "review")["items"]) == [p["id"]]
    r = decide(client, h.editor, p, "approve")
    assert r.status_code == 200 and r.json()["status"] == "published" and r.json()["publishedAt"] == NOW.isoformat()
    assert ids(feed(client, h.emp)["news"]) == [p["id"]]
    assert tab(client, h.editor, "review")["items"] == []


def test_author_rules(client, h, clock):
    own = propose(client, h.emp)
    other = propose(client, h.emp2)
    editors_item = make_news(client, h.editor)
    assert ids(mine(client, h.emp)) == [own["id"]]
    for item_id in (other["id"], editors_item["id"], 9999):
        assert client.patch(f"{BASE}/proposals/{item_id}", json={"title": "Х"}, headers=h.emp).status_code == 404
    # pending -> pending, submittedAt прежний
    clock["now"] = NOW + timedelta(hours=1)
    r = client.patch(f"{BASE}/proposals/{own['id']}", json={"title": "Новое"}, headers=h.emp)
    assert r.status_code == 200 and r.json()["status"] == "pending" and r.json()["title"] == "Новое"
    assert r.json()["review"]["submittedAt"] == NOW.isoformat()
    # needs_changes -> pending, submittedAt новый, снова в очереди
    assert decide(client, h.editor, r.json(), "return", "Добавьте место").status_code == 200
    row = mine(client, h.emp)[0]
    assert row["status"] == "needs_changes" and row["review"]["reviewComment"] == "Добавьте место"
    clock["now"] = NOW + timedelta(hours=2)
    r = client.patch(f"{BASE}/proposals/{own['id']}", json={}, headers=h.emp)  # без изменений — всё равно переотправка
    assert r.json()["status"] == "pending" and r.json()["review"]["submittedAt"] == clock["now"].isoformat()
    assert r.json()["review"]["reviewComment"] == "Добавьте место"
    assert own["id"] in ids(tab(client, h.editor, "review")["items"])
    # rejected -> pending
    assert decide(client, h.editor, r.json(), "reject", "Не подходит").status_code == 200
    clock["now"] = NOW + timedelta(hours=3)
    r = client.patch(f"{BASE}/proposals/{own['id']}", json={"body": "Доработано"}, headers=h.emp)
    assert r.json()["status"] == "pending" and r.json()["review"]["submittedAt"] == clock["now"].isoformat()
    # published -> 409; pinned/status/archived/kind — 422
    done = decide(client, h.editor, r.json(), "approve").json()
    assert client.patch(f"{BASE}/proposals/{done['id']}", json={"title": "Х"}, headers=h.emp).status_code == 409
    for extra in ({"pinned": True}, {"status": "draft"}, {"archived": True}, {"kind": "event"}):
        assert client.patch(f"{BASE}/proposals/{other['id']}", json=extra, headers=h.emp2).status_code == 422


def test_pending_patch_without_changes_is_not_logged(client, h, db):
    p = propose(client, h.emp)
    before = len(audit(db))
    assert client.patch(f"{BASE}/proposals/{p['id']}", json={"title": p["title"]}, headers=h.emp).status_code == 200
    assert len(audit(db)) == before


def test_proposal_patch_validates_final_state(client, h):
    p = propose(client, h.emp, kind="event", startsAt=iso(48))
    assert client.patch(f"{BASE}/proposals/{p['id']}", json={"endsAt": iso(1)}, headers=h.emp).status_code == 422


def test_review_only_from_pending_and_stale_check(client, h):
    p = propose(client, h.emp)
    assert decide(client, h.editor, p, "approve", expected=iso(-1)).status_code == 409
    assert decide(client, h.editor, p, "return", "   ").status_code == 422
    assert decide(client, h.editor, p, "return", "").status_code == 422
    assert decide(client, h.editor, p, "reject", "я" * 1001).status_code == 422
    assert decide(client, h.editor, p, "reject", "я" * 1000).status_code == 200
    for action in ("approve", "return", "reject"):
        assert decide(client, h.editor, p, action).status_code == 409  # уже не pending
    assert decide(client, h.editor, {"id": 99999, "updatedAt": p["updatedAt"]}, "approve").status_code == 404
    assert ids(tab(client, h.editor, "past")["items"]) == [p["id"]]  # rejected — во вкладке past
    assert tab(client, h.editor, "past")["items"][0]["status"] == "rejected"
    assert tab(client, h.editor, "review")["items"] == []


def test_microsecond_updated_at_round_trip(client, h, clock):
    clock["now"] = NOW + timedelta(microseconds=123456)
    p = propose(client, h.emp)
    assert p["updatedAt"].endswith(".123456+00:00")
    clock["now"] = NOW + timedelta(hours=1, microseconds=654321)
    patched = client.patch(f"{BASE}/items/{p['id']}", json={"title": "Правка"}, headers=h.editor)  # «поправить и опубликовать»
    assert patched.status_code == 200 and patched.json()["status"] == "pending"
    assert patched.json()["updatedAt"].endswith(".654321+00:00")
    assert decide(client, h.editor, p, "approve").status_code == 409  # старый updatedAt устарел
    assert decide(client, h.editor, patched.json(), "approve").status_code == 200


def test_review_list_order(client, h, clock):
    a = propose(client, h.emp, title="A")
    clock["now"] = NOW + timedelta(hours=1)
    b = propose(client, h.emp2, title="B")
    clock["now"] = NOW + timedelta(hours=2)
    c = propose(client, h.emp2, title="C")
    decide(client, h.editor, a, "return", "Доработать")  # needs_changes — после pending
    assert ids(tab(client, h.editor, "review")["items"]) == [b["id"], c["id"], a["id"]]
    assert tab(client, h.editor, "review")["total"] == 3


def test_editor_patch_cannot_bypass_review(client, h):
    p = propose(client, h.emp)
    url = f"{BASE}/items/{p['id']}"
    assert client.patch(url, json={"status": "published"}, headers=h.editor).status_code == 409
    assert client.patch(url, json={"archived": True}, headers=h.admin).status_code == 409
    r = client.patch(url, json={"title": "Правка", "pinned": True, "color": "red"}, headers=h.editor)
    assert r.status_code == 200 and r.json()["status"] == "pending" and r.json()["pinned"] is True
    returned = decide(client, h.editor, r.json(), "return", "Доработайте").json()
    assert returned["status"] == "needs_changes"
    assert client.patch(url, json={"title": "Х"}, headers=h.editor).status_code == 409
    assert client.patch(url, json={"status": "draft"}, headers=h.editor).status_code == 409
    client.patch(f"{BASE}/proposals/{p['id']}", json={}, headers=h.emp)
    rejected = decide(client, h.editor, mine(client, h.emp)[0], "reject").json()
    assert rejected["status"] == "rejected"
    assert client.patch(url, json={"title": "Х"}, headers=h.admin).status_code == 409


def test_review_notifications(client, h, db):
    p = propose(client, h.emp, title="Субботник")
    decide(client, h.editor, p, "return", "Добавьте место")
    again = client.patch(f"{BASE}/proposals/{p['id']}", json={}, headers=h.emp).json()
    decide(client, h.editor, again, "reject", "Не подходит")
    again = client.patch(f"{BASE}/proposals/{p['id']}", json={}, headers=h.emp).json()
    decide(client, h.editor, again, "approve")
    rows = notifications(db)
    emp_id = db.execute(text("SELECT id FROM trendsetter_hub.users WHERE email = 'emp@example.com'")).scalar_one()
    link = "/profile?section=proposals"
    assert [(r[0], r[1], r[2], r[4]) for r in rows] == [
        (emp_id, "news_review", "Новость нужно доработать", link),
        (emp_id, "news_review", "Новость отклонена", link),
        (emp_id, "news_review", "Ваша новость опубликована", link),
    ]
    assert rows[0][3] == "«Субботник»: Добавьте место"
    assert rows[1][3] == "«Субботник». Причина: Не подходит. Можно доработать и отправить снова."
    assert rows[2][3] == "Субботник"
    own = propose(client, h.editor)  # редактор проверяет своё — себе не шлём
    decide(client, h.editor, own, "approve")
    gone = propose(client, h.emp2)
    db.execute(text("UPDATE trendsetter_hub.users SET is_active = false WHERE email = 'emp2@example.com'"))
    db.commit()
    decide(client, h.editor, gone, "approve")  # неактивный автор — не шлём
    assert len(notifications(db)) == 3


def test_proposal_limits(client, h, clock):
    first = [propose(client, h.emp, title=f"П{i}") for i in range(3)]
    r = post(client, "/proposals", h.emp, {"kind": "news", "title": "4"})
    assert r.status_code == 429 and "3" in r.json()["detail"]
    assert decide(client, h.editor, first[0], "approve").status_code == 200
    propose(client, h.emp, title="после approve")  # открытых снова 3, создано 4
    # повторная подача отклонённого считается в лимите открытых
    assert decide(client, h.editor, first[1], "reject").status_code == 200
    propose(client, h.emp, title="пятое")  # создано 5, открытых 3
    assert client.patch(f"{BASE}/proposals/{first[1]['id']}", json={}, headers=h.emp).status_code == 429
    # needs_changes -> pending лимит открытых не увеличивает
    target = next(i for i in mine(client, h.emp) if i["id"] == first[2]["id"])
    assert decide(client, h.editor, target, "return", "Доработать").status_code == 200
    assert client.patch(f"{BASE}/proposals/{first[2]['id']}", json={}, headers=h.emp).status_code == 200
    # суточный лимит: создано 5 за 24 ч
    for item in tab(client, h.editor, "review")["items"]:
        decide(client, h.editor, item, "approve")
    r = post(client, "/proposals", h.emp, {"kind": "news", "title": "шестое"})
    assert r.status_code == 429 and "5" in r.json()["detail"]
    clock["now"] = NOW + timedelta(hours=24, minutes=1)
    assert post(client, "/proposals", h.emp, {"kind": "news", "title": "шестое"}).status_code == 200


def test_module_badge_counts_pending_for_editors_only(client, h):
    assert client.get("/core/me", headers=h.editor).json()["module_badges"].get("news") is None
    propose(client, h.emp)
    second = propose(client, h.emp2)
    for role, expected in (("editor", 2), ("admin", 2), ("emp", None), ("sup", None)):
        assert client.get("/core/me", headers=getattr(h, role)).json()["module_badges"].get("news") == expected
    decide(client, h.editor, second, "return", "Доработать")
    assert client.get("/core/me", headers=h.editor).json()["module_badges"]["news"] == 1


def test_proposal_audit_actions_without_texts(client, h, db):
    p = propose(client, h.emp, title=SECRETS[0], body=SECRETS[1], place=SECRETS[2], kind="event", startsAt=iso(48))
    p = decide(client, h.editor, p, "return", SECRETS[3]).json()
    p = client.patch(f"{BASE}/proposals/{p['id']}", json={"title": SECRETS[0] + "2"}, headers=h.emp).json()
    p = decide(client, h.editor, p, "reject", SECRETS[3]).json()
    p = client.patch(f"{BASE}/proposals/{p['id']}", json={}, headers=h.emp).json()
    assert decide(client, h.editor, p, "approve").status_code == 200
    rows = audit(db)
    assert [a for a, _, _ in rows] == ["news.submit", "news.return", "news.resubmit", "news.reject", "news.resubmit", "news.approve"]
    assert rows[0][2] == {"news_id": p["id"], "kind": "event"}
    assert rows[2][2]["fields"] == ["title"] and rows[4][2]["fields"] == []
    for _, module_id, details in rows:
        assert module_id == "news" and set(details) <= ALLOWED_KEYS
        assert not any(secret in json.dumps(details, ensure_ascii=False) for secret in SECRETS)


# ---------- PR 2: порядок закреплённых ----------


def order(client, headers, kind, ids_):
    return post(client, "/pinned-order", headers, {"kind": kind, "ids": ids_})


def test_pinned_order_forbidden_for_employee_and_viewer(client, h):
    for role in ("emp", "viewer", "sup"):
        assert order(client, getattr(h, role), "news", []).status_code == 403


def test_pinned_order_sets_feed_and_current_order(client, h):
    n = [make_news(client, h.editor, title=f"Н{i}", pinned=True) for i in range(3)]
    plain = make_news(client, h.editor, title="Обычная")
    e = [make_event(client, h.editor, title=f"С{i}", pinned=True, startsAt=iso(48 + i)) for i in range(2)]
    new_news = [n[2]["id"], n[0]["id"], n[1]["id"]]
    assert order(client, h.editor, "news", new_news).status_code == 200
    assert order(client, h.editor, "event", [e[1]["id"], e[0]["id"]]).status_code == 200
    f = feed(client, h.emp)
    assert ids(f["news"]) == new_news + [plain["id"]]
    assert ids(f["events"]) == [e[1]["id"], e[0]["id"]]
    current = ids(tab(client, h.editor, "current")["items"])
    assert current == [e[1]["id"], e[0]["id"]] + new_news + [plain["id"]]


def test_pinned_order_requires_exact_set(client, h):
    a = make_news(client, h.editor, title="А", pinned=True)
    b = make_news(client, h.editor, title="Б", pinned=True)
    plain = make_news(client, h.editor, title="Обычная")
    event = make_event(client, h.editor, pinned=True)
    for bad in ([a["id"]], [a["id"], b["id"], plain["id"]], [a["id"], a["id"]], [a["id"], b["id"], event["id"]], []):
        r = order(client, h.editor, "news", bad)
        assert r.status_code == 409, bad
    assert order(client, h.editor, "event", [a["id"]]).status_code == 409
    assert order(client, h.editor, "news", [b["id"], a["id"]]).status_code == 200
    assert ids(feed(client, h.emp)["news"])[:2] == [b["id"], a["id"]]


def test_pinned_order_ignores_archived_and_unpublished(client, h):
    a = make_news(client, h.editor, title="А", pinned=True)
    b = make_news(client, h.editor, title="Б", pinned=True)
    draft = make_news(client, h.editor, title="Ч", pinned=True, status="draft")
    assert client.patch(f"{BASE}/items/{b['id']}", json={"archived": True}, headers=h.editor).status_code == 200
    assert order(client, h.editor, "news", [a["id"]]).status_code == 200
    assert order(client, h.editor, "news", [a["id"], draft["id"]]).status_code == 409


def test_pinned_change_resets_sort(client, h, db):
    a = make_news(client, h.editor, title="А", pinned=True)
    b = make_news(client, h.editor, title="Б", pinned=True)
    assert order(client, h.editor, "news", [b["id"], a["id"]]).status_code == 200

    def sort_of(item):
        return db.execute(text("SELECT sort FROM trendsetter_hub.news_items WHERE id = :i"), {"i": item["id"]}).scalar_one()

    db.rollback()
    assert (sort_of(b), sort_of(a)) == (0, 1)
    assert client.patch(f"{BASE}/items/{b['id']}", json={"pinned": False}, headers=h.editor).status_code == 200
    db.rollback()
    assert sort_of(b) is None and sort_of(a) == 1
    assert client.patch(f"{BASE}/items/{b['id']}", json={"pinned": True}, headers=h.editor).status_code == 200
    db.rollback()
    assert sort_of(b) is None
    assert ids(feed(client, h.emp)["news"])[0] == a["id"]  # со sort — раньше закреплённой без sort


def test_pinned_order_audit_without_texts(client, h, db):
    a = make_news(client, h.editor, title=SECRETS[0], pinned=True)
    b = make_news(client, h.editor, title=SECRETS[1], pinned=True)
    assert order(client, h.editor, "news", [b["id"], a["id"]]).status_code == 200
    rows = [r for r in audit(db) if r[0] == "news.reorder"]
    assert rows == [("news.reorder", "news", {"kind": "news", "count": 2})]
