"""Модуль «Склад»: серверная часть приёмки. Перенос функций Code.gs (Google Apps Script) на PostgreSQL.

Атомарность, которую раньше давал LockService, обеспечивают база и транзакции:
  номер короба — warehouse_next_box_number(); код ЧЗ — первичный ключ (INSERT ... ON CONFLICT DO NOTHING);
  палет — транзакционная блокировка pg_advisory_xact_lock; повтор отправки скана — первичный ключ id.
Все таблицы в схеме trendsetter_hub с приставкой warehouse_ (db/modules/warehouse/001_warehouse.sql).
"""
import hmac
import json
import re
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.audit import log_action
from app.core.models import User

PALLETS = 6
LOCK_STORAGE = 90011  # ключ advisory-блокировки для операций с палетами/секциями
MODULE_ID = "warehouse"
KI_RE = re.compile(r"^01\d{14}21.")

STATUS_BY_LABEL = {"в файле": "ok", "нет в файле": "unknown", "излишек": "extra", "нет в файле (чужой код ЧЗ)": "foreign"}


def cap(pallet: int) -> int:
    return 16 if pallet <= 3 else 12


def part(value) -> str:
    """Категория для номеров: 5 → '05', нецифровые значения очищаются (как part_ в Code.gs)."""
    s = str(value)
    return f"{int(s):02d}" if s.isdigit() else re.sub(r"[^0-9A-Za-z-]", "", s)


def key(value) -> str:
    s = str(value)
    return str(int(s)) if s.isdigit() else s


def fmt(dt: datetime | None) -> str:
    if dt is None:
        return ""
    return dt.astimezone(ZoneInfo(get_settings().timezone)).strftime("%d.%m.%Y %H:%M")


def ms(dt: datetime | None) -> int:
    return int(dt.timestamp() * 1000) if dt else int(time.time() * 1000)


def _from_ms(value) -> datetime:
    return datetime.fromtimestamp(float(value) / 1000, tz=ZoneInfo("UTC"))


def fail(status: int, message: str):
    raise HTTPException(status, message)


def check_pin(pin) -> None:
    configured = get_settings().warehouse_pin
    if not configured:
        fail(403, "ПИН ответственного не настроен на сервере")
    if not hmac.compare_digest(str(pin or ""), configured):
        fail(403, "Неверный ПИН")


def _lock(session: Session) -> None:
    session.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": LOCK_STORAGE})


def receipt_id(session: Session, name: str) -> int:
    rid = session.execute(text("SELECT id FROM trendsetter_hub.warehouse_receipts WHERE lower(name) = lower(:n)"), {"n": name}).scalar()
    if rid is None:
        fail(422, f"Приемка «{name}» не найдена")
    return rid


# ---------- приёмки ----------


def list_receipts(session: Session) -> list[dict]:
    rows = session.execute(
        text(
            """SELECT r.name, r.created_at, COALESCE(u.full_name, u.email, '') AS by
               FROM trendsetter_hub.warehouse_receipts r LEFT JOIN trendsetter_hub.users u ON u.id = r.created_by
               WHERE r.status = 'open' ORDER BY r.created_at DESC, r.id DESC"""
        )
    ).all()
    return [{"name": r.name, "created": fmt(r.created_at), "by": r.by} for r in rows]


def create_receipt(session: Session, user: User, name: str) -> str:
    name = re.sub(r"\s+", " ", (name or "").strip())[:80]
    if not name:
        fail(422, "Пустое название")
    existing = session.execute(
        text("SELECT id, name, status FROM trendsetter_hub.warehouse_receipts WHERE lower(name) = lower(:n)"), {"n": name}
    ).first()
    if existing:
        if existing.status != "open":
            session.execute(text("UPDATE trendsetter_hub.warehouse_receipts SET status = 'open' WHERE id = :i"), {"i": existing.id})
            session.commit()
        return existing.name
    session.execute(
        text("INSERT INTO trendsetter_hub.warehouse_receipts (name, created_by) VALUES (:n, :u) ON CONFLICT DO NOTHING"),
        {"n": name, "u": user.id},
    )
    log_action(session, user.id, "warehouse.receipt_create", MODULE_ID, name=name)
    session.commit()
    return session.execute(text("SELECT name FROM trendsetter_hub.warehouse_receipts WHERE lower(name) = lower(:n)"), {"n": name}).scalar_one()


