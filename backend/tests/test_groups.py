"""Группы доступа: API админа, права действуют сразу (без перелогина), аудит."""
import pytest
from sqlalchemy import text

from tests.conftest import login, make_user

URL = "/admin/groups"


@pytest.fixture()
def admin(client, db):
    make_user(db, "admin@example.com", "admin")
    return login(client, "admin@example.com")


def dept_id(db, code):
    return db.execute(text("SELECT id FROM trendsetter_hub.departments WHERE code = :c"), {"c": code}).scalar_one()


def audit(db, action):
    return db.execute(text("SELECT details FROM trendsetter_hub.audit_log WHERE action = :a ORDER BY id"), {"a": action}).scalars().all()


def create(client, admin, **body):
    return client.post(URL, json={"name": "Группа", **body}, headers=admin)


# ---------- доступ ----------


@pytest.mark.parametrize("level", ["superuser", "employee"])
def test_only_admin(client, db, level):
    make_user(db, "x@example.com", level)
    h = login(client, "x@example.com")
    assert client.get(URL, headers=h).status_code == 403
    assert client.post(URL, json={"name": "Г"}, headers=h).status_code == 403
    assert client.patch(f"{URL}/1", json={"name": "Г"}, headers=h).status_code == 403


def test_no_token(client):
    assert client.get(URL).status_code == 401
    assert client.post(URL, json={"name": "Г"}).status_code == 401
    assert client.patch(f"{URL}/1", json={"name": "Г"}).status_code == 401


# ---------- создание ----------


def test_create_and_list(client, db, admin):
    u1 = make_user(db, "a@example.com", "viewer")
    u2 = make_user(db, "b@example.com", "viewer", active=False)
    r = create(client, admin, name="  Ответственные склада ", permissions={"warehouse": "responsible"}, user_ids=[u2.id, u1.id])
    assert r.status_code == 200, r.text
    assert r.json() == {
        "id": 1,
        "name": "Ответственные склада",
        "permissions": {"warehouse": "responsible"},
        "user_ids": [u1.id, u2.id],
        "user_count": 1,
    }
    create(client, admin, name="Вторая")
    listed = client.get(URL, headers=admin).json()
    assert [g["id"] for g in listed] == [1, 2] and listed[1]["permissions"] == {} and listed[1]["user_ids"] == []
    created = audit(db, "group.create")
    assert len(created) == 2  # по одной записи на каждую созданную группу
    assert created[0]["group_id"] == 1 and created[0]["permissions"] == {"warehouse": "responsible"} and created[0]["user_ids"] == [u1.id, u2.id]


@pytest.mark.parametrize(
    "body,status,detail",
    [
        ({"name": "  "}, 422, "Введите название группы"),
        ({"name": ""}, 422, "Введите название группы"),
        ({"name": "я" * 65}, 422, "Название группы не длиннее 64 символов"),
        ({"name": "Г", "permissions": {"nope": "view"}}, 422, "Модуль не найден"),
        ({"name": "Г", "permissions": {"warehouse": "admin"}}, 422, "Неизвестное право"),
        ({"name": "Г", "user_ids": [999]}, 422, "Пользователь не найден"),
        ({"name": ["x"]}, 422, "Некорректные данные"),
    ],
)
def test_create_errors(client, admin, body, status, detail):
    r = client.post(URL, json=body, headers=admin)
    assert r.status_code == status and r.json() == {"detail": detail}


def test_create_duplicate_name(client, admin):
    assert create(client, admin, name="Склад").status_code == 200
    r = create(client, admin, name="  СКЛАД ")
    assert r.status_code == 409 and r.json() == {"detail": "Группа с таким названием уже есть"}


def test_create_integrity_error_race(client, admin, monkeypatch):
    """Гонка: проверка имени пропустила дубль, уникальный индекс не пропускает -> 409."""
    from app.core import routes_admin

    assert create(client, admin, name="Склад").status_code == 200
    monkeypatch.setattr(routes_admin, "_check_group_name", lambda *a, **k: None)
    r = create(client, admin, name="склад")
    assert r.status_code == 409 and r.json() == {"detail": "Группа с таким названием уже есть"}


# ---------- изменение ----------


def test_patch_replaces_whole_fields_and_audit(client, db, admin):
    u1 = make_user(db, "a@example.com", "viewer")
    u2 = make_user(db, "b@example.com", "viewer")
    u3 = make_user(db, "c@example.com", "viewer")
    create(client, admin, name="Группа", permissions={"warehouse": "run", "purchasing": "view"}, user_ids=[u1.id, u2.id])
    r = client.patch(f"{URL}/1", json={"permissions": {"purchasing": "run"}, "user_ids": [u2.id, u3.id]}, headers=admin)
    assert r.status_code == 200, r.text
    assert r.json()["permissions"] == {"purchasing": "run"} and r.json()["user_ids"] == [u2.id, u3.id]
    assert audit(db, "group.update")[-1] == {
        "group_id": 1,
        "permissions": {"purchasing": "run"},
        "added_user_ids": [u3.id],
        "removed_user_ids": [u1.id],
    }
    # переименование в своё имя (другой регистр) допустимо
    r = client.patch(f"{URL}/1", json={"name": "ГРУППА"}, headers=admin)
    assert r.status_code == 200 and r.json()["name"] == "ГРУППА"
    assert audit(db, "group.update")[-1] == {"group_id": 1, "name": "ГРУППА"}
    # без изменений
    client.patch(f"{URL}/1", json={}, headers=admin)
    assert audit(db, "group.update")[-1] == {"group_id": 1}
    # обнуление
    r = client.patch(f"{URL}/1", json={"permissions": {}, "user_ids": []}, headers=admin)
    assert r.json()["permissions"] == {} and r.json()["user_ids"] == [] and r.json()["user_count"] == 0


