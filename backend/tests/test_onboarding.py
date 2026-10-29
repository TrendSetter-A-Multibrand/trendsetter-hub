"""Онбординг нового сотрудника (docs/TZ-onboarding.md, PR 1): самосоздание по общему паролю, лимиты, блокировка, анкета, одобрение HR.
Почты и люди вымышленные."""
import re
from datetime import UTC, datetime, timedelta

import psycopg
import pytest
from fastapi.routing import APIRoute
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.core import messages as m
from app.core import routes_auth
from app.core.models import User
from app.core.security import hash_password
from tests.conftest import login, make_user
from tests.test_me import dept_id
from app.modules.team import service as team_service
from tests.test_team import BASE, PHOTO, add_person, values

SHARED = "Start-shared-2026"
OWN = "Own-password-2026"
DOMAIN = "@trendsettercrew.com"


def bearer(response) -> dict:
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['token']}"}


def post_login(client, email, password):
    return client.post("/auth/login", json={"email": email, "password": password})


@pytest.fixture()
def admin(client, db):
    make_user(db, "boss@example.com", "admin", name="Карен Админов")
    return login(client, "boss@example.com")


@pytest.fixture()
def shared(client, admin):
    """Общий стартовый пароль задан администратором."""
    r = client.post("/admin/onboarding/password", json={"password": SHARED}, headers=admin)
    assert r.status_code == 200, r.text
    return SHARED


@pytest.fixture()
def hr(client, db):
    make_user(db, "hr@example.com", "employee", [dept_id(db, "hr")], name="Эйч Арова")
    return login(client, "hr@example.com")


@pytest.fixture()
def tree(db):
    ceo = add_person(db, "Главный", "Босс", None, "leadership", ceo=True)
    return {"ceo": ceo, "mgr": add_person(db, "Анна", "Альфа", ceo)}


def add_newbie(db, email, *, own=OWN, must_change=True, onboarding=True, active=True, expires=None, level=None) -> int:
    user = User(
        email=email, full_name="Новичок", password_hash=hash_password(own), access_level=level, is_active=active,
        must_change_password=must_change, onboarding=onboarding,
        onboarding_expires_at=expires if expires is not None else datetime.now(UTC) + timedelta(days=7),
    )
    db.add(user)
    db.commit()
    return user.id


def register(client, email="ivan.test@trendsettercrew.com") -> dict:
    """Первый вход: самосоздание по общему паролю; возвращает заголовки шага «пароль»."""
    return bearer(post_login(client, email, SHARED))


def to_profile(client, headers) -> dict:
    """Шаг «пароль» пройден: смена пароля, новый токен для шага «анкета»."""
    r = client.post("/auth/change-password", json={"oldPassword": SHARED, "newPassword": OWN}, headers=headers)
    return bearer(r)


def newbie_at_profile(client, email="ivan.test@trendsettercrew.com") -> dict:
    return to_profile(client, register(client, email))


def user_row(db, email):
    db.rollback()
    return db.execute(text("SELECT * FROM trendsetter_hub.users WHERE lower(email) = :e"), {"e": email.lower()}).mappings().first()


def count_users(db, email) -> int:
    db.rollback()
    return db.execute(text("SELECT count(*) FROM trendsetter_hub.users WHERE lower(email) = :e"), {"e": email.lower()}).scalar_one()


def audit(db, action) -> list:
    db.rollback()
    return db.execute(text("SELECT user_id, details FROM trendsetter_hub.audit_log WHERE action = :a ORDER BY id"), {"a": action}).all()


def submit_profile(client, headers, **over):
    return client.post(f"{BASE}/me/submission", json={"values": values(**over), "photo": PHOTO}, headers=headers)


# ---------- регистрация и вход ----------


def test_disabled_by_default(client, db):
    """Общий пароль не задан: самосоздание и вход общим паролем выключены."""
    assert post_login(client, "ivan.test@trendsettercrew.com", SHARED).status_code == 401
    assert post_login(client, "ivan.test@trendsettercrew.com", "anything").status_code == 401
    assert count_users(db, "ivan.test@trendsettercrew.com") == 0
    assert db.execute(text("SELECT password_hash FROM trendsetter_hub.onboarding_settings")).scalar_one() is None


