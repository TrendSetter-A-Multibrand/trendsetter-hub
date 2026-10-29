"""Маршруты модуля «Новости компании». Читатель — view/run на news (viewer — 403), запись и списки — редактор (ответственный или admin)."""
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints, field_validator
from sqlalchemy.orm import Session

from app.core import messages as m
from app.core.deps import get_current_user
from app.core.models import User
from app.db.database import get_session
from app.modules.news import service

router = APIRouter(prefix="/modules/news", tags=["news"])
Db = Depends(get_session)

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Body = Annotated[str, StringConstraints(strip_whitespace=True, max_length=5000)]
Place = Annotated[str, StringConstraints(max_length=200)]
Color = Literal["red", "green", "yellow", "blue", "pink", "gray"]
BannerText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]
ReviewComment = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]


def reader(user: User = Depends(get_current_user), session: Session = Db) -> tuple[User, bool]:
    """Читатель (view/run) или редактор; возвращает пользователя и признак редактора."""
    editor = service.is_editor(session, user)
    if not (editor or service.can_read(service.access_of(session, user))):
        raise HTTPException(403, m.FORBIDDEN)
    return user, editor


def editor_user(user: User = Depends(get_current_user), session: Session = Db) -> User:
    if not service.is_editor(session, user):
        raise HTTPException(403, m.FORBIDDEN)
    return user


Reader = Depends(reader)
Editor = Depends(editor_user)


class _PlaceMixin(BaseModel):
    @field_validator("place", mode="before", check_fields=False)
    @classmethod
    def blank_place_is_null(cls, value):
        if isinstance(value, str):
            return value.strip() or None
        return value


class ItemBody(_PlaceMixin):
    kind: Literal["news", "event"]
    title: Title
    body: Body = ""
    place: Place | None = None
    startsAt: AwareDatetime | None = None
    endsAt: AwareDatetime | None = None
    pinned: bool = False
    color: Color | None = None
    rsvpEnabled: bool = False
    rsvpDeadline: AwareDatetime | None = None
    rsvpNamesPublic: bool = False
    status: Literal["draft", "published"] = "draft"


class ItemPatchBody(_PlaceMixin):
    """Поля без None-значения по умолчанию: явный null для них — 422; «не передано» определяется по model_fields_set."""

    model_config = ConfigDict(extra="forbid")
    title: Title = Field(None)
    body: Body = Field(None)
    place: Place | None = None
    startsAt: AwareDatetime | None = None
    endsAt: AwareDatetime | None = None
    pinned: bool = Field(None)
    color: Color | None = None
    rsvpEnabled: bool = Field(None)
    rsvpDeadline: AwareDatetime | None = None
    rsvpNamesPublic: bool = Field(None)
    status: Literal["draft", "published"] = Field(None)
    archived: bool = Field(None)


class ProposalBody(_PlaceMixin):
    """Предложение автора: поля ItemBody без pinned и status (они назначаются сервером; лишние ключи — 422)."""

    model_config = ConfigDict(extra="forbid")
    kind: Literal["news", "event"]
    title: Title
    body: Body = ""
    place: Place | None = None
    startsAt: AwareDatetime | None = None
    endsAt: AwareDatetime | None = None
    color: Color | None = None
    rsvpEnabled: bool = False
    rsvpDeadline: AwareDatetime | None = None
    rsvpNamesPublic: bool = False


class ProposalPatchBody(_PlaceMixin):
    """Как ItemPatchBody, но без kind, pinned, status и archived."""

    model_config = ConfigDict(extra="forbid")
    title: Title = Field(None)
    body: Body = Field(None)
    place: Place | None = None
    startsAt: AwareDatetime | None = None
    endsAt: AwareDatetime | None = None
    color: Color | None = None
    rsvpEnabled: bool = Field(None)
    rsvpDeadline: AwareDatetime | None = None
    rsvpNamesPublic: bool = Field(None)


