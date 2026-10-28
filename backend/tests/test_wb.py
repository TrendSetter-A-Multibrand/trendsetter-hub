"""WB, «Маркировка»: правила сверки, права, чтение отчётов из public (копии таблиц в тестовой базе), документы «Честного ЗНАКа»."""
from datetime import date

import psycopg
import pytest
from sqlalchemy import text

from app.modules.wb import reports, service
from tests.conftest import login, make_user

BASE = "/modules/wb"
KM1 = "0104610501234521ABCDEFGHJKLMN"
KM2 = "0104610501234521PQRSTUVWXYZab"


def row(doc, km, srid, day, fbs_id=1, assembly_id=0, price="797.00"):
    return {
        "sale_dt": date(2026, 10, day), "doc_type_name": doc, "nm_id": 1245450441, "sa_name": "1170067010", "subject_name": "Футболки",
        "kiz": f"{km}\x1d91EE11\x1d92abc", "srid": srid, "retail_price_withdisc_rub": price, "assembly_id": assembly_id, "fbs_id": fbs_id,
    }


# ---------- правила сверки ----------


def test_short_code_drops_crypto_tail():
    assert service.short_code(f"{KM1}\x1d91EE11\x1d92xyz") == KM1


def test_fbo_rows_are_skipped_fbs_by_order_or_assembly():
    items = service.reconcile([row("Продажа", KM1, "a", 20, fbs_id=None), row("Продажа", KM2, "b", 20, fbs_id=None, assembly_id=77)], None, None)
    assert [(it["km"], it["assembly_id"]) for it in items] == [(KM2, 77)]


def test_sale_and_return_lists():
    items = service.reconcile([row("Продажа", KM1, "a", 20), row("Возврат", KM1, "b", 21)], None, None)
    assert [(it["list"], it["key"]) for it in items] == [("withdraw", f"withdraw:a:{KM1}"), ("return", f"return:b:{KM1}")]
    assert items[0]["price"] == 797.0 and items[0]["date"] == "2026-10-20"


def test_sold_twice_without_return_is_strange():
    items = service.reconcile([row("Продажа", KM1, "a", 20), row("Продажа", KM1, "b", 22)], None, None)
    assert [(it["srid"], it["list"], it["reason"]) for it in items] == [("a", "withdraw", None), ("b", "strange", "soldTwice")]


def test_sold_again_after_return_is_fine():
    rows = [row("Продажа", KM1, "a", 20), row("Возврат", KM1, "b", 21), row("Продажа", KM1, "c", 22)]
    assert all(it["reason"] is None for it in service.reconcile(rows, None, None))


def test_not_in_excise_only_inside_report_dates():
    rows = [row("Продажа", KM1, "a", 18), row("Продажа", KM2, "b", 20)]
    items = service.reconcile(rows, set(), date(2026, 10, 25), date(2026, 10, 19))
    assert {it["srid"]: it["reason"] for it in items} == {"a": None, "b": "notInExcise"}


def test_not_in_excise_only_up_to_report_date():
    rows = [row("Продажа", KM1, "a", 20), row("Продажа", KM2, "b", 20), row("Продажа", "0104610501234521zzzzzzzzzzzzz", "c", 25)]
    items = service.reconcile(rows, {(KM1, "a", 1)}, date(2026, 10, 22))
    assert {it["srid"]: it["reason"] for it in items} == {"a": None, "b": "notInExcise", "c": None}


# ---------- API ----------

PUBLIC_DDL = """
DROP TABLE IF EXISTS public."api_wb_FinanceReport", public."api_wb_Orders_FBS", public."api_wb_ExciseReport";
CREATE TABLE public."api_wb_FinanceReport" (
  rrd_id bigint, sale_dt date, doc_type_name text, nm_id bigint, sa_name text, subject_name text, kiz text, srid text,
  retail_price_withdisc_rub text, assembly_id bigint);
CREATE TABLE public."api_wb_Orders_FBS" (id bigint, rid text, "createdAt" text);
GRANT SELECT ON public."api_wb_FinanceReport", public."api_wb_Orders_FBS" TO hub_app;
"""


@pytest.fixture()
def wb_reports(database, engine, monkeypatch):
    with psycopg.connect(database["db_dsn"], autocommit=True) as conn:
        conn.execute(PUBLIC_DDL)
        conn.execute(
            """INSERT INTO public."api_wb_FinanceReport" VALUES
               (1, '2026-10-20', 'Продажа', 1, '1170067010', 'Футболки', %(k1)s, 'a', '797.00', 0),
               (2, '2026-10-20', 'Продажа', 1, '1170067010', 'Футболки', %(k1)s, 'a', '797.00', 0),  -- тот же srid во втором отчёте
               (3, '2026-10-21', 'Возврат', 1, '1170067010', 'Футболки', %(k2)s, 'b', '797.00', 0),
               (4, '2026-10-21', 'Продажа', 1, '1170067010', 'Футболки', %(k2)s, 'fbo', '797.00', 0),
               (5, '2026-10-21', '', 1, '1170067010', 'Футболки', %(k2)s, 'b', '0', 0)""",
            {"k1": f"{KM1}\x1d91EE11", "k2": f"{KM2}\x1d91EE11"},
        )
        conn.execute("""INSERT INTO public."api_wb_Orders_FBS" VALUES (11, 'a', '2026-10-20T08:00:00Z'), (12, 'b', '2026-10-19T08:00:00Z')""")
    monkeypatch.setattr(reports, "get_reports_engine", lambda: engine)
    yield database
    with psycopg.connect(database["db_dsn"], autocommit=True) as conn:
        conn.execute('DROP TABLE IF EXISTS public."api_wb_FinanceReport", public."api_wb_Orders_FBS", public."api_wb_ExciseReport"')