def test_self_register(client, db, admin, shared):
    r = post_login(client, "Ivan.Test@TrendsetterCrew.com", SHARED)
    assert r.status_code == 200 and r.json()["token"]
    u = user_row(db, "ivan.test@trendsettercrew.com")
    assert u["email"] == "ivan.test@trendsettercrew.com"  # нижний регистр
    assert u["access_level"] is None and u["onboarding"] and u["must_change_password"] and u["is_active"]
    left = (u["onboarding_expires_at"] - datetime.now(UTC)).total_seconds() / 86400
    assert 13.9 < left < 14.1
    assert db.execute(text("SELECT count(*) FROM trendsetter_hub.user_departments WHERE user_id = :u"), {"u": u["id"]}).scalar_one() == 0
    assert db.execute(text("SELECT count(*) FROM trendsetter_hub.access_group_members WHERE user_id = :u"), {"u": u["id"]}).scalar_one() == 0
    assert db.execute(text("SELECT count(*) FROM trendsetter_hub.user_module_permissions WHERE user_id = :u"), {"u": u["id"]}).scalar_one() == 0
    assert [row[0] for row in audit(db, "core.onboarding_self_register")] == [u["id"]]
    logins = [row for row in audit(db, "login") if row[0] == u["id"]]
    assert len(logins) == 1 and logins[0][1] == {"onboarding_password": True}
    # ни пароля, ни хэшей нет ни в одном details журнала
    for (details,) in db.execute(text("SELECT details::text FROM trendsetter_hub.audit_log")).all():
        assert SHARED not in details and "$2b$" not in details and "$2a$" not in details
    assert [row[0] for row in audit(db, "core.onboarding_password_set")] == [db.execute(text("SELECT id FROM trendsetter_hub.users WHERE email = 'boss@example.com'")).scalar_one()]
    info = client.get("/admin/onboarding", headers=admin).json()
    assert info["registeredToday"] == 1 and info["passwordSet"] is True and info["updatedBy"] == "Карен Админов"


@pytest.mark.parametrize(
    "email",
    [
        "ivan@example.com",
        "ivan@x.trendsettercrew.com",
        "ivan@trendsettercrew.com.evil.com",
        "a+b@trendsettercrew.com",
        "иван@trendsettercrew.com",
        "a" * 65 + "@trendsettercrew.com",
        "not-an-email",
        "abc\n@trendsettercrew.com",
        "Kevin@trendsettercrew.com",  # знак Кельвина: после lower() стал бы ASCII «k»
        "a@b@trendsettercrew.com",
    ],
)
def test_self_register_refusals_are_plain_401(client, db, shared, email):
    r = post_login(client, email, SHARED)
    assert r.status_code == 401 and r.json()["detail"] == m.BAD_CREDENTIALS
    db.rollback()
    assert db.execute(text("SELECT count(*) FROM trendsetter_hub.users WHERE access_level IS NULL")).scalar_one() == 0


def test_self_register_wrong_password_is_plain_401(client, db, shared):
    r = post_login(client, "ivan.test@trendsettercrew.com", SHARED + "x")
    assert r.status_code == 401 and r.json()["detail"] == m.BAD_CREDENTIALS
    assert count_users(db, "ivan.test@trendsettercrew.com") == 0


def test_local_part_boundary_64_is_allowed(client, db, shared):
    assert post_login(client, "a" * 64 + DOMAIN, SHARED).status_code == 200


def test_shared_password_does_not_work_for_existing_accounts(client, db, shared):
    make_user(db, "emp@trendsettercrew.com", "employee", password=OWN)
    assert post_login(client, "emp@trendsettercrew.com", SHARED).status_code == 401  # обычный пользователь
    assert post_login(client, "emp@trendsettercrew.com", OWN).status_code == 200
    add_newbie(db, "off@trendsettercrew.com", active=False)
    assert post_login(client, "off@trendsettercrew.com", SHARED).status_code == 401  # отключённый новичок
    add_newbie(db, "done@trendsettercrew.com", must_change=False)  # уже сменил пароль
    assert post_login(client, "done@trendsettercrew.com", SHARED).status_code == 401
    assert post_login(client, "done@trendsettercrew.com", OWN).status_code == 200
    add_newbie(db, "old@trendsettercrew.com", expires=datetime.now(UTC) - timedelta(minutes=1))  # срок истёк
    assert post_login(client, "old@trendsettercrew.com", SHARED).status_code == 401
    # для сравнения: рабочий новичок до смены пароля входит общим паролем
    add_newbie(db, "fresh@trendsettercrew.com")
    assert post_login(client, "fresh@trendsettercrew.com", SHARED).status_code == 200


def test_repeat_login_with_shared_before_password_change(client, db, shared):
    register(client)
    assert post_login(client, "ivan.test@trendsettercrew.com", SHARED).status_code == 200
    assert count_users(db, "ivan.test@trendsettercrew.com") == 1