class ApproveBody(BaseModel):
    expectedUpdatedAt: AwareDatetime


class ReviewBody(ApproveBody):
    comment: ReviewComment


class PinnedOrderBody(BaseModel):
    kind: Literal["news", "event"]
    ids: list[int]


class RsvpBody(BaseModel):
    answer: Literal["yes", "maybe", "no"]


class BannerBody(BaseModel):
    text: BannerText
    endsAt: AwareDatetime | None = None


# ---------- читатель ----------


@router.get("/feed")
def feed(ctx: tuple[User, bool] = Reader, session: Session = Db):
    user, editor = ctx
    return service.feed(session, user, editor)


@router.get("/banner")
def get_banner(ctx: tuple[User, bool] = Reader, session: Session = Db):
    return service.get_banner(session)


@router.post("/items/{item_id}/rsvp")
def set_rsvp(item_id: int, body: RsvpBody, ctx: tuple[User, bool] = Reader, session: Session = Db):
    user, editor = ctx
    return service.set_rsvp(session, user, item_id, body.answer, editor)


@router.get("/items/{item_id}/responses")
def responses(item_id: int, ctx: tuple[User, bool] = Reader, session: Session = Db):
    return service.responses(session, item_id, ctx[1])


@router.get("/proposals/mine")
def my_proposals(ctx: tuple[User, bool] = Reader, session: Session = Db):
    user, editor = ctx
    return service.my_proposals(session, user, editor)


@router.post("/proposals")
def create_proposal(body: ProposalBody, ctx: tuple[User, bool] = Reader, session: Session = Db):
    user, editor = ctx
    return service.create_proposal(session, user, body.model_dump(), editor)


@router.patch("/proposals/{item_id}")
def update_proposal(item_id: int, body: ProposalPatchBody, ctx: tuple[User, bool] = Reader, session: Session = Db):
    user, editor = ctx
    data = {name: getattr(body, name) for name in body.model_fields_set}
    return service.update_proposal(session, user, item_id, data, editor)


# ---------- редактор ----------


@router.get("/items")
def list_items(
    tab: Literal["current", "past", "drafts", "review"],
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user: User = Editor,
    session: Session = Db,
):
    return service.list_items(session, user, tab, limit, offset)


@router.post("/items")
def create_item(body: ItemBody, user: User = Editor, session: Session = Db):
    return service.create_item(session, user, body.model_dump())


@router.patch("/items/{item_id}")
def update_item(item_id: int, body: ItemPatchBody, user: User = Editor, session: Session = Db):
    data = {name: getattr(body, name) for name in body.model_fields_set}
    return service.update_item(session, user, item_id, data)


@router.post("/items/{item_id}/delete")
def delete_item(item_id: int, user: User = Editor, session: Session = Db):
    return service.delete_item(session, user, item_id)


@router.post("/items/{item_id}/approve")
def approve_item(item_id: int, body: ApproveBody, user: User = Editor, session: Session = Db):
    return service.review_item(session, user, item_id, "approve", None, body.expectedUpdatedAt)


@router.post("/items/{item_id}/return")
def return_item(item_id: int, body: ReviewBody, user: User = Editor, session: Session = Db):
    return service.review_item(session, user, item_id, "return", body.comment, body.expectedUpdatedAt)


@router.post("/items/{item_id}/reject")
def reject_item(item_id: int, body: ReviewBody, user: User = Editor, session: Session = Db):
    return service.review_item(session, user, item_id, "reject", body.comment, body.expectedUpdatedAt)


@router.post("/pinned-order")
def pinned_order(body: PinnedOrderBody, user: User = Editor, session: Session = Db):
    return service.pinned_order(session, user, body.kind, body.ids)


@router.post("/banner")
def set_banner(body: BannerBody, user: User = Editor, session: Session = Db):
    return service.set_banner(session, user, body.text, body.endsAt)


@router.post("/banner/off")
def banner_off(user: User = Editor, session: Session = Db):
    return service.banner_off(session, user)