def finish_receipt(session: Session, user: User, name: str) -> list[dict]:
    rid = receipt_id(session, name)
    session.execute(text("UPDATE trendsetter_hub.warehouse_receipts SET status = 'finished' WHERE id = :i"), {"i": rid})
    # раскладка больше не нужна — освобождаем место (как в исходном приложении)
    session.execute(text("DELETE FROM trendsetter_hub.warehouse_receipt_plans WHERE receipt_id = :i"), {"i": rid})
    log_action(session, user.id, "warehouse.receipt_finish", MODULE_ID, name=name)
    session.commit()
    return list_receipts(session)


# ---------- общая раскладка приёмки ----------


def _plan_row(session: Session, name: str):
    return session.execute(
        text(
            """SELECT p.version, p.file_name, p.worker, p.uploaded_at, p.data::text AS data, COALESCE(u.email, '') AS email
               FROM trendsetter_hub.warehouse_receipt_plans p
               JOIN trendsetter_hub.warehouse_receipts r ON r.id = p.receipt_id
               LEFT JOIN trendsetter_hub.users u ON u.id = p.uploaded_by
               WHERE lower(r.name) = lower(:n)"""
        ),
        {"n": name},
    ).first()


def _plan_info(row) -> dict:
    return {
        "version": row.version,
        "name": row.file_name,
        "by": (row.worker + " / " if row.worker else "") + row.email,
        "when": fmt(row.uploaded_at),
    }


def get_plan_info(session: Session, receipt: str) -> dict | None:
    row = _plan_row(session, receipt)
    return _plan_info(row) if row else None


def get_plan(session: Session, receipt: str) -> dict | None:
    row = _plan_row(session, receipt)
    if not row:
        return None
    return {**_plan_info(row), "json": row.data}


def save_plan(session: Session, user: User, receipt: str, plan_json: str, name: str, worker: str) -> dict:
    if not receipt:
        fail(422, "Сначала выберите приемку")
    try:
        json.loads(plan_json)
    except ValueError:
        fail(422, "Раскладка повреждена")
    rid = receipt_id(session, receipt)
    version = int(time.time() * 1000)
    session.execute(
        text(
            """INSERT INTO trendsetter_hub.warehouse_receipt_plans (receipt_id, version, file_name, data, uploaded_by, worker, uploaded_at)
               VALUES (:r, :v, :f, CAST(:d AS jsonb), :u, :w, now())
               ON CONFLICT (receipt_id) DO UPDATE SET version = :v, file_name = :f, data = CAST(:d AS jsonb),
                 uploaded_by = :u, worker = :w, uploaded_at = now()"""
        ),
        {"r": rid, "v": version, "f": name or "", "d": plan_json, "u": user.id, "w": worker or ""},
    )
    log_action(session, user.id, "warehouse.plan_save", MODULE_ID, receipt=receipt, file=name)
    session.commit()
    return {"version": version, "parts": 1}


# ---------- короба, палеты, хранение ----------


def next_box_code(session: Session, category: str) -> str:
    p = part(category)
    if not p:
        fail(422, "Некорректная категория")
    n = session.execute(text("SELECT trendsetter_hub.warehouse_next_box_number(:c)"), {"c": p}).scalar_one()
    session.commit()
    return f"{p}_{n:04d}"


def _stor_info(session: Session, pallet_code: str, box_code: str | None) -> dict:
    sec = pallet_code[1:3]
    p = int(pallet_code.split("_P")[1])
    boxes = session.execute(
        text("SELECT box_code FROM trendsetter_hub.warehouse_storage_boxes WHERE pallet_code = :c ORDER BY placed_at, box_code"),
        {"c": pallet_code},
    ).scalars().all()
    pos = boxes.index(box_code) + 1 if box_code in boxes else len(boxes)
    return {"code": pallet_code, "sector": sec, "pallet": p, "pos": pos, "cap": cap(p), "box": box_code or ""}


