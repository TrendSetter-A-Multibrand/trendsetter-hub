"""Модуль «Wildberries», раздел «Маркировка»: сверка продаж и возвратов FBS с кодами маркировки для «Честного ЗНАКа».

Источники (public, только чтение):
  api_wb_FinanceReport — отчёт о реализации: продажи/возвраты с кодом маркировки (kiz) и srid;
  api_wb_Orders_FBS    — сборочные задания FBS, связь rid = srid;
  api_wb_ExciseReport  — отчёт WB о товарах с маркировкой (excise_short, srid, operation_type_id 1 — вывод, 2 — возврат).
Сверка детерминированная (без LLM). Номера документов «Честного ЗНАКа» — в trendsetter_hub.wb_marking_documents.
TODO(Q6): правила «странных КМ» сверить с запросом, по которому сверяли через ИИ; сейчас — «продан дважды» и «нет в отчёте о маркировке».
"""
from collections import defaultdict
from datetime import date, timedelta

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.audit import log_action
from app.core.models import User
from app.modules.wb.reports import reports_connection

MODULE_ID = "wb"
MIN_DATE = date(2026, 8, 1)  # раньше данных FBS и маркировки в хабе не сверяем
FRESHNESS_DAYS = 31  # за сколько дней до конца периода искать последнюю дату отчёта о реализации
IMPORT_MAX_ROWS = 20000
LISTS = ("withdraw", "return")
GS = "\x1d"  # разделитель групп в полном коде маркировки
SALE, RETURN = "Продажа", "Возврат"

PERIOD_INVALID = "Неверный период: начало позже конца или раньше 01.08.2026"
IMPORT_TOO_LARGE = "В файле больше 20 000 строк — разбейте его на части"
KEY_INVALID = "Строка сверки не найдена"

FINANCE_SQL = text("""
    SELECT DISTINCT ON (f.srid, f.kiz, f.doc_type_name)
           f.sale_dt, f.doc_type_name, f.nm_id, f.sa_name, f.subject_name, f.kiz, f.srid,
           f.retail_price_withdisc_rub, f.assembly_id, o.id AS fbs_id
    FROM public."api_wb_FinanceReport" f
    LEFT JOIN (SELECT DISTINCT ON (rid) rid, id FROM public."api_wb_Orders_FBS" ORDER BY rid, id) o ON o.rid = f.srid
    WHERE f.sale_dt BETWEEN :date_from AND :date_to
      AND f.kiz <> '' AND f.doc_type_name IN ('Продажа', 'Возврат')
    ORDER BY f.srid, f.kiz, f.doc_type_name, f.rrd_id DESC
""")
EXCISE_SQL = text("""
    SELECT excise_short, srid, operation_type_id FROM public."api_wb_ExciseReport" WHERE excise_short = ANY(:codes)
""")
CODE_PREFIX_LEN = 18  # 01 + GTIN(14) + 21


def short_code(kiz: str) -> str:
    """Код маркировки без криптохвоста: часть до первого разделителя GS (01 + GTIN + 21 + серийный номер)."""
    return kiz.split(GS, 1)[0].strip()


def _price(value) -> float:
    try:
        return round(float(str(value).replace(",", ".")), 2)
    except (TypeError, ValueError):
        return 0.0


def reconcile(
    rows: list[dict], excise: set[tuple[str, str, int]] | None, excise_last: date | None, excise_first: date | None = None
) -> list[dict]:
    """Строки отчёта о реализации -> строки сверки. Только FBS (есть сборочное задание): FBO WB выводит из оборота сам.

    excise — {(код, srid, operation_type_id)} или None, если отчёта о маркировке нет; сверяются только строки в пределах
    [excise_first, excise_last]: позже — отчёт ещё не догнал продажи, раньше — его ещё не загружали.
    """
    items = []
    for r in rows:
        assembly = r["fbs_id"] or (r["assembly_id"] if (r["assembly_id"] or 0) > 0 else None)
        if assembly is None:
            continue
        km = short_code(r["kiz"])
        list_ = "withdraw" if r["doc_type_name"] == SALE else "return"
        items.append({
            "key": f"{list_}:{r['srid']}:{km}",
            "list": list_,
            "km": km,
            "nm_id": r["nm_id"],
            "sa_name": r["sa_name"] or "",
            "title": r["subject_name"] or "",
            "date": r["sale_dt"].isoformat(),
            "price": _price(r["retail_price_withdisc_rub"]),
            "assembly_id": assembly,
            "srid": r["srid"],
            "reason": None,
        })
    items.sort(key=lambda it: (it["date"], it["list"] == "withdraw", it["key"]))  # в один день возврат раньше продажи

    sold = defaultdict(bool)  # код сейчас продан (не возвращён) — по событиям периода
    for it in items:
        if it["list"] == "withdraw":
            if sold[it["km"]]:
                it["reason"] = "soldTwice"
            sold[it["km"]] = True
        else:
            sold[it["km"]] = False
        operation = 1 if it["list"] == "withdraw" else 2
        if (
            it["reason"] is None and excise is not None and excise_last is not None and it["date"] <= excise_last.isoformat()
            and (excise_first is None or it["date"] >= excise_first.isoformat())
            and (it["km"], it["srid"], operation) not in excise
        ):
            it["reason"] = "notInExcise"
    for it in items:
        if it["reason"]:
            it["list"] = "strange"
    return items


