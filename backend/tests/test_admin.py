from sqlalchemy import text

from tests.conftest import login, make_user

NEW = {"email": "new@example.com", "full_name": "Новый Сотрудник", "access_level": "employee", "password": "Pass-12345"}


def admin(client, db):
    user = make_user(db, "boss@example.com", "admin")
    return user, login(client, "boss@example.com")


def test_only_admin_can_manage(client, db):
    make_user(db, "su@example.com", "superuser")
    make_user(db, "emp@example.com", "employee")
    for email in ("su@example.com", "emp@example.com"):
        h = login(client, email)
        assert client.get("/admin/users", headers=h).status_code == 403
        assert client.post("/admin/users", json=NEW, headers=h).status_code == 403
        assert client.get("/admin/departments", headers=h).status_code == 403
    assert client.get("/admin/users").status_code == 401


def test_create_user_and_login_with_given_password(client, db):
    _, h = admin(client, db)
    r = client.post("/admin/users", json={**NEW, "department_ids": [1]}, headers=h)
    assert r.status_code == 200, r.text
    created = r.json()
    assert created["department_ids"] == [1] and created["is_active"] is True and "password" not in created
    assert login(client, "new@example.com", "Pass-12345")
    assert db.execute(text("SELECT count(*) FROM trendsetter_hub.audit_log WHERE action = 'user.create'")).scalar_one() == 1


def test_create_user_validation(client, db):
    _, h = admin(client, db)
    assert client.post("/admin/users", json={**NEW, "email": "bad"}, headers=h).json() == {"detail": "Введите корректную почту"}
    assert client.post("/admin/users", json={**NEW, "full_name": " "}, headers=h).json() == {"detail": "Введите ФИО"}
    assert client.post("/admin/users", json={**NEW, "access_level": "boss"}, headers=h).json() == {"detail": "Выберите уровень доступа"}
    assert client.post("/admin/users", json={**NEW, "password": "short"}, headers=h).status_code == 422
    assert client.post("/admin/users", json={**NEW, "password": "x" * 80}, headers=h).status_code == 422
    assert client.post("/admin/users", json={**NEW, "department_ids": [9999]}, headers=h).json() == {"detail": "Отдел не найден"}


def test_duplicate_email_is_409_case_insensitive(client, db):
    _, h = admin(client, db)
    assert client.post("/admin/users", json=NEW, headers=h).status_code == 200
    r = client.post("/admin/users", json={**NEW, "email": "NEW@example.com"}, headers=h)
    assert r.status_code == 409 and r.json() == {"detail": "Пользователь с такой почтой уже есть"}


def test_list_users_has_department_ids(client, db):
    _, h = admin(client, db)
    client.post("/admin/users", json={**NEW, "department_ids": [2, 1]}, headers=h)
    users = client.get("/admin/users", headers=h).json()
    assert [u["email"] for u in users] == ["boss@example.com", "new@example.com"]
    assert users[1]["department_ids"] == [1, 2]
    assert "password_hash" not in users[0]


def test_patch_user_rules(client, db):
    me, h = admin(client, db)
    uid = client.post("/admin/users", json=NEW, headers=h).json()["id"]
    r = client.patch(f"/admin/users/{uid}", json={"access_level": "superuser", "department_ids": [3], "is_active": False}, headers=h)
    assert r.status_code == 200 and r.json()["access_level"] == "superuser" and r.json()["department_ids"] == [3]
    assert r.json()["is_active"] is False
    assert client.patch(f"/admin/users/{me.id}", json={"access_level": "employee"}, headers=h).json() == {"detail": "Нельзя изменить собственный уровень доступа"}
    assert client.patch(f"/admin/users/{me.id}", json={"is_active": False}, headers=h).json() == {"detail": "Нельзя отключить самого себя"}
    assert client.patch(f"/admin/users/{uid}", json={"access_level": "boss"}, headers=h).json() == {"detail": "Неизвестный уровень доступа"}
    assert client.patch(f"/admin/users/{uid}", json={"department_ids": [9999]}, headers=h).json() == {"detail": "Отдел не найден"}
    assert client.patch("/admin/users/99999", json={"is_active": True}, headers=h).status_code == 404


def test_disabled_user_cannot_login_until_enabled(client, db):
    _, h = admin(client, db)
    uid = client.post("/admin/users", json=NEW, headers=h).json()["id"]
    client.patch(f"/admin/users/{uid}", json={"is_active": False}, headers=h)
    assert client.post("/auth/login", json={"email": NEW["email"], "password": NEW["password"]}).status_code == 401
    client.patch(f"/admin/users/{uid}", json={"is_active": True}, headers=h)
    assert login(client, NEW["email"], NEW["password"])


def test_reset_password(client, db):
    _, h = admin(client, db)
    uid = client.post("/admin/users", json=NEW, headers=h).json()["id"]
    assert client.post(f"/admin/users/{uid}/password", json={"password": "short"}, headers=h).status_code == 422
    assert client.post(f"/admin/users/{uid}/password", json={"password": "Another-pass-1"}, headers=h).status_code == 200
    assert client.post("/auth/login", json={"email": NEW["email"], "password": NEW["password"]}).status_code == 401
    assert login(client, NEW["email"], "Another-pass-1")


def test_departments(client, db):
    _, h = admin(client, db)
    deps = client.get("/admin/departments", headers=h).json()
    assert [d["code"] for d in deps][:2] == ["purchasing", "warehouse"]
    assert all(d["user_count"] == 0 for d in deps)

    created = client.post("/admin/departments", json={"code": "design", "name": "Дизайн"}, headers=h)
    assert created.status_code == 200 and created.json()["user_count"] == 0
    assert client.post("/admin/departments", json={"code": "design", "name": "Другое"}, headers=h).status_code == 409
    assert client.post("/admin/departments", json={"code": "design2", "name": "дизайн"}, headers=h).json() == {"detail": "Отдел с таким названием уже есть"}
    assert client.post("/admin/departments", json={"code": "Bad Code", "name": "X"}, headers=h).status_code == 422
    assert client.post("/admin/departments", json={"code": "ok_code", "name": " "}, headers=h).status_code == 422

    did = created.json()["id"]
    client.post("/admin/users", json={**NEW, "department_ids": [did]}, headers=h)
    renamed = client.patch(f"/admin/departments/{did}", json={"name": "Дизайн-студия"}, headers=h)
    assert renamed.json()["name"] == "Дизайн-студия" and renamed.json()["user_count"] == 1
    assert client.patch(f"/admin/departments/{did}", json={"code": "other"}, headers=h).json() == {"detail": "Код отдела изменить нельзя"}
    assert client.patch("/admin/departments/9999", json={"name": "X"}, headers=h).status_code == 404
    # переименование в собственное имя допустимо
    assert client.patch(f"/admin/departments/{did}", json={"name": "Дизайн-студия"}, headers=h).status_code == 200