def assign_pallet(session: Session, user: User, o: dict) -> dict:
    """Назначить закрываемому коробу палет: сначала основная секция (= категория), затем дополнительные."""
    box = str(o["box"])
    _lock(session)
    ex = session.execute(
        text("SELECT pallet_code FROM trendsetter_hub.warehouse_storage_boxes WHERE box_code = :b"), {"b": box}
    ).scalar()
    if ex:  # короб уже стоит (повторное закрытие)
        return _stor_info(session, ex, box)
    cat = part(o["cat"])
    extra = session.execute(
        text("SELECT section FROM trendsetter_hub.warehouse_extra_sections WHERE category = :c ORDER BY assigned_at, section"), {"c": cat}
    ).scalars().all()
    rid = receipt_id(session, o["receipt"]) if o.get("receipt") else None
    if rid is None:
        fail(422, "Сначала выберите приемку")
    for sec in [cat, *extra]:
        cnt = {
            r.pallet_no: r.n
            for r in session.execute(
                text(
                    "SELECT pallet_no, count(*) AS n FROM trendsetter_hub.warehouse_storage_boxes WHERE section = :s GROUP BY pallet_no"
                ),
                {"s": sec},
            )
        }
        cur = session.execute(
            text("SELECT current_pallet FROM trendsetter_hub.warehouse_pallet_pointers WHERE section = :s"), {"s": sec}
        ).scalar() or 1
        pallet = 0
        for k in range(PALLETS):
            q = (cur - 1 + k) % PALLETS + 1
            if cnt.get(q, 0) < cap(q):
                pallet = q
                break
        if not pallet:
            continue
        if pallet != cur:
            session.execute(
                text(
                    """INSERT INTO trendsetter_hub.warehouse_pallet_pointers (section, current_pallet) VALUES (:s, :p)
                       ON CONFLICT (section) DO UPDATE SET current_pallet = :p"""
                ),
                {"s": sec, "p": pallet},
            )
        code = f"S{sec}_P{pallet}"
        final = f"S{sec}_K{cat}_P{pallet}_{box.split('_')[-1]}"
        session.execute(
            text(
                """INSERT INTO trendsetter_hub.warehouse_storage_boxes
                   (box_code, pallet_code, section, pallet_no, item_count, worker, placed_by, receipt_id, category)
                   VALUES (:b, :pc, :s, :p, :n, :w, :u, :r, :c)"""
            ),
            {"b": final, "pc": code, "s": sec, "p": pallet, "n": int(o["count"]), "w": str(o.get("pc") or ""), "u": user.id, "r": rid, "c": cat},
        )
        session.commit()
        return {"code": code, "sector": sec, "pallet": pallet, "pos": cnt.get(pallet, 0) + 1, "cap": cap(pallet), "box": final}
    session.rollback()
    fail(409, f"SECTOR_FULL:{int(cat) if cat.isdigit() else cat} Секция полностью заполнена. Обратитесь к ответственному склада.")


def box_info(session: Session, code: str) -> dict | None:
    row = session.execute(
        text(
            """SELECT b.category, b.item_count, r.name AS receipt,
                      (SELECT pallet_code FROM trendsetter_hub.warehouse_storage_boxes s WHERE s.box_code = b.code) AS pallet
               FROM trendsetter_hub.warehouse_boxes b JOIN trendsetter_hub.warehouse_receipts r ON r.id = b.receipt_id
               WHERE b.code = :c"""
        ),
        {"c": code},
    ).first()
    if not row:
        return None
    return {"box": row.category, "count": row.item_count, "receipt": row.receipt, "pallet": row.pallet or ""}


