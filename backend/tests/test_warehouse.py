"""Модуль «Склад» на базе: права, приёмки, номера коробов, палеты, коды ЧЗ, sync, секции, импорт."""
import os

import pytest
from sqlalchemy import text

from tests.conftest import login, make_user

BASE = "/modules/warehouse"
KI1 = "0104620270011115215Peib9SE3WkoI"
KI2 = "0104620270011115216Qwert12345Zz"


@pytest.fixture(autouse=True)
def pin(monkeypatch):
    monkeypatch.setenv("HUB_WAREHOUSE_PIN", "4321")


def dept_id(db, code):
    return db.execute(text("SELECT id FROM trendsetter_hub.departments WHERE code = :c"), {"c": code}).scalar_one()


@pytest.fixture()
def wh(client, db):
    """Сотрудник склада: заголовки авторизации."""
    make_user(db, "wh@example.com", "employee", [dept_id(db, "warehouse")])
    return login(client, "wh@example.com")


def receipt(client, wh, name="Поставка 1"):
    r = client.post(f"{BASE}/receipts", json={"name": name}, headers=wh)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- права ----------


def test_access_rules(client, db):
    make_user(db, "viewer@example.com", "viewer")
    make_user(db, "buyer@example.com", "employee", [dept_id(db, "purchasing")])
    make_user(db, "boss@example.com", "superuser")
    assert client.get(f"{BASE}/receipts").status_code == 401
    for email in ("viewer@example.com", "buyer@example.com"):
        h = login(client, email)
        assert client.get(f"{BASE}/receipts", headers=h).status_code == 403
        assert client.post(f"{BASE}/box-code", json={"category": "5"}, headers=h).status_code == 403
    assert client.get(f"{BASE}/receipts", headers=login(client, "boss@example.com")).status_code == 200


# ---------- приёмки и раскладка ----------


def test_receipts_unique_case_insensitive_and_finish(client, wh):
    assert receipt(client, wh, "  Поставка   1 ") == "Поставка 1"
    assert receipt(client, wh, "поставка 1") == "Поставка 1"
    listed = client.get(f"{BASE}/receipts", headers=wh).json()
    assert [r["name"] for r in listed] == ["Поставка 1"] and listed[0]["by"] == "Тест Тестов"
    assert client.post(f"{BASE}/receipts", json={"name": "  "}, headers=wh).status_code == 422
    assert client.post(f"{BASE}/receipts/finish", json={"name": "Поставка 1"}, headers=wh).json() == []
    assert receipt(client, wh, "Поставка 1") == "Поставка 1"  # завершённую можно открыть снова
    assert [r["name"] for r in client.get(f"{BASE}/receipts", headers=wh).json()] == ["Поставка 1"]
    assert client.post(f"{BASE}/receipts/finish", json={"name": "Нет такой"}, headers=wh).status_code == 422


def test_shared_plan(client, wh):
    receipt(client, wh)
    assert client.get(f"{BASE}/plan-info", params={"receipt": "Поставка 1"}, headers=wh).json() is None
    saved = client.post(f"{BASE}/plan", json={"receipt": "Поставка 1", "json_data": '{"a":1}', "name": "f.xlsx", "worker": "Иванов"}, headers=wh).json()
    info = client.get(f"{BASE}/plan-info", params={"receipt": "поставка 1"}, headers=wh).json()
    assert info["version"] == saved["version"] and info["name"] == "f.xlsx" and info["by"].startswith("Иванов / wh@example.com")
    plan = client.get(f"{BASE}/plan", params={"receipt": "Поставка 1"}, headers=wh).json()
    assert plan["json"].replace(" ", "") == '{"a":1}'
    # замена файла меняет версию
    again = client.post(f"{BASE}/plan", json={"receipt": "Поставка 1", "json_data": '{"a":2}', "name": "g.xlsx"}, headers=wh).json()
    assert again["version"] >= saved["version"]
    assert client.post(f"{BASE}/plan", json={"receipt": "Поставка 1", "json_data": "не json"}, headers=wh).status_code == 422
    # при завершении приёмки раскладка удаляется
    client.post(f"{BASE}/receipts/finish", json={"name": "Поставка 1"}, headers=wh)
    assert client.get(f"{BASE}/plan-info", params={"receipt": "Поставка 1"}, headers=wh).json() is None


