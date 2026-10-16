from tests.conftest import ADMIN_PASSWORD_IN_TESTS, login, make_user

BAD = "Неверная почта или пароль"


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_login_ok_returns_token_and_logs(client, db):
    make_user(db, "boss@example.com", "admin")
    r = client.post("/auth/login", json={"email": " Boss@Example.com ", "password": ADMIN_PASSWORD_IN_TESTS})
    assert r.status_code == 200
    assert set(r.json()) == {"token"}


def test_login_failures_are_indistinguishable(client, db):
    make_user(db, "boss@example.com", "admin")
    make_user(db, "off@example.com", "employee", active=False)
    wrong_password = client.post("/auth/login", json={"email": "boss@example.com", "password": "wrong-password"})
    unknown = client.post("/auth/login", json={"email": "nobody@example.com", "password": ADMIN_PASSWORD_IN_TESTS})
    disabled = client.post("/auth/login", json={"email": "off@example.com", "password": ADMIN_PASSWORD_IN_TESTS})
    for r in (wrong_password, unknown, disabled):
        assert r.status_code == 401
        assert r.json() == {"detail": BAD}


def test_long_password_is_rejected_not_crashing(client, db):
    make_user(db, "boss@example.com", "admin")
    r = client.post("/auth/login", json={"email": "boss@example.com", "password": "x" * 100})
    assert r.status_code == 401


def test_disabled_user_with_old_token_gets_401(client, db):
    user = make_user(db, "emp@example.com", "employee")
    headers = login(client, "emp@example.com")
    assert client.get("/core/me", headers=headers).status_code == 200
    user.is_active = False
    db.commit()
    assert client.get("/core/me", headers=headers).status_code == 401


def test_requests_without_or_with_bad_token(client):
    assert client.get("/core/me").status_code == 401
    assert client.get("/core/me", headers={"Authorization": "Bearer nonsense"}).status_code == 401


def test_validation_error_is_russian_text(client):
    r = client.post("/auth/login", json={"email": "a@b.c"})
    assert r.status_code == 422
    assert r.json() == {"detail": "Некорректные данные"}


def test_docs_are_not_exposed(client):
    assert client.get("/docs").status_code == 404
    assert client.get("/openapi.json").status_code == 404