def reopen_box(session: Session, code: str) -> dict:
    """Повторно открыть закрытый короб: строка убирается из «Короба», место на палете сохраняется."""
    row = session.execute(
        text("SELECT category, item_count, opened_at FROM trendsetter_hub.warehouse_boxes WHERE code = :c"), {"c": code}
    ).first()
    if not row:
        fail(404, f"Короб {code} не найден среди закрытых")
    session.execute(text("DELETE FROM trendsetter_hub.warehouse_boxes WHERE code = :c"), {"c": code})
    pallet = session.execute(
        text("SELECT pallet_code FROM trendsetter_hub.warehouse_storage_boxes WHERE box_code = :c"), {"c": code}
    ).scalar()
    storage = _stor_info(session, pallet, code) if pallet else None
    session.commit()
    return {"box": row.category, "count": row.item_count, "opened": ms(row.opened_at), "storage": storage}


def box_pallets(session: Session, codes: list[str]) -> dict[str, str]:
    if not codes:
        return {}
    rows = session.execute(
        text("SELECT box_code, pallet_code FROM trendsetter_hub.warehouse_storage_boxes WHERE box_code = ANY(:c)"), {"c": codes}
    )
    return {r.box_code: r.pallet_code for r in rows}


def storage_list(session: Session) -> list[list]:
    rows = session.execute(
        text(
            """SELECT s.pallet_code, s.section, s.pallet_no, s.box_code, s.item_count, s.placed_at, r.name AS receipt, s.category
               FROM trendsetter_hub.warehouse_storage_boxes s JOIN trendsetter_hub.warehouse_receipts r ON r.id = s.receipt_id
               ORDER BY s.pallet_code, s.placed_at, s.box_code"""
        )
    )
    return [[r.pallet_code, r.section, r.pallet_no, r.box_code, r.item_count, fmt(r.placed_at), r.receipt, r.category] for r in rows]


def free_pallet(session: Session, user: User, code: str) -> dict:
    """Освободить палет: его короба уходят в архив, на палет снова можно ставить."""
    _lock(session)
    freed = session.execute(
        text(
            """WITH moved AS (
                 DELETE FROM trendsetter_hub.warehouse_storage_boxes WHERE pallet_code = :c RETURNING *
               )
               INSERT INTO trendsetter_hub.warehouse_storage_archive
                 (box_code, pallet_code, section, pallet_no, item_count, placed_at, worker, placed_by, receipt_id, category, freed_by)
               SELECT box_code, pallet_code, section, pallet_no, item_count, placed_at, worker, placed_by, receipt_id, category, :u FROM moved
               RETURNING id"""
        ),
        {"c": code, "u": user.id},
    ).all()
    log_action(session, user.id, "warehouse.pallet_free", MODULE_ID, pallet=code, boxes=len(freed))
    session.commit()
    return {"freed": len(freed)}


# ---------- дополнительные секции (по ПИН) ----------


def list_sectors(session: Session) -> list[dict]:
    rows = session.execute(
        text(
            """SELECT e.category, e.section,
                      (SELECT count(*) FROM trendsetter_hub.warehouse_storage_boxes s WHERE s.section = e.section) AS boxes
               FROM trendsetter_hub.warehouse_extra_sections e ORDER BY e.assigned_at, e.section"""
        )
    )
    return [{"cat": r.category, "sector": r.section, "boxes": r.boxes} for r in rows]


