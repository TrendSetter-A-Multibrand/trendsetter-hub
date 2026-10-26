"""Безопасность HR: смена пароля и закрытие сессий, журнал, автоистория оклада, шифрование ПДн (docs/TZ-security.md). Данные вымышленные."""
import json
import os
from datetime import UTC, datetime, timedelta

import pytest
from cryptography.fernet import Fernet
from jose import jwt
from sqlalchemy import text

from app.core import messages as m
from app.core.security import ALGORITHM
from tests.conftest import ADMIN_PASSWORD_IN_TESTS, login, make_user
from tests.test_hr import BASE, PDF, admin, audit, b64, doc_body, grant, hr, person, resp, upload  # noqa: F401
from tests.test_team import add_person

NEW_PASSWORD = "Brand-new-pass-1"
SECRET_PASSPORT = "AB 1234567 секретный"
SECRET_TAX = "770012345678"
OTHER_KEY = Fernet.generate_key().decode()


def pii_key() -> str:
    return os.environ["HUB_PII_KEY"]


@pytest.fixture()
def emp(client, db):
    user = make_user(db, "emp@example.com", "employee", name="Сотрудник Сергей")
    return user, login(client, "emp@example.com")


def change(client, headers, old=ADMIN_PASSWORD_IN_TESTS, new=NEW_PASSWORD):
    return client.post("/auth/change-password", json={"oldPassword": old, "newPassword": new}, headers=headers)


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def raw(db, sql, **params):
    return db.execute(text(sql), params).all()


# ---------- смена пароля ----------


def test_change_password_success_closes_old_sessions(client, db, emp):
    user, old_headers = emp
    r = change(client, old_headers)
    assert r.status_code == 200 and set(r.json()) == {"token"}
    new_headers = bearer(r.json()["token"])
    assert client.get("/core/me", headers=old_headers).status_code == 401  # прежняя сессия закрыта
    assert client.get("/core/me", headers=new_headers).status_code == 200  # новый токен работает
    assert client.post("/auth/login", json={"email": "emp@example.com", "password": ADMIN_PASSWORD_IN_TESTS}).status_code == 401
    assert login(client, "emp@example.com", NEW_PASSWORD)
    db.expire_all()
    assert db.execute(text("SELECT token_version FROM trendsetter_hub.users WHERE id = :i"), {"i": user.id}).scalar_one() == 1
    # журнал: только id, без значений
    log = audit(db, "core.password_change")
    assert log == [{"target_user_id": user.id}]
    assert NEW_PASSWORD not in json.dumps(log) and ADMIN_PASSWORD_IN_TESTS not in json.dumps(log)


def test_change_password_wrong_old_is_401(client, emp):
    _, headers = emp
    r = change(client, headers, old="wrong-old-password")
    assert r.status_code == 401 and r.json() == {"detail": m.OLD_PASSWORD_WRONG}
    assert client.get("/core/me", headers=headers).status_code == 200  # сессия не тронута


def test_change_password_new_rules_are_422(client, emp):
    _, headers = emp
    short = change(client, headers, new="x" * 9)
    assert short.status_code == 422 and short.json() == {"detail": m.NEW_PASSWORD_SHORT}
    assert change(client, headers, new="x" * 10).status_code == 200  # ровно 10 символов допустимо


def test_change_password_same_and_long_are_422(client, db):
    make_user(db, "a@example.com", "employee", password="Long-enough-pass-1")
    headers = login(client, "a@example.com", "Long-enough-pass-1")
    same = change(client, headers, old="Long-enough-pass-1", new="Long-enough-pass-1")
    assert same.status_code == 422 and same.json() == {"detail": m.NEW_PASSWORD_SAME}
    for new in ("я" * 129, "x" * 129, "x" * 73, "я" * 40):  # >128 символов и >72 байт (предел bcrypt)
        r = change(client, headers, old="Long-enough-pass-1", new=new)
        assert r.status_code == 422 and r.json() == {"detail": m.NEW_PASSWORD_LONG}, new[:3]
    assert change(client, headers, old="Long-enough-pass-1", new="я" * 36).status_code == 200  # 72 байта — ещё можно