def test_login_limit_per_email(client, db, shared):
    make_user(db, "emp@trendsettercrew.com", "employee", password=OWN)
    for _ in range(5):
        assert post_login(client, "emp@trendsettercrew.com", "wrong").status_code == 401
    r = post_login(client, "emp@trendsettercrew.com", OWN)  # верный пароль уже не помогает
    assert r.status_code == 429 and r.json()["detail"] == m.TOO_MANY_ATTEMPTS
    other = make_user(db, "other@trendsettercrew.com", "employee", password=OWN)
    assert post_login(client, "other@trendsettercrew.com", OWN).status_code == 200  # другая почта не затронута
    # несуществующая почта: тоже 429 после своих пяти неудач, даже с верным общим паролем
    for _ in range(5):
        assert post_login(client, "ghost@trendsettercrew.com", "wrong").status_code == 401
    assert post_login(client, "ghost@trendsettercrew.com", SHARED).status_code == 429
    assert count_users(db, "ghost@trendsettercrew.com") == 0
    assert other


def test_daily_self_register_limit(client, db, shared):
    db.execute(text("INSERT INTO trendsetter_hub.audit_log (user_id, action, details) SELECT NULL, 'core.onboarding_self_register', '{}' FROM generate_series(1, 20)"))
    db.commit()
    r = post_login(client, "ivan.test@trendsettercrew.com", SHARED)
    assert r.status_code == 429 and r.json()["detail"] == m.ONBOARDING_LIMIT
    assert count_users(db, "ivan.test@trendsettercrew.com") == 0
    # записи старше суток не считаются
    db.execute(text("UPDATE trendsetter_hub.audit_log SET at = now() - interval '25 hours' WHERE action = 'core.onboarding_self_register'"))
    db.commit()
    assert post_login(client, "ivan.test@trendsettercrew.com", SHARED).status_code == 200
    assert count_users(db, "ivan.test@trendsettercrew.com") == 1


def test_unknown_email_fuse_disables_self_register_silently(client, db, shared):
    for i in range(30):
        assert post_login(client, f"ghost{i}@example.com", "wrong").status_code == 401
    r = post_login(client, "ivan.test@trendsettercrew.com", SHARED)
    assert r.status_code == 401 and r.json()["detail"] == m.BAD_CREDENTIALS  # не 429: ответ не выдаёт предохранитель
    assert count_users(db, "ivan.test@trendsettercrew.com") == 0
    make_user(db, "emp@trendsettercrew.com", "employee", password=OWN)
    assert post_login(client, "emp@trendsettercrew.com", OWN).status_code == 200  # существующих предохранитель не трогает


def test_exactly_two_bcrypt_checks_on_every_login_path(client, db, shared, monkeypatch):
    calls: list[int] = []
    real = routes_auth.verify_password

    def counting(password, hashed):
        calls.append(1)
        return real(password, hashed)

    monkeypatch.setattr(routes_auth, "verify_password", counting)
    make_user(db, "emp@trendsettercrew.com", "employee", password=OWN)
    add_newbie(db, "fresh@trendsettercrew.com")
    add_newbie(db, "off@trendsettercrew.com", active=False)
    add_newbie(db, "old@trendsettercrew.com", expires=datetime.now(UTC) - timedelta(days=1))
    cases = [
        ("x@example.com", "anything"),  # неизвестная почта чужого домена
        ("new1@trendsettercrew.com", "wrong"),  # неизвестная почта домена, неверный общий пароль
        ("new2@trendsettercrew.com", SHARED),  # ... верный общий пароль (самосоздание)
        ("emp@trendsettercrew.com", OWN),
        ("emp@trendsettercrew.com", "wrong"),
        ("emp@trendsettercrew.com", SHARED),
        ("fresh@trendsettercrew.com", SHARED),  # новичок до смены пароля
        ("fresh@trendsettercrew.com", "wrong"),
        ("off@trendsettercrew.com", SHARED),  # отключённый
        ("old@trendsettercrew.com", SHARED),  # срок истёк
    ]
    for email, password in cases:
        calls.clear()
        post_login(client, email, password)
        assert len(calls) == 2, (email, password, len(calls))
    # общий пароль не задан: тоже ровно две
    db.execute(text("UPDATE trendsetter_hub.onboarding_settings SET password_hash = NULL"))
    db.commit()
    calls.clear()
    post_login(client, "new3@trendsettercrew.com", SHARED)
    assert len(calls) == 2
    # 429 отвечает до любой проверки bcrypt
    for _ in range(5):
        post_login(client, "ghost@trendsettercrew.com", "wrong")
    calls.clear()
    assert post_login(client, "ghost@trendsettercrew.com", "wrong").status_code == 429
    assert calls == []