def add_sector(session: Session, user: User, cat, sector, pin, known: list, responsible: bool = False) -> list[dict]:
    if not responsible:  # TODO(Q-G3): ответственный по группе проходит без ПИН
        check_pin(pin)
    cat, sector = part(cat), part(sector)
    _lock(session)
    if sector == cat:
        fail(422, f"Секция {int(sector)} и так основная для категории {int(cat)}")
    cats = {part(k) for k in (known or [])}
    cats |= set(session.execute(text("SELECT DISTINCT category FROM trendsetter_hub.warehouse_boxes")).scalars().all())
    cats |= set(session.execute(text("SELECT DISTINCT category FROM trendsetter_hub.warehouse_storage_boxes")).scalars().all())
    if sector in {part(c) for c in cats}:
        fail(422, f"Секция {int(sector)} — основная секция категории {int(sector)}")
    taken = session.execute(
        text("SELECT category FROM trendsetter_hub.warehouse_extra_sections WHERE section = :s"), {"s": sector}
    ).scalar()
    if taken:
        fail(422, f"Секция {int(sector)} уже отдана категории {int(taken)}")
    other = session.execute(
        text("SELECT 1 FROM trendsetter_hub.warehouse_storage_boxes WHERE section = :s AND category <> :c LIMIT 1"), {"s": sector, "c": cat}
    ).scalar()
    if other:
        fail(422, f"В секции {int(sector)} уже стоят короба другой категории")
    session.execute(
        text("INSERT INTO trendsetter_hub.warehouse_extra_sections (section, category, assigned_by) VALUES (:s, :c, :u)"),
        {"s": sector, "c": cat, "u": user.id},
    )
    log_action(session, user.id, "warehouse.sector_add", MODULE_ID, category=cat, section=sector, via="group" if responsible else "pin")
    session.commit()
    return list_sectors(session)


def remove_sector(session: Session, user: User, cat, sector, pin, responsible: bool = False) -> list[dict]:
    if not responsible:  # TODO(Q-G3): ответственный по группе проходит без ПИН
        check_pin(pin)
    cat, sector = part(cat), part(sector)
    _lock(session)
    if session.execute(
        text("SELECT 1 FROM trendsetter_hub.warehouse_storage_boxes WHERE section = :s LIMIT 1"), {"s": sector}
    ).scalar():
        fail(422, f"В секции {int(sector)} ещё стоят короба — сначала освободите его палеты")
    session.execute(
        text("DELETE FROM trendsetter_hub.warehouse_extra_sections WHERE section = :s AND category = :c"), {"s": sector, "c": cat}
    )
    log_action(session, user.id, "warehouse.sector_remove", MODULE_ID, category=cat, section=sector, via="group" if responsible else "pin")
    session.commit()
    return list_sectors(session)


# ---------- Честный знак ----------


def register_mark(session: Session, user: User, m: dict) -> dict:
    """Регистрирует код ЧЗ. Если он уже принят где угодно на складе — возвращает, где и когда."""
    ki = m.get("ki") or ""
    if not KI_RE.match(ki):
        fail(422, "Неверный код Честного знака")
    rid = receipt_id(session, m["receipt"]) if m.get("receipt") else None
    inserted = session.execute(
        text(
            """INSERT INTO trendsetter_hub.warehouse_marks (ki, gtin, worker, user_id, receipt_id, box_category, full_code, barcode)
               VALUES (:ki, :g, :w, :u, :r, :b, :f, :e) ON CONFLICT (ki) DO NOTHING RETURNING ki"""
        ),
        {"ki": ki, "g": m.get("gtin") or ki[2:16], "w": str(m.get("pc") or ""), "u": user.id, "r": rid, "b": str(m.get("box") or ""), "f": m.get("full") or "", "e": m.get("ean") or ""},
    ).first()
    if inserted:
        session.commit()
        return {"status": "ok"}
    f = session.execute(
        text(
            """SELECT k.registered_at, k.worker, k.box_category, COALESCE(r.name, '') AS receipt
               FROM trendsetter_hub.warehouse_marks k LEFT JOIN trendsetter_hub.warehouse_receipts r ON r.id = k.receipt_id
               WHERE k.ki = :ki"""
        ),
        {"ki": ki},
    ).first()
    session.rollback()
    return {"status": "dup", "at": fmt(f.registered_at), "pc": f.worker, "box": f.box_category, "receipt": f.receipt}


# ---------- пакетная запись сканов (sync) ----------


