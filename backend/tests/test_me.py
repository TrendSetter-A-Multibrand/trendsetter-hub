from sqlalchemy import text

from tests.conftest import login, make_user


def dept_id(db, code):
    return db.execute(text("SELECT id FROM trendsetter_hub.departments WHERE code = :c"), {"c": code}).scalar_one()


def test_me_for_admin(client, db):
    make_user(db, "boss@example.com", "admin", name="Карен В.")
    me = client.get("/core/me", headers=login(client, "boss@example.com")).json()
    assert me["full_name"] == "Карен В."
    assert me["can_manage_users"] is True
    assert me["departments"] == []
    assert me["module_access"] == {m: "run" for m in ("purchasing", "warehouse", "wb", "analytics", "pricing", "hr", "team")}


def test_me_employee_runs_only_own_department_modules(client, db):
    make_user(db, "wh@example.com", "employee", [dept_id(db, "warehouse")])
    me = client.get("/core/me", headers=login(client, "wh@example.com")).json()
    assert me["can_manage_users"] is False
    assert [d["code"] for d in me["departments"]] == ["warehouse"]
    assert me["module_access"]["warehouse"] == "run"
    assert me["module_access"]["purchasing"] == "none"


def test_me_viewer_sees_only_structure(client, db):
    make_user(db, "v@example.com", "viewer")
    me = client.get("/core/me", headers=login(client, "v@example.com")).json()
    assert set(me["module_access"].values()) == {"structure"}


def test_runs_is_empty_list_for_now(client, db):
    make_user(db, "boss@example.com", "admin")
    assert client.get("/core/runs?limit=5", headers=login(client, "boss@example.com")).json() == []