def test_db_constraints(client, db, shared):
    uid = add_newbie(db, "a@trendsettercrew.com")
    with pytest.raises(IntegrityError) as exc:
        db.execute(text("UPDATE trendsetter_hub.users SET onboarding = false WHERE id = :u"), {"u": uid})
    assert isinstance(exc.value.orig, psycopg.errors.CheckViolation)
    db.rollback()
    uid2 = add_newbie(db, "b@trendsettercrew.com", level="viewer")
    with pytest.raises(IntegrityError) as exc:
        db.execute(text("UPDATE trendsetter_hub.users SET onboarding = false WHERE id = :u"), {"u": uid2})  # must_change_password остался
    assert isinstance(exc.value.orig, psycopg.errors.CheckViolation)
    db.rollback()


# ---------- шаги онбординга ----------


def test_core_me_of_newbie_has_no_rights(client, db, shared):
    h = register(client)
    me = client.get("/core/me", headers=h).json()
    assert me["must_change_password"] is True and me["onboarding"] is True and me["access_level"] is None
    assert set(me["module_access"].values()) == {"none"} and not any(me["module_responsible"].values())
    assert me["module_badges"] == {} and me["unread_notifications"] == 0 and me["can_manage_users"] is False and me["departments"] == []
    h2 = to_profile(client, h)
    me = client.get("/core/me", headers=h2).json()
    assert me["must_change_password"] is False and me["onboarding"] is True and set(me["module_access"].values()) == {"none"}


def test_password_step(client, db, shared):
    h = register(client)
    for path in ("/me", "/fields"):
        r = client.get(BASE + path, headers=h)
        assert r.status_code == 403 and r.json()["code"] == "onboarding_required", path
    assert submit_profile(client, h).json()["code"] == "onboarding_required"
    assert client.post("/auth/change-password", json={"oldPassword": "wrong-old-pass", "newPassword": OWN}, headers=h).status_code == 401
    assert client.post("/auth/change-password", json={"oldPassword": SHARED, "newPassword": SHARED}, headers=h).status_code == 422
    r = client.post("/auth/change-password", json={"oldPassword": SHARED, "newPassword": OWN}, headers=h)
    assert r.status_code == 200
    assert user_row(db, "ivan.test@trendsettercrew.com")["must_change_password"] is False
    assert client.get("/core/me", headers=h).status_code == 401  # старый токен закрыт
    assert client.get("/core/me", headers=bearer(r)).status_code == 200
    (details,) = [row[1] for row in audit(db, "core.password_change")]
    assert details["onboarding_password"] is True and OWN not in str(details) and SHARED not in str(details)
    assert post_login(client, "ivan.test@trendsettercrew.com", SHARED).status_code == 401  # общий пароль больше не работает
    assert post_login(client, "ivan.test@trendsettercrew.com", OWN).status_code == 200


def test_profile_step(client, db, shared):
    card = add_person(db, "Иван", "Тестов", None, "ops", email="ivan.test@trendsettercrew.com", answers='{"telegram": "secret_tg", "hobbies": ["секретное"]}')
    db.execute(text("INSERT INTO trendsetter_hub.team_photos (person_id, photo_full, photo_thumb) VALUES (:p, :f, :t)"), {"p": card, "f": b"\xff\xd8\xff1", "t": b"\xff\xd8\xff2"})
    db.commit()
    h = newbie_at_profile(client)
    me = client.get(f"{BASE}/me", headers=h)
    assert me.status_code == 200
    body = me.json()
    assert body["person"] is None and body["photo"] is None  # D5: чужая карточка и её фото не отдаются
    assert "secret_tg" not in me.text and "секретное" not in me.text
    assert body["values"]["email"] == "ivan.test@trendsettercrew.com"
    assert client.get(f"{BASE}/fields", headers=h).status_code == 200
    # D5: фото карточки не засчитывается — без своего фото отправить нельзя
    assert client.post(f"{BASE}/me/submission", json={"values": values(), "photo": None}, headers=h).status_code == 422
    # D6: почта в заявке — почта учётки, даже если прислана другая
    r = submit_profile(client, h, email="boss@example.com")
    assert r.status_code == 200, r.text
    db.rollback()
    sub = db.execute(text('SELECT "values", person_id FROM trendsetter_hub.team_submissions')).mappings().one()
    assert sub["values"]["email"] == "ivan.test@trendsettercrew.com" and sub["person_id"] == card  # для сравнения у HR
    assert db.execute(text("SELECT user_id FROM trendsetter_hub.team_people WHERE id = :p"), {"p": card}).scalar_one() is None  # не привязана до одобрения
    for path in (f"{BASE}/map", "/core/notifications", "/core/home/widgets"):
        r = client.get(path, headers=h)
        assert r.status_code == 403 and r.json()["code"] == "onboarding_required", path