def sync(session: Session, user: User, ops: list[dict], worker: str) -> dict:
    """Операции scan / undo / close из очереди клиента. Повторная доставка безопасна (первичные ключи)."""
    receipts: dict[str, int] = {}

    def rid(name: str) -> int:
        if name not in receipts:
            receipts[name] = receipt_id(session, name)
        return receipts[name]

    for o in ops:
        kind = o.get("op")
        if kind == "scan":
            session.execute(
                text(
                    """INSERT INTO trendsetter_hub.warehouse_scans
                       (id, scanned_at, worker, user_id, receipt_id, box_category, box_code, barcode, status, no_cz, ki, full_code)
                       VALUES (:id, :t, :w, :u, :r, :bc, :bcode, :bar, :st, :nz, :ki, :f) ON CONFLICT (id) DO NOTHING"""
                ),
                {
                    "id": str(o["id"]), "t": _from_ms(o["t"]), "w": str(o.get("pc") or worker or ""), "u": user.id, "r": rid(o["receipt"]),
                    "bc": str(o["box"]), "bcode": str(o["boxCode"]), "bar": str(o["bc"]),
                    "st": o["status"] if o["status"] in ("ok", "unknown", "extra", "foreign") else STATUS_BY_LABEL.get(str(o["status"]).split(",")[0], "unknown"),
                    "nz": bool(o.get("noCz")), "ki": o.get("ki") or None, "f": o.get("full") or None,
                },
            )
        elif kind == "undo":
            session.execute(text("DELETE FROM trendsetter_hub.warehouse_scans WHERE id = :i"), {"i": str(o["ref"])})
            if o.get("ki"):
                session.execute(text("DELETE FROM trendsetter_hub.warehouse_marks WHERE ki = :k"), {"k": o["ki"]})
        elif kind == "close":
            session.execute(
                text(
                    """INSERT INTO trendsetter_hub.warehouse_boxes (code, category, item_count, worker, opened_at, closed_at, closed_by, receipt_id)
                       VALUES (:c, :cat, :n, :w, :op, :cl, :u, :r) ON CONFLICT (code) DO NOTHING"""
                ),
                {
                    "c": str(o["boxCode"]), "cat": str(o["box"]), "n": int(o["count"]), "w": str(o.get("pc") or worker or ""),
                    "op": _from_ms(o["opened"]), "cl": _from_ms(o["closedAt"]), "u": user.id, "r": rid(o["receipt"]),
                },
            )
            tmp = o.get("tmp")
            if tmp and tmp != o["boxCode"]:
                # сканы открытого короба получают его итоговый номер S01_K01_P1_0014
                session.execute(
                    text("UPDATE trendsetter_hub.warehouse_scans SET box_code = :new WHERE box_code = :old"), {"new": str(o["boxCode"]), "old": str(tmp)}
                )
    session.commit()
    return {"ok": True}


# ---------- импорт старых коробов (по ПИН) ----------


