"""Маршруты модуля «Wildberries». Данные сверки — с правом view/run (viewer видит только интерфейс), запись документа — run."""
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy.orm import Session

from app.core import messages as m
from app.core.access import can_see_data
from app.core.deps import get_current_user, module_rights, require_module_run
from app.core.models import User
from app.db.database import get_session
from app.modules.wb import service

router = APIRouter(prefix="/modules/wb", tags=["wb"])
Run = Depends(require_module_run(service.MODULE_ID))
Db = Depends(get_session)


def data_reader(user: User = Depends(get_current_user), session: Session = Db) -> User:
    access, _ = module_rights(session, user, [service.MODULE_ID])[service.MODULE_ID]
    if not can_see_data(access):
        raise HTTPException(403, m.FORBIDDEN)
    return user


Reader = Depends(data_reader)


@router.get("/marking")
def marking(date_from: date = Query(alias="from"), date_to: date = Query(alias="to"), _: User = Reader, session: Session = Db) -> dict:
    return service.marking(session, date_from, date_to)


class DocumentBody(BaseModel):
    key: Annotated[str, StringConstraints(min_length=1, max_length=300)]
    document: Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)] = ""


@router.post("/marking/document")
def set_document(body: DocumentBody, user: User = Run, session: Session = Db) -> dict:
    return service.set_document(session, user, body.key, body.document)


class ImportRow(BaseModel):
    km: Annotated[str, StringConstraints(max_length=300)]
    document: Annotated[str, StringConstraints(max_length=200)] = ""


class ImportBody(BaseModel):
    list: Literal["withdraw", "return"]
    rows: list[ImportRow] = Field(max_length=service.IMPORT_MAX_ROWS)


@router.post("/marking/import")
def import_codes(body: ImportBody, user: User = Run, session: Session = Db) -> dict:
    """Строки уже разобраны в браузере (xlsx не парсим в HTTP-запросе): код маркировки и номер документа."""
    return service.import_codes(session, user, body.list, [(r.km, r.document) for r in body.rows])