# ---------- номера коробов и палеты ----------


def test_box_codes_are_sequential_per_category(client, wh):
    codes = [client.post(f"{BASE}/box-code", json={"category": c}, headers=wh).json() for c in ("5", "5", "12", "05")]
    assert codes == ["05_0001", "05_0002", "12_0001", "05_0003"]


def assign(client, wh, box, cat="5", count=10, rec="Поставка 1"):
    return client.post(f"{BASE}/assign-pallet", json={"box": box, "cat": cat, "count": count, "receipt": rec, "pc": "Иванов"}, headers=wh)


def test_assign_pallet_rotation_capacity_and_full(client, wh):
    receipt(client, wh)
    pallets = []
    for i in range(1, 85):
        r = assign(client, wh, f"05_{i:04d}")
        assert r.status_code == 200, r.text
        pallets.append(r.json()["pallet"])
    assert [pallets.count(p) for p in range(1, 7)] == [16, 16, 16, 12, 12, 12]
    first = assign(client, wh, "S05_K05_P1_0001").json()  # повторное закрытие уже стоящего короба (после «досканировать») — то же место
    assert first["box"] == "S05_K05_P1_0001" and first["code"] == "S05_P1" and first["pos"] == 1
    full = assign(client, wh, "05_0085")
    assert full.status_code == 409 and full.json()["detail"].startswith("SECTOR_FULL:5 ")


def test_pallet_position_and_capacity_info(client, wh):
    receipt(client, wh)
    a = assign(client, wh, "03_0001", cat="3").json()
    b = assign(client, wh, "03_0002", cat="3").json()
    assert (a["pos"], b["pos"], a["cap"], a["sector"]) == (1, 2, 16, "03")


def test_extra_sector_by_pin(client, wh):
    receipt(client, wh)
    for i in range(1, 85):
        assign(client, wh, f"05_{i:04d}")
    body = {"cat": "5", "sector": "6", "known": ["5"]}
    assert client.post(f"{BASE}/sectors", json={**body, "pin": "0000"}, headers=wh).json() == {"detail": "Неверный ПИН"}
    ok = client.post(f"{BASE}/sectors", json={**body, "pin": "4321"}, headers=wh)
    assert ok.status_code == 200 and ok.json() == [{"cat": "05", "sector": "06", "boxes": 0}]
    r = assign(client, wh, "05_0085")
    assert r.status_code == 200 and r.json()["sector"] == "06"
    assert client.post(f"{BASE}/sectors", json={"cat": "7", "sector": "6", "pin": "4321"}, headers=wh).json() == {"detail": "Секция 6 уже отдана категории 5"}
    assert client.post(f"{BASE}/sectors", json={"cat": "5", "sector": "5", "pin": "4321"}, headers=wh).status_code == 422
    # секция занята короба: удалять нельзя
    assert "ещё стоят короба" in client.post(f"{BASE}/sectors/remove", json={**body, "sector": "6", "pin": "4321"}, headers=wh).json()["detail"]


def test_pin_not_configured_blocks_responsible_actions(client, wh, monkeypatch):
    monkeypatch.delenv("HUB_WAREHOUSE_PIN")
    r = client.post(f"{BASE}/sectors", json={"cat": "5", "sector": "6", "pin": "4321"}, headers=wh)
    assert r.status_code == 403 and "не настроен" in r.json()["detail"]