def import_old(session: Session, user: User, d: dict, pin, responsible: bool = False) -> dict:
    if not responsible:  # TODO(Q-G3): ответственный по группе проходит без ПИН
        check_pin(pin)
    boxes = d.get("boxes") or []
    scans = d.get("scans") or []
    receipt_name = str(d.get("receipt") or "").strip()
    if not receipt_name:
        fail(422, "Нет названия приемки в файле импорта")
    _lock(session)
    codes = [b["code"] for b in boxes]
    # 1. Номера коробов не должны быть заняты
    taken = session.execute(
        text(
            """SELECT code FROM trendsetter_hub.warehouse_boxes WHERE code = ANY(:c)
               UNION SELECT box_code FROM trendsetter_hub.warehouse_storage_boxes WHERE box_code = ANY(:c)
               UNION SELECT box_code FROM trendsetter_hub.warehouse_scans WHERE box_code = ANY(:c)"""
        ),
        {"c": codes},
    ).scalars().all()
    if taken:
        fail(422, f"Короба уже есть в таблице (например {taken[0]}). Импорт уже сделан или номера заняты тестовыми данными — очистите тест и счётчики.")
    # 2. Счётчики категорий не должны обгонять импортируемые номера
    max_seq: dict[str, int] = {}
    for b in boxes:
        p = part(b["cat"])
        max_seq[p] = max(max_seq.get(p, 0), int(str(b["code"]).split("_")[-1]))
    for p in max_seq:
        cur = session.execute(text("SELECT last_number FROM trendsetter_hub.warehouse_box_counters WHERE category = :c"), {"c": p}).scalar() or 0
        if cur > 0:
            fail(422, f"Счётчик BOX_{p} уже = {cur}. Номера пересекутся — удалите тестовые строки счётчиков.")
    # 3. Палеты для закрытых коробов должны быть пустыми
    need = sorted({b["pallet"] for b in boxes if b.get("state") == "закрыт"})
    busy = session.execute(
        text("SELECT DISTINCT pallet_code FROM trendsetter_hub.warehouse_storage_boxes WHERE pallet_code = ANY(:p)"), {"p": need}
    ).scalars().all()
    if busy:
        fail(422, f"На палете {busy[0]} уже стоят короба — импорт рассчитан на пустой палет.")
    # 4. Коды ЧЗ не должны быть уже приняты
    kis = [s["ki"] for s in scans if s.get("ki")]
    dup = session.execute(text("SELECT ki FROM trendsetter_hub.warehouse_marks WHERE ki = ANY(:k)"), {"k": kis}).scalars().all()
    if dup:
        fail(422, f"Коды ЧЗ уже приняты в таблице: {len(dup)} шт (например {dup[0]}). Очистите тестовые данные в «Коды ЧЗ».")

    session.execute(
        text("INSERT INTO trendsetter_hub.warehouse_receipts (name, created_by) VALUES (:n, :u) ON CONFLICT DO NOTHING"),
        {"n": receipt_name, "u": user.id},
    )
    rid = receipt_id(session, receipt_name)
    stamp = int(time.time() * 1000)
    for i, s in enumerate(scans):
        raw = str(s.get("status") or "")
        status = STATUS_BY_LABEL.get(raw.split(", ")[0].strip(), "unknown")
        session.execute(
            text(
                """INSERT INTO trendsetter_hub.warehouse_scans
                   (id, scanned_at, worker, user_id, receipt_id, box_category, box_code, barcode, status, no_cz, ki, full_code)
                   VALUES (:id, :t, :w, :u, :r, :bc, :code, :bar, :st, :nz, :ki, :f)"""
            ),
            {
                "id": f"IMP-{stamp}-{i}", "t": _from_ms(s["t"]), "w": str(s.get("pc") or ""), "u": user.id, "r": rid,
                "bc": key(s["cat"]), "code": str(s["code"]), "bar": str(s["bc"]), "st": status, "nz": raw.endswith("без ЧЗ"),
                "ki": s.get("ki") or None, "f": s.get("full") or None,
            },
        )
    closed = sorted((b for b in boxes if b.get("state") == "закрыт"), key=lambda b: int(b.get("pos") or 0))
    for b in closed:
        session.execute(
            text(
                """INSERT INTO trendsetter_hub.warehouse_boxes (code, category, item_count, worker, opened_at, closed_at, closed_by, receipt_id)
                   VALUES (:c, :cat, :n, :w, :op, :cl, :u, :r)"""
            ),
            {"c": b["code"], "cat": key(b["cat"]), "n": int(b["count"]), "w": str(b.get("pc") or ""), "op": _from_ms(b["opened"]), "cl": _from_ms(b["closed"]), "u": user.id, "r": rid},
        )
        pallet = b["pallet"]
        session.execute(
            text(
                """INSERT INTO trendsetter_hub.warehouse_storage_boxes
                   (box_code, pallet_code, section, pallet_no, item_count, placed_at, worker, placed_by, receipt_id, category)
                   VALUES (:b, :pc, :s, :p, :n, :t, :w, :u, :r, :c)"""
            ),
            {"b": b["code"], "pc": pallet, "s": pallet[1:3], "p": int(pallet.split("_P")[1]), "n": int(b["count"]), "t": _from_ms(b["closed"]), "w": str(b.get("pc") or ""), "u": user.id, "r": rid, "c": part(b["cat"])},
        )
    for s in scans:
        if s.get("ki"):
            session.execute(
                text(
                    """INSERT INTO trendsetter_hub.warehouse_marks (ki, gtin, registered_at, worker, user_id, receipt_id, box_category, full_code, barcode)
                       VALUES (:ki, :g, :t, :w, :u, :r, :b, :f, :e)"""
                ),
                {"ki": s["ki"], "g": s["ki"][2:16], "t": _from_ms(s["t"]), "w": str(s.get("pc") or ""), "u": user.id, "r": rid, "b": key(s["cat"]), "f": s.get("full") or "", "e": str(s["bc"])},
            )
    for p, n in max_seq.items():
        session.execute(
            text(
                """INSERT INTO trendsetter_hub.warehouse_box_counters (category, last_number) VALUES (:c, :n)
                   ON CONFLICT (category) DO UPDATE SET last_number = GREATEST(trendsetter_hub.warehouse_box_counters.last_number, :n)"""
            ),
            {"c": p, "n": n},
        )
    for b in closed:
        sec = b["pallet"][1:3]
        session.execute(
            text("INSERT INTO trendsetter_hub.warehouse_pallet_pointers (section, current_pallet) VALUES (:s, :p) ON CONFLICT DO NOTHING"),
            {"s": sec, "p": int(b["pallet"].split("_P")[1])},
        )
    log_action(session, user.id, "warehouse.import_old", MODULE_ID, receipt=receipt_name, boxes=len(boxes), scans=len(scans), via="group" if responsible else "pin")
    session.commit()
    return {"boxes": len(boxes), "scans": len(scans), "marks": len(kis)}