WHITELIST_ANY = {("POST", "/auth/login"), ("POST", "/auth/logout"), ("GET", "/health"), ("GET", "/core/me"), ("POST", "/auth/change-password")}
WHITELIST_PROFILE = {
    ("GET", f"{BASE}/me"), ("GET", f"{BASE}/fields"), ("POST", f"{BASE}/me/submission"), ("PATCH", f"{BASE}/me/submission"),
    ("POST", f"{BASE}/me/submission/cancel"),
}


def flatten_routes(routes, prefix=""):
    """Все APIRoute приложения с полным путём. Включённые роутеры в этой версии FastAPI — _IncludedRouter (original_router + prefix)."""
    for route in routes:
        if isinstance(route, APIRoute):
            yield prefix + route.path, route
        elif hasattr(route, "original_router") and hasattr(route, "include_context"):
            yield from flatten_routes(route.original_router.routes, prefix + route.include_context.prefix)
        else:
            pytest.fail(f"неожиданный тип маршрута: {type(route).__name__}")  # новый вид маршрута требует решения


def test_every_route_is_closed_for_newbie(client, db, shared):
    """Главный тест безопасности: все маршруты вне явного белого списка отвечают 403 onboarding_required на обоих шагах."""
    from app.main import app

    h_password = register(client)
    h_profile = newbie_at_profile(client, "ivan.profile@trendsettercrew.com")
    checked = 0
    for full_path, route in flatten_routes(app.routes):
        path = re.sub(r"\{[^}]+\}", "1", full_path)
        for method in sorted(route.methods - {"HEAD", "OPTIONS"}):
            for step, headers in (("password", h_password), ("profile", h_profile)):
                if (method, path) in WHITELIST_ANY or (step == "profile" and (method, path) in WHITELIST_PROFILE):
                    continue
                r = client.request(method, path, json={}, headers=headers)
                assert r.status_code == 403 and r.json().get("code") == "onboarding_required", (step, method, path, r.status_code, r.text[:200])
                checked += 1
    assert checked > 100  # перебор действительно прошёл по маршрутам


# ---------- одобрение HR ----------


def pending_submission(db):
    db.rollback()
    return db.execute(text("SELECT id, status FROM trendsetter_hub.team_submissions ORDER BY id DESC LIMIT 1")).mappings().first()


def test_hr_approve_grants_access(client, db, shared, hr, tree):
    h = newbie_at_profile(client)
    assert submit_profile(client, h).status_code == 200
    sub = client.get(f"{BASE}/hr/submissions", headers=hr).json()[0]
    approve = f"{BASE}/hr/submissions/{sub['id']}/approve"
    org = {"directionId": "ops", "managerId": tree["mgr"]}
    cards_before = db.execute(text("SELECT count(*) FROM trendsetter_hub.team_people")).scalar_one()
    wh = dept_id(db, "warehouse")

    def untouched():
        db.rollback()
        u = user_row(db, "ivan.test@trendsettercrew.com")
        assert u["onboarding"] and u["access_level"] is None and u["must_change_password"] is False
        assert db.execute(text("SELECT count(*) FROM trendsetter_hub.team_people")).scalar_one() == cards_before
        assert db.execute(text("SELECT count(*) FROM trendsetter_hub.team_photos")).scalar_one() == 0
        assert pending_submission(db)["status"] == "pending"

    r = client.post(approve, json=org, headers=hr)  # нет уровня
    assert r.status_code == 422 and r.json()["detail"] == m.ONBOARDING_LEVEL_REQUIRED
    untouched()
    r = client.post(approve, json={**org, "accessLevel": "admin"}, headers=hr)  # admin выдаёт только администратор
    assert r.status_code == 422 and r.json()["detail"] == m.UNKNOWN_LEVEL
    untouched()
    for missing in (32000, 99999):  # в диапазоне smallint, но отдела нет / вне диапазона
        r = client.post(approve, json={**org, "accessLevel": "employee", "departmentIds": [missing]}, headers=hr)
        assert r.status_code == 422 and r.json()["detail"] == m.UNKNOWN_DEPARTMENT
        untouched()
    r = client.post(approve, json={**org, "accessLevel": "employee", "departmentIds": [wh]}, headers=hr)
    assert r.status_code == 200, r.text
    u = user_row(db, "ivan.test@trendsettercrew.com")
    assert u["onboarding"] is False and u["access_level"] == "employee" and u["full_name"] == "Иван Тестов"
    assert db.execute(text("SELECT department_id FROM trendsetter_hub.user_departments WHERE user_id = :u"), {"u": u["id"]}).scalars().all() == [wh]
    assert db.execute(text("SELECT user_id FROM trendsetter_hub.team_people WHERE id = :p"), {"p": r.json()["id"]}).scalar_one() == u["id"]
    me = client.get("/core/me", headers=h).json()  # токен тот же: версия не менялась
    assert me["onboarding"] is False and me["module_access"]["warehouse"] == "run" and me["full_name"] == "Иван Тестов"
    assert client.get(f"{BASE}/map", headers=h).status_code == 200
    (details,) = [row[1] for row in audit(db, "team.approve")]
    assert details["onboarding_done"] is True and details["access_level"] == "employee" and details["department_ids"] == [wh]