def test_free_pallet_and_storage_list(client, wh):
    receipt(client, wh)
    a = assign(client, wh, "05_0001").json()
    assign(client, wh, "05_0002")
    rows = client.get(f"{BASE}/storage", headers=wh).json()
    assert [r[0] for r in rows] == ["S05_P1", "S05_P1"] and rows[0][3] == "S05_K05_P1_0001" and rows[0][6] == "Поставка 1"
    assert client.post(f"{BASE}/box-pallets", json={"codes": [a["box"], "нет"]}, headers=wh).json() == {a["box"]: "S05_P1"}
    assert client.post(f"{BASE}/pallets/S05_P1/free", headers=wh).json() == {"freed": 2}
    assert client.get(f"{BASE}/storage", headers=wh).json() == []
    assert assign(client, wh, "05_0003").json()["code"] == "S05_P1"  # палет снова доступен


# ---------- Честный знак ----------


def test_mark_registered_once(client, wh):
    receipt(client, wh)
    m = {"ki": KI1, "gtin": "04620270011115", "ean": "4620270011115", "full": KI1 + "91EE10", "receipt": "Поставка 1", "box": "3", "pc": "Иванов"}
    assert client.post(f"{BASE}/marks", json=m, headers=wh).json() == {"status": "ok"}
    dup = client.post(f"{BASE}/marks", json={**m, "pc": "Петров"}, headers=wh).json()
    assert dup["status"] == "dup" and dup["pc"] == "Иванов" and dup["box"] == "3" and dup["receipt"] == "Поставка 1" and dup["at"]
    assert client.post(f"{BASE}/marks", json={**m, "ki": "bad"}, headers=wh).status_code == 422


# ---------- sync ----------


def scan_op(i, box="5", code="05_0001", status="ok", **extra):
    return {"op": "scan", "id": f"W-{i}", "t": 1792155000000 + i, "box": box, "boxCode": code, "bc": "4600000000011", "status": status, "receipt": "Поставка 1", "pc": "Иванов", **extra}


def count(db, table, where="true"):
    return db.execute(text(f"SELECT count(*) FROM trendsetter_hub.warehouse_{table} WHERE {where}")).scalar_one()


def test_sync_is_idempotent_and_applies_undo_and_close(client, wh, db):
    receipt(client, wh)
    ops = [scan_op(1), scan_op(2), scan_op(3, status="extra", box="20", code="20_0001", noCz=True)]
    assert client.post(f"{BASE}/sync", json={"ops": ops, "worker": "Иванов"}, headers=wh).json() == {"ok": True}
    client.post(f"{BASE}/sync", json={"ops": ops}, headers=wh)  # повторная доставка той же пачки
    assert count(db, "scans") == 3
    assert db.execute(text("SELECT status, no_cz FROM trendsetter_hub.warehouse_scans WHERE id = 'W-3'")).one() == ("extra", True)

    client.post(f"{BASE}/sync", json={"ops": [{"op": "undo", "ref": "W-2"}]}, headers=wh)
    assert count(db, "scans") == 2

    a = assign(client, wh, "05_0001", count=1).json()
    close = {"op": "close", "boxCode": a["box"], "tmp": "05_0001", "box": "5", "count": 1, "opened": 1792155000000, "closedAt": 1792155100000, "receipt": "Поставка 1"}
    client.post(f"{BASE}/sync", json={"ops": [close]}, headers=wh)
    client.post(f"{BASE}/sync", json={"ops": [close]}, headers=wh)
    assert count(db, "boxes") == 1
    assert count(db, "scans", f"box_code = '{a['box']}'") == 1  # временный номер заменён итоговым
    assert count(db, "scans", "box_code = '05_0001'") == 0
    summary = db.execute(text("SELECT scanned, not_in_file, surplus, boxes_closed, boxes_without_pallet, pallets, marked_without_cz FROM trendsetter_hub.warehouse_receipt_summary")).one()
    assert tuple(summary) == (2, 0, 1, 1, 0, 1, 1)


def test_undo_releases_mark(client, wh, db):
    receipt(client, wh)
    m = {"ki": KI2, "receipt": "Поставка 1", "box": "3", "pc": "И"}
    client.post(f"{BASE}/marks", json=m, headers=wh)
    client.post(f"{BASE}/sync", json={"ops": [scan_op(1, ki=KI2, full=KI2 + "91EE10", box="3", code="03_0001")]}, headers=wh)
    assert count(db, "marks") == 1
    client.post(f"{BASE}/sync", json={"ops": [{"op": "undo", "ref": "W-1", "ki": KI2}]}, headers=wh)
    assert count(db, "marks") == 0 and count(db, "scans") == 0
    assert client.post(f"{BASE}/marks", json=m, headers=wh).json() == {"status": "ok"}