def test_change_password_requires_login(client):
    assert client.post("/auth/change-password", json={"oldPassword": "a", "newPassword": "b" * 12}).status_code == 401


def test_change_password_rate_limit(client, db, emp):
    _, headers = emp
    for _ in range(5):
        assert change(client, headers, old="wrong-old-password").status_code == 401
    blocked = change(client, headers, old="wrong-old-password")
    assert blocked.status_code == 429 and blocked.json() == {"detail": m.TOO_MANY_ATTEMPTS}
    assert change(client, headers).status_code == 429  # и верный пароль не проходит, пока окно не истекло
    make_user(db, "other@example.com", "employee")
    other = login(client, "other@example.com")
    assert change(client, other, old="wrong-old-password").status_code == 401  # у другого пользователя свой счётчик


def test_change_password_success_resets_failures(client, emp):
    _, headers = emp
    for _ in range(4):
        assert change(client, headers, old="wrong-old-password").status_code == 401
    r = change(client, headers)
    assert r.status_code == 200
    headers = bearer(r.json()["token"])
    for _ in range(4):
        assert change(client, headers, old="wrong-old-password").status_code == 401


def test_admin_reset_password_closes_sessions(client, db, admin, emp):
    user, emp_headers = emp
    assert client.get("/core/me", headers=emp_headers).status_code == 200
    assert client.post(f"/admin/users/{user.id}/password", json={"password": "Another-pass-1"}, headers=admin).status_code == 200
    assert client.get("/core/me", headers=emp_headers).status_code == 401
    assert client.get("/core/me", headers=admin).status_code == 200  # сессия админа не затронута
    assert login(client, "emp@example.com", "Another-pass-1")
    assert audit(db, "core.password_reset") == [{"target_user_id": user.id}]


def test_tokens_without_tv_are_valid_at_version_zero(client, db, emp):
    user, _ = emp
    settings_secret = os.environ["HUB_JWT_SECRET"]
    exp = datetime.now(UTC) + timedelta(minutes=30)
    legacy = jwt.encode({"sub": str(user.id), "exp": exp}, settings_secret, algorithm=ALGORITHM)  # как до 0008: без tv
    assert client.get("/core/me", headers=bearer(legacy)).status_code == 200
    explicit_zero = jwt.encode({"sub": str(user.id), "tv": 0, "exp": exp}, settings_secret, algorithm=ALGORITHM)
    assert client.get("/core/me", headers=bearer(explicit_zero)).status_code == 200
    ahead = jwt.encode({"sub": str(user.id), "tv": 1, "exp": exp}, settings_secret, algorithm=ALGORITHM)
    assert client.get("/core/me", headers=bearer(ahead)).status_code == 401  # версия не совпадает
    db.execute(text("UPDATE trendsetter_hub.users SET token_version = 1 WHERE id = :i"), {"i": user.id})
    db.commit()
    assert client.get("/core/me", headers=bearer(legacy)).status_code == 401  # после смены пароля токен без tv недействителен
    assert client.get("/core/me", headers=bearer(ahead)).status_code == 200


# ---------- журнал ----------


def test_sensitive_view_and_documents_list_are_logged(client, db, resp, person):
    assert client.get(f"{BASE}/people/{person}/sensitive", headers=resp).status_code == 200
    assert client.get(f"{BASE}/people/{person}/documents", headers=resp).status_code == 200
    assert audit(db, "hr.sensitive_view") == [{"person_id": person}]
    assert audit(db, "hr.documents_list") == [{"person_id": person}]
    # запись после правки не плодит «просмотров»: ответ PATCH — не просмотр
    assert client.patch(f"{BASE}/people/{person}/sensitive", json={"payDay1": 5}, headers=resp).status_code == 200
    assert len(audit(db, "hr.sensitive_view")) == 1
    # неуспешный доступ не пишет просмотр
    assert client.get(f"{BASE}/people/999999/sensitive", headers=resp).status_code == 404
    assert len(audit(db, "hr.sensitive_view")) == 1


def test_audit_access_rights(client, db, admin, hr, resp):
    make_user(db, "v@example.com", "viewer")
    make_user(db, "o@example.com", "employee")
    url = f"{BASE}/audit"
    assert client.get(url).status_code == 401
    assert client.get(url, headers=resp).status_code == 200
    assert client.get(url, headers=admin).status_code == 200
    for who in (hr, login(client, "v@example.com"), login(client, "o@example.com")):
        assert client.get(url, headers=who).status_code == 403