def test_hr_can_grant_superuser(client, db, shared, hr, tree):
    h = newbie_at_profile(client)
    submit_profile(client, h)
    sid = client.get(f"{BASE}/hr/submissions", headers=hr).json()[0]["id"]
    r = client.post(
        f"{BASE}/hr/submissions/{sid}/approve",
        json={"directionId": "ops", "managerId": tree["mgr"], "accessLevel": "superuser", "departmentIds": [dept_id(db, "hr")]},
        headers=hr,
    )
    assert r.status_code == 200, r.text
    assert user_row(db, "ivan.test@trendsettercrew.com")["access_level"] == "superuser"


def test_hr_approve_of_regular_user_ignores_access_fields(client, db, hr, tree):
    make_user(db, "emp@example.com", "employee", name="Иван Тестов")
    h = login(client, "emp@example.com")
    assert submit_profile(client, h).status_code == 200
    sid = client.get(f"{BASE}/hr/submissions", headers=hr).json()[0]["id"]
    body = {"directionId": "ops", "managerId": tree["mgr"], "accessLevel": "superuser", "departmentIds": [dept_id(db, "hr")]}
    assert client.post(f"{BASE}/hr/submissions/{sid}/approve", json=body, headers=hr).status_code == 200
    u = user_row(db, "emp@example.com")
    assert u["access_level"] == "employee"
    assert db.execute(text("SELECT count(*) FROM trendsetter_hub.user_departments WHERE user_id = :u"), {"u": u["id"]}).scalar_one() == 0


def test_approve_links_card_by_email_and_refuses_taken_card(client, db, shared, hr, tree):
    card = add_person(db, "Иван", "Тестов", tree["mgr"], email="ivan.test@trendsettercrew.com")
    h = newbie_at_profile(client)
    submit_profile(client, h)
    sub = client.get(f"{BASE}/hr/submissions", headers=hr).json()[0]
    assert sub["personId"] == card and sub["userOnboarding"] is True
    r = client.post(f"{BASE}/hr/submissions/{sub['id']}/approve", json={"accessLevel": "viewer"}, headers=hr)
    assert r.status_code == 200 and r.json()["id"] == card
    assert db.execute(text("SELECT user_id FROM trendsetter_hub.team_people WHERE id = :p"), {"p": card}).scalar_one() == user_row(db, "ivan.test@trendsettercrew.com")["id"]
    # вторая карточка успела достаться другой учётке: 409, онбординг не снят
    card2 = add_person(db, "Пётр", "Петров", tree["mgr"], email="petr.test@trendsettercrew.com")
    h2 = newbie_at_profile(client, "petr.test@trendsettercrew.com")
    submit_profile(client, h2, first_name="Пётр", last_name="Петров")
    other = make_user(db, "taken@example.com", "viewer")
    db.execute(text("UPDATE trendsetter_hub.team_people SET user_id = :u WHERE id = :p"), {"u": other.id, "p": card2})
    db.commit()
    sub2 = next(s for s in client.get(f"{BASE}/hr/submissions", headers=hr).json() if s["userEmail"] == "petr.test@trendsettercrew.com")
    r = client.post(f"{BASE}/hr/submissions/{sub2['id']}/approve", json={"accessLevel": "viewer"}, headers=hr)
    assert r.status_code == 409 and r.json()["detail"] == team_service.MSG_USER_LINKED  # не MSG_EMAIL_DUPLICATE из except IntegrityError
    u = user_row(db, "petr.test@trendsettercrew.com")
    assert u["onboarding"] is True and u["access_level"] is None
    assert db.execute(text("SELECT status FROM trendsetter_hub.team_submissions WHERE id = :i"), {"i": sub2["id"]}).scalar_one() == "pending"


def test_reject_keeps_onboarding_and_allows_resubmit(client, db, shared, hr):
    h = newbie_at_profile(client)
    submit_profile(client, h)
    sid = client.get(f"{BASE}/hr/submissions", headers=hr).json()[0]["id"]
    assert client.post(f"{BASE}/hr/submissions/{sid}/reject", json={"comment": "Нужно другое фото"}, headers=hr).status_code == 200
    assert user_row(db, "ivan.test@trendsettercrew.com")["onboarding"] is True
    me = client.get(f"{BASE}/me", headers=h).json()
    assert me["submission"]["status"] == "rejected" and me["submission"]["reviewComment"] == "Нужно другое фото"
    assert client.post(f"{BASE}/me/submission", json={"values": values(), "photo": None}, headers=h).status_code == 200  # фото осталось от прошлой заявки