def test_sync_unknown_receipt_is_rejected(client, wh):
    r = client.post(f"{BASE}/sync", json={"ops": [scan_op(1, status="ok")]}, headers=wh)
    assert r.status_code == 422 and "не найдена" in r.json()["detail"]


# ---------- повторное открытие, информация о коробе ----------


def test_box_info_and_reopen(client, wh, db):
    receipt(client, wh)
    a = assign(client, wh, "05_0001", count=4).json()
    close = {"op": "close", "boxCode": a["box"], "tmp": "05_0001", "box": "5", "count": 4, "opened": 1792155000000, "closedAt": 1792155100000, "receipt": "Поставка 1"}
    client.post(f"{BASE}/sync", json={"ops": [close]}, headers=wh)
    info = client.get(f"{BASE}/boxes/{a['box']}", headers=wh).json()
    assert info == {"box": "5", "count": 4, "receipt": "Поставка 1", "pallet": "S05_P1"}
    assert client.get(f"{BASE}/boxes/S99_K99_P1_0001", headers=wh).json() is None
    re_open = client.post(f"{BASE}/boxes/{a['box']}/reopen", headers=wh).json()
    assert re_open["box"] == "5" and re_open["count"] == 4 and re_open["opened"] == 1792155000000
    assert re_open["storage"]["code"] == "S05_P1"
    assert count(db, "boxes") == 0
    assert client.post(f"{BASE}/boxes/{a['box']}/reopen", headers=wh).status_code == 404


# ---------- импорт старых коробов ----------


def import_payload():
    boxes = [
        {"code": "S01_K01_P1_0001", "cat": "1", "state": "закрыт", "pallet": "S01_P1", "pos": "1", "pc": "ПК 2", "count": 2, "opened": 1792155000000, "closed": 1792155100000},
        {"code": "01_0002", "cat": "1", "state": "открыт", "pallet": "", "pos": "", "pc": "ПК 2", "count": 1, "opened": 1792155200000, "closed": 1792155200000},
    ]
    scans = [
        {"t": 1792155000000, "pc": "ПК 2", "cat": "1", "code": "S01_K01_P1_0001", "bc": "4620270011115", "status": "в файле", "ki": KI1, "full": KI1 + "91EE10"},
        {"t": 1792155010000, "pc": "ПК 2", "cat": "1", "code": "S01_K01_P1_0001", "bc": "999", "status": "нет в файле", "ki": "", "full": ""},
        {"t": 1792155200000, "pc": "ПК 2", "cat": "1", "code": "01_0002", "bc": "111", "status": "в файле, без ЧЗ", "ki": "", "full": ""},
    ]
    return {"receipt": "Импорт 1", "boxes": boxes, "scans": scans}


def test_import_old(client, wh, db):
    data = import_payload()
    assert client.post(f"{BASE}/import", json={"data": data, "pin": "0000"}, headers=wh).json() == {"detail": "Неверный ПИН"}
    r = client.post(f"{BASE}/import", json={"data": data, "pin": "4321"}, headers=wh)
    assert r.status_code == 200, r.text
    assert r.json() == {"boxes": 2, "scans": 3, "marks": 1}
    assert count(db, "boxes") == 1 and count(db, "storage_boxes") == 1 and count(db, "marks") == 1 and count(db, "scans") == 3
    assert db.execute(text("SELECT last_number FROM trendsetter_hub.warehouse_box_counters WHERE category = '01'")).scalar_one() == 2
    assert count(db, "scans", "no_cz") == 1
    # повторный импорт отклоняется целиком
    again = client.post(f"{BASE}/import", json={"data": data, "pin": "4321"}, headers=wh)
    assert again.status_code == 422 and "Короба уже есть" in again.json()["detail"]
    assert count(db, "scans") == 3
    # импортированный короб можно открыть повторно, а следующий номер категории 1 — 0003
    assert client.post(f"{BASE}/box-code", json={"category": "1"}, headers=wh).json() == "01_0003"