def insert_audit(db, action, details, user_id=None, at=None):
    db.execute(
        text("INSERT INTO trendsetter_hub.audit_log (user_id, action, details, at) VALUES (:u, :a, CAST(:d AS jsonb), COALESCE(:t, now()))"),
        {"u": user_id, "a": action, "d": json.dumps(details), "t": at},
    )
    db.commit()


def test_audit_details_whitelist_and_scope(client, db, resp, person):
    insert_audit(
        db, "hr.document_download",
        {"person_id": person, "document_id": 7, "category": "contract", "title": "Секрет", "file_name": "secret.pdf", "value": "123", "fields": ["salary", "passport"]},
    )
    insert_audit(db, "warehouse.receipt_create", {"person_id": person})
    insert_audit(db, "login", {})
    insert_audit(db, "core.password_reset", {"target_user_id": 5, "password": "leak"})
    insert_audit(db, "hr.mystery_action", {"year": 2026, "count": 3, "rows": 10, "sensitive": True, "template_id": 4, "kind": "people", "x": 1})
    data = client.get(f"{BASE}/audit", headers=resp).json()
    by_action = {i["action"]: i for i in data["items"]}
    assert set(by_action) == {"hr.document_download", "core.password_reset", "hr.mystery_action", "core.user_permission_set"}  # склад и вход не охвачены
    assert data["total"] == 4
    d = by_action["hr.document_download"]
    assert d["details"] == {"person_id": person, "document_id": 7, "category": "contract", "fields": ["salary", "passport"]}
    assert d["label"] == "Документ скачан" and d["personId"] == person and d["personName"] == "Альфа Анна"
    assert by_action["core.password_reset"]["details"] == {} and by_action["core.password_reset"]["label"] == "Пароль сброшен администратором"
    assert by_action["core.password_reset"]["personId"] is None and by_action["core.password_reset"]["personName"] is None
    mystery = by_action["hr.mystery_action"]
    assert mystery["label"] == "hr.mystery_action"  # неизвестное действие — своим кодом
    assert mystery["details"] == {"year": 2026, "count": 3, "rows": 10, "sensitive": True, "template_id": 4, "kind": "people"}
    assert set(d) == {"id", "at", "userName", "action", "label", "personId", "personName", "details"}
    blob = json.dumps([{k: v for k, v in i.items() if k != "at"} for i in data["items"]], ensure_ascii=False)  # без времени: в микросекундах случайно встречается «123»
    for secret in ("Секрет", "secret.pdf", "leak", "123"):
        assert secret not in blob


def test_audit_filters_and_pagination(client, db, resp, person):
    other = add_person(db, "Борис", "Бета")
    base = datetime(2026, 3, 10, 12, 0, tzinfo=UTC)
    for i in range(5):
        insert_audit(db, "hr.sensitive_view", {"person_id": person}, at=base + timedelta(days=i))
    insert_audit(db, "hr.document_upload", {"person_id": other, "document_id": 1, "category": "tax"}, at=base)
    url = f"{BASE}/audit"
    get = lambda q: client.get(f"{url}?{q}", headers=resp)  # noqa: E731
    assert get(f"personId={other}").json()["total"] == 1
    assert get(f"personId={person}&action=hr.sensitive_view").json()["total"] == 5
    assert get("action=hr.document_upload").json()["items"][0]["personName"] == "Бета Борис"
    assert get("action=warehouse.receipt_create").json() == {"items": [], "total": 0}
    both = get(f"personId={other}&action=hr.document_upload,hr.sensitive_view,hr.nothing_here").json()  # список действий через запятую
    assert both["total"] == 1
    assert get(f"personId={person}&action=hr.document_upload, hr.sensitive_view").json()["total"] == 5
    assert get("action=" + ",".join(f"hr.a{chr(97 + i % 26)}" for i in range(40))).status_code == 200
    assert get("action=" + ",".join(["hr.x"] * 41)).status_code == 422
    for bad in ("hr", "HR.x", "hr.x;drop", "hr.x,,hr.y", "hr.x,bad", "hr.1"):
        assert get(f"action={bad}").status_code == 422, bad
    page = get(f"personId={person}&limit=2&offset=0").json()
    assert page["total"] == 5 and len(page["items"]) == 2
    page2 = get(f"personId={person}&limit=2&offset=2").json()
    assert len(page2["items"]) == 2 and not {i["id"] for i in page["items"]} & {i["id"] for i in page2["items"]}
    assert get(f"personId={person}&limit=2&offset=4").json()["items"].__len__() == 1
    ats = [i["at"] for i in get(f"personId={person}").json()["items"]]
    assert ats == sorted(ats, reverse=True)  # новые сверху
    # период включает обе границы (по часовому поясу хаба)
    assert get(f"personId={person}&from=2026-03-11&to=2026-03-12").json()["total"] == 2
    assert get(f"personId={person}&from=2026-03-13").json()["total"] == 2
    assert get(f"personId={person}&to=2026-03-10").json()["total"] == 1
    assert get("from=2026-13-40").status_code == 422
    assert get("limit=201").status_code == 422 and get("limit=0").status_code == 422 and get("offset=-1").status_code == 422
    assert get("limit=200").status_code == 200