def wb_department(db):
    return db.execute(text("SELECT id FROM trendsetter_hub.departments WHERE code = 'wb'")).scalar()


def test_marking_reads_reports_and_saves_documents(client, db, wb_reports):
    make_user(db, "wb@example.com", "employee", [wb_department(db)])
    h = login(client, "wb@example.com")

    r = client.get(f"{BASE}/marking", params={"from": "2026-10-19", "to": "2026-10-24"}, headers=h)
    assert r.status_code == 200, r.text
    data = r.json()
    assert [(it["list"], it["srid"], it["assembly_id"]) for it in data["items"]] == [("withdraw", "a", 11), ("return", "b", 12)]
    assert data["sources"]["fbs"]["lastDate"] == "2026-10-20"
    assert data["sources"]["finance"]["lastDate"] == "2026-10-21"
    assert data["sources"]["excise"]["lastDate"] is None  # таблицы ещё нет — сверка без неё

    key = data["items"][0]["key"]
    assert client.post(f"{BASE}/marking/document", json={"key": key, "document": " 30/17-09-26 "}, headers=h).json()["document"] == "30/17-09-26"
    items = client.get(f"{BASE}/marking", params={"from": "2026-10-19", "to": "2026-10-24"}, headers=h).json()["items"]
    assert items[0]["document"] == "30/17-09-26"
    client.post(f"{BASE}/marking/document", json={"key": key, "document": ""}, headers=h)
    assert db.execute(text("SELECT count(*) FROM trendsetter_hub.wb_marking_documents")).scalar() == 0


def test_marking_rights_and_validation(client, db, wb_reports):
    make_user(db, "viewer@example.com", "viewer")
    make_user(db, "other@example.com", "employee")
    make_user(db, "wb@example.com", "employee", [wb_department(db)])
    period = {"from": "2026-10-19", "to": "2026-10-24"}
    assert client.get(f"{BASE}/marking", params=period, headers=login(client, "viewer@example.com")).status_code == 403
    assert client.get(f"{BASE}/marking", params=period, headers=login(client, "other@example.com")).status_code == 403
    h = login(client, "wb@example.com")
    assert client.get(f"{BASE}/marking", params={"from": "2026-10-24", "to": "2026-10-19"}, headers=h).status_code == 422
    assert client.get(f"{BASE}/marking", params={"from": "2026-07-31", "to": "2026-08-05"}, headers=h).status_code == 422
    assert client.post(f"{BASE}/marking/document", json={"key": "strange:a:x", "document": "1"}, headers=h).status_code == 422


def test_marking_without_reports_connection_is_503(client, db, monkeypatch):
    monkeypatch.setattr(reports, "get_reports_engine", lambda: None)
    make_user(db, "wb@example.com", "employee", [wb_department(db)])
    r = client.get(f"{BASE}/marking", params={"from": "2026-10-19", "to": "2026-10-24"}, headers=login(client, "wb@example.com"))
    assert r.status_code == 503


def test_import_marks_rows_as_done_and_manual_wins(client, db, wb_reports):
    make_user(db, "wb@example.com", "employee", [wb_department(db)])
    make_user(db, "viewer@example.com", "viewer")
    h = login(client, "wb@example.com")
    rows = [
        {"km": f"{KM1}\x1d91EE11", "document": " 12/20-10-26 "},
        {"km": "мусор", "document": "1"},
        {"km": KM2, "document": ""},
    ]
    body = {"list": "withdraw", "rows": rows}
    assert client.post(f"{BASE}/marking/import", json=body, headers=login(client, "viewer@example.com")).status_code == 403
    assert client.post(f"{BASE}/marking/import", json=body, headers=h).json() == {"saved": 1, "skipped": 2}

    period = {"from": "2026-10-19", "to": "2026-10-24"}
    items = client.get(f"{BASE}/marking", params=period, headers=h).json()["items"]
    assert [(it["list"], it["document"]) for it in items] == [("withdraw", "12/20-10-26"), ("return", "")]
    # код из файла не ставит номер возврату того же кода; номер по строке важнее загруженного
    client.post(f"{BASE}/marking/document", json={"key": items[0]["key"], "document": "99/20-10-26"}, headers=h)
    assert client.get(f"{BASE}/marking", params=period, headers=h).json()["items"][0]["document"] == "99/20-10-26"


def test_one_document_for_many_rows(client, db, wb_reports):
    make_user(db, "wb@example.com", "employee", [wb_department(db)])
    h = login(client, "wb@example.com")
    period = {"from": "2026-10-19", "to": "2026-10-24"}
    keys = [it["key"] for it in client.get(f"{BASE}/marking", params=period, headers=h).json()["items"]]
    r = client.post(f"{BASE}/marking/documents", json={"keys": keys + keys[:1], "document": "42/25-10-26"}, headers=h)
    assert r.json() == {"saved": 2, "document": "42/25-10-26"}
    assert [it["document"] for it in client.get(f"{BASE}/marking", params=period, headers=h).json()["items"]] == ["42/25-10-26"] * 2
    client.post(f"{BASE}/marking/documents", json={"keys": keys, "document": ""}, headers=h)
    assert db.execute(text("SELECT count(*) FROM trendsetter_hub.wb_marking_documents")).scalar() == 0
    assert client.post(f"{BASE}/marking/documents", json={"keys": ["strange:a:b"], "document": "1"}, headers=h).status_code == 422