# ---------- ответственный по группе доступа ----------


def make_group(db, name, permissions, user_ids):
    from app.core.models import AccessGroup, AccessGroupMember, AccessGroupPermission

    group = AccessGroup(name=name)
    db.add(group)
    db.flush()
    for module_id, permission in permissions.items():
        db.add(AccessGroupPermission(group_id=group.id, module_id=module_id, permission=permission))
    for user_id in user_ids:
        db.add(AccessGroupMember(group_id=group.id, user_id=user_id))
    db.commit()
    return group


def test_responsible_by_group_skips_pin(client, db):
    buyer = make_user(db, "buyer@example.com", "employee", [dept_id(db, "purchasing")])
    make_group(db, "Ответственные склада", {"warehouse": "responsible"}, [buyer.id])
    h = login(client, "buyer@example.com")
    r = client.post(f"{BASE}/sectors", json={"cat": "5", "sector": "6", "pin": "", "known": ["5"]}, headers=h)
    assert r.status_code == 200, r.text
    via = db.execute(text("SELECT details->>'via' FROM trendsetter_hub.audit_log WHERE action = 'warehouse.sector_add'")).scalar_one()
    assert via == "group"
    assert client.post(f"{BASE}/sectors/remove", json={"cat": "5", "sector": "6", "pin": ""}, headers=h).status_code == 200


def test_group_run_without_responsible_still_needs_pin(client, db):
    buyer = make_user(db, "buyer@example.com", "employee", [dept_id(db, "purchasing")])
    make_group(db, "Запуск склада", {"warehouse": "run"}, [buyer.id])
    h = login(client, "buyer@example.com")
    r = client.post(f"{BASE}/sectors", json={"cat": "5", "sector": "6", "pin": "", "known": ["5"]}, headers=h)
    assert r.status_code == 403 and r.json() == {"detail": "Неверный ПИН"}


def test_pin_by_pin_logs_via_pin(client, wh, db):
    r = client.post(f"{BASE}/sectors", json={"cat": "5", "sector": "6", "pin": "4321", "known": ["5"]}, headers=wh)
    assert r.status_code == 200
    via = db.execute(text("SELECT details->>'via' FROM trendsetter_hub.audit_log WHERE action = 'warehouse.sector_add'")).scalar_one()
    assert via == "pin"


def test_responsible_passes_when_pin_not_configured(client, db, monkeypatch):
    monkeypatch.delenv("HUB_WAREHOUSE_PIN")
    buyer = make_user(db, "buyer@example.com", "employee", [dept_id(db, "purchasing")])
    make_user(db, "wh@example.com", "employee", [dept_id(db, "warehouse")])
    make_group(db, "Ответственные склада", {"warehouse": "responsible"}, [buyer.id])
    body = {"cat": "5", "sector": "6", "pin": "", "known": ["5"]}
    assert client.post(f"{BASE}/sectors", json=body, headers=login(client, "buyer@example.com")).status_code == 200
    r = client.post(f"{BASE}/sectors", json=body, headers=login(client, "wh@example.com"))
    assert r.status_code == 403 and "не настроен" in r.json()["detail"]


def test_me_module_responsible(client, db):
    from app.core.registry import MODULES

    buyer = make_user(db, "buyer@example.com", "employee", [dept_id(db, "purchasing")])
    make_user(db, "admin@example.com", "admin")
    make_group(db, "Ответственные склада", {"warehouse": "responsible"}, [buyer.id])
    me = client.get("/core/me", headers=login(client, "buyer@example.com")).json()
    assert me["module_responsible"] == {mod.id: mod.id == "warehouse" for mod in MODULES}
    assert me["module_access"]["warehouse"] == "run"
    admin = client.get("/core/me", headers=login(client, "admin@example.com")).json()
    assert admin["module_responsible"] == {mod.id: False for mod in MODULES}
