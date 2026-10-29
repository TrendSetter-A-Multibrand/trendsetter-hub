"""Маршруты модуля «Производственный календарь». Читатель — view/run на holidays (viewer — 403), запись — редактор (ответственный или admin)."""
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from app.core import messages as m
from app.core.deps import get_current_user
from app.core.models import User
from app.db.database import get_session
from app.modules.holidays import service

router = APIRouter(prefix="/modules/holidays", tags=["holidays"])
Db = Depends(get_session)


def reader(user: User = Depends(get_current_user), session: Session = Db) -> User:
    """Читатель (view/run) или редактор."""
    if not (service.is_editor(session, user) or service.can_read(service.access_of(session, user))):
        raise HTTPException(403, m.FORBIDDEN)
    return user


def editor_user(user: User = Depends(get_current_user), session: Session = Db) -> User:
    if not service.is_editor(session, user):
        raise HTTPException(403, m.FORBIDDEN)
    return user


Reader = Depends(reader)
Editor = Depends(editor_user)


class RangeBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    country: Literal["RU", "AM"]
    start: date
    end: date


class SetBody(RangeBody):
    kind: Literal["holiday", "day_off", "workday", "short"]
    name: str | None = Field(None, max_length=100)

    @field_validator("name", mode="before")
    @classmethod
    def blank_name_is_null(cls, value):
        if isinstance(value, str):
            return value.strip() or None
        return value


@router.get("/days")
def days(start: date, end: date, user: User = Reader, session: Session = Db):
    return service.list_days(session, start, end)


@router.post("/days")
def set_days(body: SetBody, user: User = Editor, session: Session = Db):
    return service.set_days(session, user, body.country, body.start, body.end, body.kind, body.name)


@router.post("/days/delete")
def delete_days(body: RangeBody, user: User = Editor, session: Session = Db):
    return service.delete_days(session, user, body.country, body.start, body.end)
