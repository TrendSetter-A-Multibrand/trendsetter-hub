"""Маршруты модуля «Склад». Все требуют права запуска модуля: admin/superuser, сотрудник отдела «Склад» или участник группы с правом запуска."""
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import module_responsible, require_module_run
from app.core.models import User
from app.db.database import get_session
from app.modules.warehouse import service

router = APIRouter(prefix="/modules/warehouse", tags=["warehouse"])
Run = Depends(require_module_run(service.MODULE_ID))
Responsible = Depends(module_responsible(service.MODULE_ID))
Db = Depends(get_session)


# ---------- приёмки и раскладка ----------


@router.get("/receipts")
def list_receipts(_: User = Run, session: Session = Db) -> list[dict]:
    return service.list_receipts(session)


class NameBody(BaseModel):
    name: str


@router.post("/receipts")
def create_receipt(body: NameBody, user: User = Run, session: Session = Db) -> str:
    return service.create_receipt(session, user, body.name)


@router.post("/receipts/finish")
def finish_receipt(body: NameBody, user: User = Run, session: Session = Db) -> list[dict]:
    return service.finish_receipt(session, user, body.name)


class PlanBody(BaseModel):
    receipt: str
    json_data: str
    name: str = ""
    worker: str = ""


@router.post("/plan")
def save_plan(body: PlanBody, user: User = Run, session: Session = Db) -> dict:
    return service.save_plan(session, user, body.receipt, body.json_data, body.name, body.worker)


@router.get("/plan-info")
def plan_info(receipt: str, _: User = Run, session: Session = Db) -> dict | None:
    return service.get_plan_info(session, receipt)


@router.get("/plan")
def get_plan(receipt: str, _: User = Run, session: Session = Db) -> dict | None:
    return service.get_plan(session, receipt)


# ---------- короба, палеты, хранение ----------


class CategoryBody(BaseModel):
    category: str


@router.post("/box-code")
def box_code(body: CategoryBody, _: User = Run, session: Session = Db) -> str:
    return service.next_box_code(session, body.category)


class AssignBody(BaseModel):
    box: str
    cat: str
    count: int
    receipt: str
    pc: str = ""


@router.post("/assign-pallet")
def assign_pallet(body: AssignBody, user: User = Run, session: Session = Db) -> dict:
    return service.assign_pallet(session, user, body.model_dump())


@router.get("/boxes/{code}")
def box_info(code: str, _: User = Run, session: Session = Db) -> dict | None:
    return service.box_info(session, code)


@router.post("/boxes/{code}/reopen")
def reopen_box(code: str, _: User = Run, session: Session = Db) -> dict:
    return service.reopen_box(session, code)


class CodesBody(BaseModel):
    codes: list[str]


@router.post("/box-pallets")
def box_pallets(body: CodesBody, _: User = Run, session: Session = Db) -> dict[str, str]:
    return service.box_pallets(session, body.codes)


@router.get("/storage")
def storage(_: User = Run, session: Session = Db) -> list[list]:
    return service.storage_list(session)


@router.post("/pallets/{code}/free")
def free_pallet(code: str, user: User = Run, session: Session = Db) -> dict:
    return service.free_pallet(session, user, code)


# ---------- дополнительные секции (по ПИН) ----------


@router.get("/sectors")
def sectors(_: User = Run, session: Session = Db) -> list[dict]:
    return service.list_sectors(session)


class SectorBody(BaseModel):
    cat: str
    sector: str
    pin: str = ""
    known: list[str] = []


@router.post("/sectors")
def add_sector(body: SectorBody, user: User = Run, responsible: bool = Responsible, session: Session = Db) -> list[dict]:
    return service.add_sector(session, user, body.cat, body.sector, body.pin, body.known, responsible)


@router.post("/sectors/remove")
def remove_sector(body: SectorBody, user: User = Run, responsible: bool = Responsible, session: Session = Db) -> list[dict]:
    return service.remove_sector(session, user, body.cat, body.sector, body.pin, responsible)


# ---------- Честный знак, запись сканов, импорт ----------


class MarkBody(BaseModel):
    ki: str
    gtin: str = ""
    ean: str = ""
    full: str = ""
    receipt: str = ""
    box: str = ""
    pc: str = ""


@router.post("/marks")
def register_mark(body: MarkBody, user: User = Run, session: Session = Db) -> dict:
    return service.register_mark(session, user, body.model_dump())


class SyncBody(BaseModel):
    ops: list[dict[str, Any]]
    worker: str = ""


@router.post("/sync")
def sync(body: SyncBody, user: User = Run, session: Session = Db) -> dict:
    return service.sync(session, user, body.ops, body.worker)


class ImportBody(BaseModel):
    data: dict[str, Any]
    pin: str = ""


@router.post("/import")
def import_old(body: ImportBody, user: User = Run, responsible: bool = Responsible, session: Session = Db) -> dict:
    return service.import_old(session, user, body.data, body.pin, responsible)


# ---------- состояние приёмки (только чтение) ----------


@router.get("/receipt-state")
def receipt_state(receipt: str, full: bool = False, _: User = Run, session: Session = Db) -> dict:
    return service.receipt_state(session, receipt, full)