def _excise_available(conn) -> bool:
    return conn.execute(text("""SELECT to_regclass('public."api_wb_ExciseReport"') IS NOT NULL""")).scalar()


def marking(session: Session, date_from: date, date_to: date) -> dict:
    if date_from > date_to or date_from < MIN_DATE:
        raise HTTPException(422, PERIOD_INVALID)
    with reports_connection() as conn:
        rows = [dict(r._mapping) for r in conn.execute(FINANCE_SQL, {"date_from": date_from, "date_to": date_to})]
        # свежесть источников: последняя дата данных (запросы по индексированным колонкам или небольшой таблице FBS)
        finance_last = conn.execute(
            text('SELECT max(sale_dt) FROM public."api_wb_FinanceReport" WHERE sale_dt >= :since'),
            {"since": date_to - timedelta(days=FRESHNESS_DAYS)},
        ).scalar()
        fbs_last = conn.execute(text('SELECT max(left("createdAt", 10)) FROM public."api_wb_Orders_FBS"')).scalar()
        excise, excise_first, excise_last = None, None, None
        if _excise_available(conn):
            excise_first, excise_last = conn.execute(text('SELECT min(fiscal_dt), max(fiscal_dt) FROM public."api_wb_ExciseReport"')).one()
            codes = sorted({short_code(r["kiz"]) for r in rows})
            excise = {(c, s, int(op)) for c, s, op in conn.execute(EXCISE_SQL, {"codes": codes})} if codes else set()

    items = reconcile(rows, excise, excise_last, excise_first)
    keys = [it["key"] for it in items if it["list"] != "strange"]
    codes = sorted({it["km"] for it in items if it["list"] != "strange"})
    documents = dict(session.execute(
        text("SELECT item_key, document FROM trendsetter_hub.wb_marking_documents WHERE item_key = ANY(:keys)"), {"keys": keys}
    ).all()) if keys else {}
    # загруженные из Excel: по списку и коду; номер, внесённый по строке в хабе, важнее
    imported = {(lst, km): doc for lst, km, doc in session.execute(
        text("SELECT list, km, document FROM trendsetter_hub.wb_marking_imported WHERE km = ANY(:codes)"), {"codes": codes}
    ).all()} if codes else {}
    for it in items:
        it["document"] = documents.get(it["key"]) or imported.get((it["list"], it["km"]), "") if it["list"] != "strange" else ""

    def iso(d):
        return d.isoformat() if isinstance(d, date) else d

    return {
        "from": date_from.isoformat(),
        "to": date_to.isoformat(),
        "sources": {
            "fbs": {"table": "api_wb_Orders_FBS", "lastDate": iso(fbs_last)},
            "finance": {"table": "api_wb_FinanceReport", "lastDate": iso(finance_last)},
            "excise": {"table": "api_wb_ExciseReport", "lastDate": iso(excise_last)},
        },
        "items": items,
    }


def set_document(session: Session, user: User, key: str, document: str) -> dict:
    """Номер документа «Честного ЗНАКа» по строке сверки; пустой — снять отметку."""
    list_ = key.split(":", 1)[0]
    if list_ not in LISTS or key.count(":") < 2:
        raise HTTPException(422, KEY_INVALID)
    if document:
        session.execute(text("""
            INSERT INTO trendsetter_hub.wb_marking_documents (item_key, list, document, updated_by)
            VALUES (:key, :list, :document, :user_id)
            ON CONFLICT (item_key) DO UPDATE SET document = EXCLUDED.document, updated_by = EXCLUDED.updated_by, updated_at = now()
        """), {"key": key, "list": list_, "document": document, "user_id": user.id})
    else:
        session.execute(text("DELETE FROM trendsetter_hub.wb_marking_documents WHERE item_key = :key"), {"key": key})
    log_action(session, user.id, "wb.marking_document", MODULE_ID, key=key, document=document)
    session.commit()
    return {"key": key, "document": document}


def import_codes(session: Session, user: User, list_: str, rows: list[tuple[str, str]]) -> dict:
    """Коды, выведенные (возвращённые) вне хаба, из Excel: [(код, номер документа)]. Повтор кода — номер обновляется."""
    if len(rows) > IMPORT_MAX_ROWS:
        raise HTTPException(422, IMPORT_TOO_LARGE)
    clean = {}
    skipped = 0
    for km, document in rows:
        km, document = short_code(km), document.strip()
        if len(km) <= CODE_PREFIX_LEN or not km.startswith("01") or not document or len(document) > 100 or len(km) > 200:
            skipped += 1
            continue
        clean[km] = document  # в файле код повторяется — берём последний номер
    if clean:
        session.execute(text("""
            INSERT INTO trendsetter_hub.wb_marking_imported (list, km, document, imported_by)
            SELECT :list, km, document, :user_id FROM unnest(CAST(:codes AS text[]), CAST(:documents AS text[])) AS t(km, document)
            ON CONFLICT (list, km) DO UPDATE SET document = EXCLUDED.document, imported_by = EXCLUDED.imported_by, imported_at = now()
        """), {"list": list_, "codes": list(clean), "documents": list(clean.values()), "user_id": user.id})
    log_action(session, user.id, "wb.marking_import", MODULE_ID, list=list_, saved=len(clean), skipped=skipped)
    session.commit()
    return {"saved": len(clean), "skipped": skipped}