def test_audit_view_is_logged_without_filters(client, db, resp, person):
    first = client.get(f"{BASE}/audit?personId={person}", headers=resp).json()
    assert all(i["action"] != "hr.audit_view" for i in first["items"])
    assert audit(db, "hr.audit_view") == [{}]  # без фильтров и значений
    second = client.get(f"{BASE}/audit", headers=resp).json()
    assert any(i["action"] == "hr.audit_view" and i["label"] == "Просмотр журнала" for i in second["items"])


def test_audit_denied_request_is_not_logged(client, db, hr):
    assert client.get(f"{BASE}/audit", headers=hr).status_code == 403
    assert audit(db, "hr.audit_view") == []


# ---------- автоистория оклада ----------


def history(client, headers, person):
    return client.get(f"{BASE}/people/{person}/history", headers=headers).json()


def salary_rows(client, headers, person):
    return [h for h in history(client, headers, person) if h["kind"] == "salary"]


def test_salary_history_created_changed_unchanged(client, db, resp, person):
    url = f"{BASE}/people/{person}/sensitive"
    assert client.patch(url, json={"salary": 120000, "currency": "RUB"}, headers=resp).status_code == 200
    rows = salary_rows(client, resp, person)
    assert len(rows) == 1
    first = rows[0]
    assert first["auto"] is True and first["title"] == "Изменение оклада" and first["oldValue"] is None and first["newValue"] == "120000.00"
    assert first["effectiveDate"] == datetime.now().date().isoformat()
    # без изменений (те же значения, другие поля) — новой записи нет
    assert client.patch(url, json={"salary": 120000, "currency": "RUB", "payDay1": 5}, headers=resp).status_code == 200
    assert client.patch(url, json={"payDay2": 20, "taxId": SECRET_TAX}, headers=resp).status_code == 200
    assert len(salary_rows(client, resp, person)) == 1
    # смена оклада
    assert client.patch(url, json={"salary": 130000.5}, headers=resp).status_code == 200
    rows = salary_rows(client, resp, person)
    assert len(rows) == 2 and rows[0]["oldValue"] == "120000.00" and rows[0]["newValue"] == "130000.50"
    # только валюта
    assert client.patch(url, json={"currency": "AMD"}, headers=resp).status_code == 200
    rows = salary_rows(client, resp, person)
    assert len(rows) == 3 and rows[0]["oldValue"] == "130000.50" and rows[0]["newValue"] == "130000.50"  # сумма без валюты
    # значения не попали в журнал
    assert "130000" not in json.dumps(audit(db, "hr.sensitive_update"))


def test_salary_history_visible_only_to_responsible(client, db, hr, resp, person):
    assert client.patch(f"{BASE}/people/{person}/sensitive", json={"salary": 1000, "currency": "USD"}, headers=resp).status_code == 200
    assert len(salary_rows(client, resp, person)) == 1
    assert salary_rows(client, hr, person) == []
    assert "1000.00" not in json.dumps(history(client, hr, person))