# ---------- состояние приёмки для чтения (только SELECT) ----------


def receipt_state(session: Session, name: str, full: bool) -> dict:
    """Все сканы и закрытые короба приёмки одним ответом. Ничего не пишет."""
    rid = receipt_id(session, name)
    head = session.execute(text("SELECT name, status FROM trendsetter_hub.warehouse_receipts WHERE id = :r"), {"r": rid}).one()
    # порядок обязателен: сначала сканы, потом короба (короб, закрытый между запросами, не должен выглядеть открытым)
    scans = session.execute(
        text(
            """SELECT id, scanned_at, worker, box_category, box_code, barcode, status, no_cz, ki,
                      CASE WHEN :full THEN full_code END AS full_code
               FROM trendsetter_hub.warehouse_scans WHERE receipt_id = :r ORDER BY scanned_at, id"""
        ),
        {"r": rid, "full": full},
    ).all()
    boxes = session.execute(
        text(
            """SELECT b.code, b.category, b.item_count, b.worker, b.opened_at, b.closed_at,
                      s.pallet_code, s.section, s.pallet_no, s.pos
               FROM trendsetter_hub.warehouse_boxes b
               LEFT JOIN (SELECT box_code, pallet_code, section, pallet_no,
                                 row_number() OVER (PARTITION BY pallet_code ORDER BY placed_at, box_code) AS pos
                          FROM trendsetter_hub.warehouse_storage_boxes) s ON s.box_code = b.code
               WHERE b.receipt_id = :r ORDER BY b.closed_at DESC, b.code"""
        ),
        {"r": rid},
    ).all()
    return {
        "receipt": head.name,
        "status": head.status,
        "scans": [
            [r.id, ms(r.scanned_at), r.worker, r.box_category, r.box_code, r.barcode, r.status, r.no_cz, r.ki or "", r.full_code or ""]
            for r in scans
        ],
        "closed": [
            {
                "code": b.code, "box": b.category, "count": b.item_count, "worker": b.worker,
                "opened": ms(b.opened_at) if b.opened_at else None, "closedAt": ms(b.closed_at), "pallet": b.pallet_code or "",
                "storage": {"code": b.pallet_code, "sector": b.section, "pallet": b.pallet_no, "pos": b.pos, "cap": cap(b.pallet_no), "box": b.code}
                if b.pallet_code else None,
            }
            for b in boxes
        ],
    }
