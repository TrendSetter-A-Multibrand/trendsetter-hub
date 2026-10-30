"""Маршруты модуля «Обратная связь». Отправитель — view/run на feedback (viewer — 403), читатель — ответственный или admin."""
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy.orm import Session

from app.core import messages as m
from app.core.deps import get_current_user
from app.core.models import User
from app.db.database import get_session
from app.modules.feedback import service

router = APIRouter(prefix="/modules/feedback", tags=["feedback"])
Db = Depends(get_session)

Kind = Literal["thanks", "idea", "complaint", "other"]
Status = Literal["new", "in_progress", "closed"]
Body = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=3000)]
Note = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]


def sender(user: User = Depends(get_current_user), session: Session = Db) -> User:
    if not service.can_send(service.access_of(session, user)):
        raise HTTPException(403, m.FORBIDDEN)
    return user


def reader(user: User = Depends(get_current_user), session: Session = Db) -> User:
    if not service.is_reader(session, user):
        raise HTTPException(403, m.FORBIDDEN)
    return user


Sender = Depends(sender)
Reader = Depends(reader)


class MessageBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Kind
    body: Body
    anonymous: bool
    contactOk: bool = False
    recipientId: int | None = None


class PatchBody(BaseModel):
    """Поля без None-значения по умолчанию: явный null для status — 422; «не передано» определяется по model_fields_set."""

    model_config = ConfigDict(extra="forbid")
    status: Status = Field(None)
    note: Note | None = None


@router.get("/people")
def people(user: User = Sender, session: Session = Db):
    return service.people(session, user)


@router.post("/messages")
def create_message(body: MessageBody, user: User = Sender, session: Session = Db):
    return service.create_message(session, user, body.kind, body.body, body.anonymous, body.contactOk, body.recipientId)


@router.get("/mine")
def mine(user: User = Sender, session: Session = Db):
    return service.my_messages(session, user)


@router.get("/messages")
def list_messages(
    status: Status,
    kind: Kind | None = None,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user: User = Reader,
    session: Session = Db,
):
    return service.list_messages(session, status, kind, limit, offset)


@router.patch("/messages/{message_id}")
def update_message(message_id: int, body: PatchBody, user: User = Reader, session: Session = Db):
    data = {name: getattr(body, name) for name in body.model_fields_set}
    return service.update_message(session, user, message_id, data)