# ---------- шифрование ----------


def raw_sensitive(db, person):
    db.expire_all()
    return db.execute(text("SELECT * FROM trendsetter_hub.hr_employee_sensitive WHERE person_id = :p"), {"p": person}).mappings().one()


def raw_content(db, doc_id) -> bytes:
    db.expire_all()
    return bytes(db.execute(text("SELECT content FROM trendsetter_hub.hr_document_files WHERE document_id = :i"), {"i": doc_id}).scalar_one())


def fill(client, resp, person):
    body = {"salary": 777777.5, "currency": "RUB", "passport": SECRET_PASSPORT, "taxId": SECRET_TAX, "socialId": "СНИЛС-555", "bankDetails": "СЧЁТ-42", "bonusNote": "премия-секрет"}
    r = client.patch(f"{BASE}/people/{person}/sensitive", json=body, headers=resp)
    assert r.status_code == 200, r.text
    return body


def test_sensitive_fields_stored_encrypted_api_returns_plain(client, db, resp, person):
    body = fill(client, resp, person)
    row = raw_sensitive(db, person)
    for col in ("passport", "tax_id", "social_id", "bank_details", "bonus_note"):
        assert row[col].startswith("enc:v1:"), col
    assert SECRET_PASSPORT not in json.dumps(dict(row), default=str) and SECRET_TAX not in json.dumps(dict(row), default=str)
    assert float(row["salary"]) == 777777.5 and row["currency"] == "RUB"  # оклад и валюта не шифруются (TODO Q-S1)
    got = client.get(f"{BASE}/people/{person}/sensitive", headers=resp).json()
    assert got["passport"] == body["passport"] and got["taxId"] == body["taxId"] and got["bankDetails"] == "СЧЁТ-42" and got["salary"] == 777777.5
    # очистка поля — NULL, а не шифр пустой строки
    assert client.patch(f"{BASE}/people/{person}/sensitive", json={"passport": None}, headers=resp).status_code == 200
    assert raw_sensitive(db, person)["passport"] is None


def test_document_content_stored_encrypted_download_same_bytes(client, db, resp, person):
    d = upload(client, resp, person).json()
    stored = raw_content(db, d["id"])
    assert stored.startswith(b"ENC1\n") and PDF not in stored
    assert d["sizeBytes"] == len(PDF)
    import base64

    got = client.get(f"{BASE}/documents/{d['id']}", headers=resp).json()
    assert base64.b64decode(got["dataBase64"]) == PDF and got["sizeBytes"] == len(PDF)


def test_plaintext_legacy_values_are_still_readable(client, db, resp, person):
    d = upload(client, resp, person).json()
    db.execute(text("UPDATE trendsetter_hub.hr_document_files SET content = :c WHERE document_id = :i"), {"c": PDF, "i": d["id"]})
    db.execute(
        text("INSERT INTO trendsetter_hub.hr_employee_sensitive (person_id, passport, tax_id) VALUES (:p, 'ОТКРЫТЫЙ 1', '123')"), {"p": person}
    )
    db.commit()
    import base64

    assert base64.b64decode(client.get(f"{BASE}/documents/{d['id']}", headers=resp).json()["dataBase64"]) == PDF
    got = client.get(f"{BASE}/people/{person}/sensitive", headers=resp).json()
    assert got["passport"] == "ОТКРЫТЫЙ 1" and got["taxId"] == "123"