# ---------- администратор ----------


def test_admin_extend(client, db, admin, shared):
    h = register(client)
    uid = user_row(db, "ivan.test@trendsettercrew.com")["id"]
    db.execute(text("UPDATE trendsetter_hub.users SET onboarding_expires_at = now() - interval '1 day' WHERE id = :u"), {"u": uid})
    db.commit()
    assert post_login(client, "ivan.test@trendsettercrew.com", SHARED).status_code == 401
    r = client.post(f"/admin/users/{uid}/onboarding/extend", headers=admin)
    assert r.status_code == 200 and r.json()["must_change_password"] is True
    assert post_login(client, "ivan.test@trendsettercrew.com", SHARED).status_code == 200
    assert [row[0] for row in audit(db, "user.onboarding_extend")] and h
    to_profile(client, bearer(post_login(client, "ivan.test@trendsettercrew.com", SHARED)))
    r = client.post(f"/admin/users/{uid}/onboarding/extend", headers=admin)
    assert r.status_code == 422 and r.json()["detail"] == m.ONBOARDING_EXTEND_NOT_ALLOWED


def test_admin_finish(client, db, admin, shared):
    h = register(client)
    uid = user_row(db, "ivan.test@trendsettercrew.com")["id"]
    body = {"access_level": "superuser", "department_ids": []}
    r = client.post(f"/admin/users/{uid}/onboarding/finish", json=body, headers=admin)
    assert r.status_code == 422 and r.json()["detail"] == m.ONBOARDING_PASSWORD_PENDING
    to_profile(client, h)
    assert client.post(f"/admin/users/{uid}/onboarding/finish", json={"access_level": "boss", "department_ids": []}, headers=admin).status_code == 422
    r = client.post(f"/admin/users/{uid}/onboarding/finish", json=body, headers=admin)
    assert r.status_code == 200 and r.json()["access_level"] == "superuser" and r.json()["onboarding"] is False
    assert audit(db, "user.onboarding_finish")[0][1]["access_level"] == "superuser"
    r = client.post(f"/admin/users/{uid}/onboarding/finish", json=body, headers=admin)
    assert r.status_code == 422 and r.json()["detail"] == m.ONBOARDING_NOT_ACTIVE


def test_admin_delete(client, db, admin, shared):
    h = newbie_at_profile(client)
    submit_profile(client, h)
    uid = user_row(db, "ivan.test@trendsettercrew.com")["id"]
    assert client.post(f"/admin/users/{uid}/onboarding/delete", headers=admin).status_code == 200
    assert count_users(db, "ivan.test@trendsettercrew.com") == 0
    assert db.execute(text("SELECT count(*) FROM trendsetter_hub.team_submissions")).scalar_one() == 0
    (details,) = [row[1] for row in audit(db, "user.onboarding_delete")]
    assert details["email"] == "ivan.test@trendsettercrew.com" and details["created_at"]
    assert post_login(client, "ivan.test@trendsettercrew.com", SHARED).status_code == 200  # почта снова регистрируется
    boss = user_row(db, "boss@example.com")["id"]
    assert client.post(f"/admin/users/{boss}/onboarding/delete", headers=admin).status_code == 422  # не онбординг
    assert client.post("/admin/users/99999/onboarding/delete", headers=admin).status_code == 404


def test_admin_onboarding_password_and_info(client, db, admin, shared, hr):
    r = client.post("/admin/onboarding/password", json={"password": "Short-pass1"}, headers=admin)  # 11 символов
    assert r.status_code == 422 and r.json()["detail"] == m.ONBOARDING_PASSWORD_INVALID
    for pw in ("я" * 40, "x" * 129):  # больше 72 байт / больше 128 символов
        assert client.post("/admin/onboarding/password", json={"password": pw}, headers=admin).status_code == 422
    r = client.get("/admin/onboarding", headers=admin)
    assert set(r.json()) == {"passwordSet", "domain", "domains", "updatedAt", "updatedBy", "ttlDays", "dailyLimit", "registeredToday"}
    assert r.json()["domain"] == "trendsettercrew.com" and r.json()["ttlDays"] == 14 and r.json()["dailyLimit"] == 20
    assert "$2" not in r.text and SHARED not in r.text
    for method, path in (
        ("GET", "/admin/onboarding"), ("POST", "/admin/onboarding/password"), ("POST", "/admin/users/1/onboarding/extend"),
        ("POST", "/admin/users/1/onboarding/finish"), ("POST", "/admin/users/1/onboarding/delete"),
    ):
        assert client.request(method, path, json={"password": SHARED + "1", "access_level": "viewer"}, headers=hr).status_code == 403, path