def test_patch_errors(client, admin):
    create(client, admin, name="Первая")
    create(client, admin, name="Вторая")
    r = client.patch(f"{URL}/99", json={"name": "Г"}, headers=admin)
    assert r.status_code == 404 and r.json() == {"detail": "Группа не найдена"}
    r = client.patch(f"{URL}/2", json={"name": "первая"}, headers=admin)
    assert r.status_code == 409 and r.json() == {"detail": "Группа с таким названием уже есть"}
    assert client.patch(f"{URL}/2", json={"name": " "}, headers=admin).json() == {"detail": "Введите название группы"}
    assert client.patch(f"{URL}/2", json={"name": "я" * 65}, headers=admin).json() == {"detail": "Название группы не длиннее 64 символов"}
    assert client.patch(f"{URL}/2", json={"permissions": {"x": "view"}}, headers=admin).json() == {"detail": "Модуль не найден"}
    assert client.patch(f"{URL}/2", json={"permissions": {"warehouse": "x"}}, headers=admin).json() == {"detail": "Неизвестное право"}
    assert client.patch(f"{URL}/2", json={"user_ids": [999]}, headers=admin).json() == {"detail": "Пользователь не найден"}
    assert client.patch(f"{URL}/2", json={"user_ids": "x"}, headers=admin).json() == {"detail": "Некорректные данные"}


def test_patch_integrity_error_race(client, admin, monkeypatch):
    from app.core import routes_admin

    create(client, admin, name="Первая")
    create(client, admin, name="Вторая")
    monkeypatch.setattr(routes_admin, "_check_group_name", lambda *a, **k: None)
    r = client.patch(f"{URL}/2", json={"name": "ПЕРВАЯ"}, headers=admin)
    assert r.status_code == 409 and r.json() == {"detail": "Группа с таким названием уже есть"}


def test_patch_integrity_error_race_with_permissions(client, admin, monkeypatch):
    # autoflush на запросе внутри PATCH не должен превращать гонку за имя в 500
    from app.core import routes_admin

    create(client, admin, name="Первая")
    create(client, admin, name="Вторая")
    monkeypatch.setattr(routes_admin, "_check_group_name", lambda *a, **k: None)
    r = client.patch(f"{URL}/2", json={"name": "ПЕРВАЯ", "permissions": {"warehouse": "view"}, "user_ids": []}, headers=admin)
    assert r.status_code == 409 and r.json() == {"detail": "Группа с таким названием уже есть"}


# ---------- права действуют сразу ----------


def test_rights_apply_immediately_with_same_token(client, db, admin):
    viewer = make_user(db, "viewer@example.com", "viewer")
    token = login(client, "viewer@example.com")
    assert client.get("/modules/warehouse/receipts", headers=token).status_code == 403
    create(client, admin, name="Склад", permissions={"warehouse": "run"}, user_ids=[viewer.id])
    assert client.get("/modules/warehouse/receipts", headers=token).status_code == 200
    assert client.get("/core/me", headers=token).json()["module_access"]["warehouse"] == "run"
    client.patch(f"{URL}/1", json={"user_ids": []}, headers=admin)
    assert client.get("/modules/warehouse/receipts", headers=token).status_code == 403


def test_group_rights_change_reduces_immediately(client, db, admin):
    buyer = make_user(db, "buyer@example.com", "employee", [dept_id(db, "purchasing")])
    token = login(client, "buyer@example.com")
    create(client, admin, name="Склад", permissions={"warehouse": "run"}, user_ids=[buyer.id])
    assert client.get("/modules/warehouse/receipts", headers=token).status_code == 200
    client.patch(f"{URL}/1", json={"permissions": {"warehouse": "view"}}, headers=admin)
    assert client.get("/modules/warehouse/receipts", headers=token).status_code == 403
    assert client.get("/core/me", headers=token).json()["module_access"]["warehouse"] == "view"


def test_disabled_member_gets_401(client, db, admin):
    user = make_user(db, "m@example.com", "employee")
    token = login(client, "m@example.com")
    create(client, admin, name="Склад", permissions={"warehouse": "run"}, user_ids=[user.id])
    assert client.patch(f"/admin/users/{user.id}", json={"is_active": False}, headers=admin).status_code == 200
    assert client.get("/core/me", headers=token).status_code == 401
    assert client.get("/modules/warehouse/receipts", headers=token).status_code == 401