def test_without_key_writes_return_503_but_other_fields_work(client, db, resp, person, monkeypatch):
    key = pii_key()
    monkeypatch.delenv("HUB_PII_KEY")
    url = f"{BASE}/people/{person}/sensitive"
    r = client.patch(url, json={"passport": SECRET_PASSPORT}, headers=resp)
    assert r.status_code == 503 and r.json() == {"detail": m.ENCRYPTION_NOT_CONFIGURED}
    assert client.patch(url, json={"salary": 500, "currency": "AMD", "payDay1": 3}, headers=resp).status_code == 200  # без ПДн-текста ключ не нужен
    assert client.patch(url, json={"salary": 600, "taxId": SECRET_TAX}, headers=resp).status_code == 503
    assert raw_sensitive(db, person)["passport"] is None and float(raw_sensitive(db, person)["salary"]) == 500  # неудачный PATCH ничего не записал
    r = upload(client, resp, person)
    assert r.status_code == 503 and r.json() == {"detail": m.ENCRYPTION_NOT_CONFIGURED}
    assert raw(db, "SELECT count(*) FROM trendsetter_hub.hr_documents")[0][0] == 0
    # открытые значения читаются и без ключа; зашифрованные — 503
    db.execute(text("UPDATE trendsetter_hub.hr_employee_sensitive SET passport = 'ОТКРЫТЫЙ' WHERE person_id = :p"), {"p": person})
    db.commit()
    assert client.get(url, headers=resp).json()["passport"] == "ОТКРЫТЫЙ"
    monkeypatch.setenv("HUB_PII_KEY", key)
    client.patch(url, json={"taxId": SECRET_TAX}, headers=resp)
    monkeypatch.delenv("HUB_PII_KEY")
    assert client.get(url, headers=resp).status_code == 503


def test_wrong_key_gives_500_without_details(client, db, resp, person, monkeypatch, caplog):
    fill(client, resp, person)
    d = upload(client, resp, person).json()
    token = raw_sensitive(db, person)["tax_id"]
    monkeypatch.setenv("HUB_PII_KEY", OTHER_KEY)
    for r in (client.get(f"{BASE}/people/{person}/sensitive", headers=resp), client.get(f"{BASE}/documents/{d['id']}", headers=resp)):
        assert r.status_code == 500 and r.json() == {"detail": m.DECRYPT_FAILED}
        for leak in (OTHER_KEY, pii_key(), token, SECRET_TAX, "InvalidToken"):
            assert leak not in r.text
    logs = caplog.text
    for leak in (OTHER_KEY, pii_key(), token, SECRET_TAX):
        assert leak not in logs
    assert "DecryptError" in logs  # в лог — только тип ошибки


def test_key_rotation_with_two_keys(client, db, resp, person, monkeypatch):
    old_key = pii_key()
    fill(client, resp, person)
    d = upload(client, resp, person).json()
    new_key = Fernet.generate_key().decode()
    monkeypatch.setenv("HUB_PII_KEY", f"{new_key}, {old_key}")  # первый шифрует, остальные только читают
    url = f"{BASE}/people/{person}/sensitive"
    assert client.get(url, headers=resp).json()["passport"] == SECRET_PASSPORT  # старые данные читаются
    assert client.patch(url, json={"passport": "НОВЫЙ 777"}, headers=resp).status_code == 200
    d2 = upload(client, resp, person).json()
    monkeypatch.setenv("HUB_PII_KEY", new_key)  # старый ключ убран: новые данные читаются, старые уже нет
    assert client.get(f"{BASE}/documents/{d2['id']}", headers=resp).status_code == 200
    assert client.get(f"{BASE}/documents/{d['id']}", headers=resp).status_code == 500
    assert client.get(url, headers=resp).status_code == 500  # в строке остались поля, зашифрованные старым ключом
    monkeypatch.setenv("HUB_PII_KEY", f"{old_key},{new_key}")
    assert client.get(url, headers=resp).json()["passport"] == "НОВЫЙ 777"  # порядок ключей не мешает чтению


def test_malformed_key_is_treated_as_not_configured(client, resp, person, monkeypatch):
    monkeypatch.setenv("HUB_PII_KEY", "not-a-fernet-key")
    r = client.patch(f"{BASE}/people/{person}/sensitive", json={"passport": "X1"}, headers=resp)
    assert r.status_code == 503 and "not-a-fernet-key" not in r.text


def test_key_never_in_journal_or_responses(client, db, resp, person):
    fill(client, resp, person)
    d = upload(client, resp, person).json()
    bodies = [
        client.get(f"{BASE}/people/{person}/sensitive", headers=resp).text,
        client.get(f"{BASE}/people/{person}/documents", headers=resp).text,
        client.get(f"{BASE}/documents/{d['id']}", headers=resp).text,
        client.get(f"{BASE}/audit", headers=resp).text,
        client.get(f"{BASE}/export/people", headers=resp).text,
    ]
    journal = json.dumps([r[0] for r in raw(db, "SELECT details FROM trendsetter_hub.audit_log")], ensure_ascii=False)
    for text_ in bodies + [journal]:
        assert pii_key() not in text_ and "enc:v1:" not in text_