def _fake_validate(monkeypatch):
    """Проверка отделов «пропускает» несуществующий id 99: ошибка возникает уже при записи (внешний ключ)."""
    from app.core import onboarding

    fake = lambda session, level, ids, allowed: [99]  # noqa: E731
    monkeypatch.setattr(onboarding, "validate_finish", fake)
    monkeypatch.setattr(team_service, "validate_finish", fake)


def test_admin_finish_db_conflict_is_409(client, db, admin, shared, monkeypatch):
    h = register(client)
    to_profile(client, h)
    uid = user_row(db, "ivan.test@trendsettercrew.com")["id"]
    _fake_validate(monkeypatch)
    r = client.post(f"/admin/users/{uid}/onboarding/finish", json={"access_level": "viewer", "department_ids": []}, headers=admin)
    assert r.status_code == 409 and r.json()["detail"] == m.CONFLICT
    u = user_row(db, "ivan.test@trendsettercrew.com")
    assert u["onboarding"] is True and u["access_level"] is None


def test_hr_approve_db_conflict_is_not_email_duplicate(client, db, shared, hr, tree, monkeypatch):
    h = newbie_at_profile(client)
    submit_profile(client, h)
    sid = client.get(f"{BASE}/hr/submissions", headers=hr).json()[0]["id"]
    _fake_validate(monkeypatch)
    r = client.post(f"{BASE}/hr/submissions/{sid}/approve", json={"directionId": "ops", "managerId": tree["mgr"], "accessLevel": "viewer"}, headers=hr)
    assert r.status_code == 409 and r.json()["detail"] == m.CONFLICT != team_service.MSG_EMAIL_DUPLICATE
    u = user_row(db, "ivan.test@trendsettercrew.com")
    assert u["onboarding"] is True and u["access_level"] is None
    assert pending_submission(db)["status"] == "pending"


def test_admin_can_clear_shared_password(client, db, admin, shared):
    register(client, "first@trendsettercrew.com")
    r = client.post("/admin/onboarding/password", json={"password": ""}, headers=admin)
    assert r.status_code == 200 and r.json()["passwordSet"] is False and r.json()["domains"] == ["trendsettercrew.com"]
    db.rollback()
    assert db.execute(text("SELECT password_hash FROM trendsetter_hub.onboarding_settings")).scalar_one() is None
    assert post_login(client, "second@trendsettercrew.com", SHARED).status_code == 401  # самосоздание выключено
    assert post_login(client, "first@trendsettercrew.com", SHARED).status_code == 401  # и вход общим паролем тоже
    assert count_users(db, "second@trendsettercrew.com") == 0
    assert len(audit(db, "core.onboarding_password_clear")) == 1


def test_admin_patch_does_not_finish_onboarding(client, db, admin, shared):
    register(client)
    uid = user_row(db, "ivan.test@trendsettercrew.com")["id"]
    r = client.patch(f"/admin/users/{uid}", json={"access_level": "admin"}, headers=admin)
    assert r.status_code == 200 and r.json()["onboarding"] is True
    listed = next(u for u in client.get("/admin/users", headers=admin).json() if u["id"] == uid)
    assert listed["onboarding"] is True and listed["must_change_password"] is True and listed["onboarding_expires_at"]


def test_hr_departments_and_users(client, db, shared, hr, admin):
    r = client.get(f"{BASE}/hr/departments", headers=hr)
    assert r.status_code == 200 and [d["id"] for d in r.json()] == sorted(d["id"] for d in r.json()) and {"id", "name"} == set(r.json()[0])
    assert client.get(f"{BASE}/hr/departments", headers=admin).status_code == 200
    make_user(db, "emp@example.com", "employee")
    assert client.get(f"{BASE}/hr/departments", headers=login(client, "emp@example.com")).status_code == 403
    register(client)
    emails = [u["email"] for u in client.get(f"{BASE}/hr/users", headers=hr).json()]
    assert "emp@example.com" in emails and "ivan.test@trendsettercrew.com" not in emails


def test_list_submissions_flags_regular_users(client, db, hr):
    make_user(db, "emp@example.com", "employee", name="Иван Тестов")
    submit_profile(client, login(client, "emp@example.com"))
    assert client.get(f"{BASE}/hr/submissions", headers=hr).json()[0]["userOnboarding"] is False