# ---------- encrypt_existing ----------


def seed_plaintext(client, db, resp, person):
    """Одна строка досье с открытыми полями и одним уже зашифрованным, два документа: открытый и зашифрованный."""
    plain_doc = upload(client, resp, person).json()["id"]
    enc_doc = upload(client, resp, person, title="Второй").json()["id"]
    assert client.patch(f"{BASE}/people/{person}/sensitive", json={"bankDetails": "СЧЁТ-42"}, headers=resp).status_code == 200  # зашифровано
    db.execute(
        text("UPDATE trendsetter_hub.hr_employee_sensitive SET passport = :p, tax_id = :t WHERE person_id = :i"),
        {"p": SECRET_PASSPORT, "t": SECRET_TAX, "i": person},
    )
    db.execute(text("UPDATE trendsetter_hub.hr_document_files SET content = :c WHERE document_id = :i"), {"c": PDF, "i": plain_doc})
    db.commit()
    return plain_doc, enc_doc


def test_encrypt_existing_dry_run_apply_and_rerun(client, db, resp, person):
    from app.modules.hr import encrypt_existing

    plain_doc, enc_doc = seed_plaintext(client, db, resp, person)
    before = dict(raw_sensitive(db, person))
    dry = encrypt_existing.run(db, apply=False)
    assert dry == {"fields_encrypted": 2, "fields_already": 1, "documents_encrypted": 1, "documents_already": 1}
    assert dict(raw_sensitive(db, person)) == before and raw_content(db, plain_doc) == PDF  # сухой прогон ничего не пишет
    assert audit(db, "hr.encrypt_existing") == []

    applied = encrypt_existing.run(db, apply=True)
    assert applied == dry
    row = raw_sensitive(db, person)
    assert row["passport"].startswith("enc:v1:") and row["tax_id"].startswith("enc:v1:") and row["bank_details"] == before["bank_details"]
    assert raw_content(db, plain_doc).startswith(b"ENC1\n") and raw_content(db, enc_doc).startswith(b"ENC1\n")
    got = client.get(f"{BASE}/people/{person}/sensitive", headers=resp).json()
    assert got["passport"] == SECRET_PASSPORT and got["taxId"] == SECRET_TAX and got["bankDetails"] == "СЧЁТ-42"
    import base64

    assert base64.b64decode(client.get(f"{BASE}/documents/{plain_doc}", headers=resp).json()["dataBase64"]) == PDF
    assert audit(db, "hr.encrypt_existing") == [applied]  # в журнале только счётчики

    again = encrypt_existing.run(db, apply=True)
    assert again == {"fields_encrypted": 0, "fields_already": 3, "documents_encrypted": 0, "documents_already": 2}
    assert dict(raw_sensitive(db, person)) == dict(row)  # повторный запуск не перешифровывает (токены те же)


def test_encrypt_existing_cli_output_and_exit_codes(client, db, engine, resp, person, monkeypatch, capsys):
    from app.modules.hr import encrypt_existing

    key = pii_key()
    seed_plaintext(client, db, resp, person)
    monkeypatch.setattr(encrypt_existing, "get_engine", lambda: engine)
    assert encrypt_existing.main([]) == 0
    out = capsys.readouterr().out
    assert "сухой прогон" in out and "Поля досье: зашифровано 2, уже были зашифрованы 1" in out and "Документы: зашифровано 1, уже были зашифрованы 1" in out
    assert raw_sensitive(db, person)["passport"] == SECRET_PASSPORT  # без --apply осталось открытым
    assert encrypt_existing.main(["--apply"]) == 0
    out = capsys.readouterr().out
    assert "запись" in out and pii_key() not in out and SECRET_PASSPORT not in out and SECRET_TAX not in out
    assert raw_sensitive(db, person)["passport"].startswith("enc:v1:")
    monkeypatch.delenv("HUB_PII_KEY")
    assert encrypt_existing.main(["--apply"]) == 2
    err = capsys.readouterr().err
    assert "HUB_PII_KEY" in err and key not in err
