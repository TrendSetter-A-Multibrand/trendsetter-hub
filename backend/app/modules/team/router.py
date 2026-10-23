"""Маршруты модуля «Карта команды». Просмотр — доступ к модулю team (structure видит только урезанную карту), HR — право run на hr."""
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.core import messages as m
from app.core.access import can_see_data
from app.core.deps import get_current_user
from app.core.models import User
from app.db.database import get_session
from app.modules.team import service

router = APIRouter(prefix="/modules/team", tags=["team"])
Db = Depends(get_session)


def _team_access(user: User = Depends(get_current_user), session: Session = Db) -> tuple[User, str]:
    access = service.team_access(session, user)
    if access == "none":
        raise HTTPException(403, m.FORBIDDEN)
    return user, access


def team_viewer(user_access: tuple[User, str] = Depends(_team_access)) -> User:
    """Team: доступ к модулю не ниже view (structure — 403)."""
    user, access = user_access
    if not can_see_data(access):
        raise HTTPException(403, m.FORBIDDEN)
    return user


def hr_user(user: User = Depends(get_current_user), session: Session = Db) -> User:
    if not service.is_hr(session, user):
        raise HTTPException(403, m.FORBIDDEN)
    return user


Team = Depends(team_viewer)
Hr = Depends(hr_user)


class PhotoBody(BaseModel):
    full: str
    thumb: str


class SubmissionBody(BaseModel):
    values: dict[str, Any]
    photo: PhotoBody | None = None


class ApproveBody(BaseModel):
    personId: int | None = None
    managerId: int | None = None
    directionId: str | None = None
    tag: str | None = None
    team: str | None = None
    showInMap: bool | None = None


class RejectBody(BaseModel):
    comment: str


class PersonCreateBody(BaseModel):
    firstName: str
    lastName: str
    title: str
    directionId: str
    managerId: int | None = None
    email: str | None = None
    userId: int | None = None
    tag: str | None = None
    team: str | None = None
    showInMap: bool | None = None
    values: dict[str, Any] | None = None
    photo: PhotoBody | None = None


class PersonPatchBody(BaseModel):
    firstName: str | None = None
    lastName: str | None = None
    title: str | None = None
    directionId: str | None = None
    managerId: int | None = None
    email: str | None = None
    userId: int | None = None
    tag: str | None = None
    team: str | None = None
    showInMap: bool | None = None
    values: dict[str, Any] | None = None
    photo: PhotoBody | None = None
    isArchived: bool | None = None
    sort: int | None = None
    reassignTo: int | None = None


class FieldCreateBody(BaseModel):
    key: str
    label: str
    hint: str | None = None
    kind: str
    required: bool = False
    options: list[str] | None = None


class FieldPatchBody(BaseModel):
    model_config = ConfigDict(extra="forbid")  # key и kind не меняются никогда
    label: str | None = None
    hint: str | None = None
    required: bool | None = None
    options: list[str] | None = None
    sort: int | None = None
    active: bool | None = None


class ReorderBody(BaseModel):
    ids: list[int]


def _dump(body: BaseModel) -> dict:
    return body.model_dump(exclude_unset=True)


# ---------- просмотр ----------


@router.get("/map")
def get_map(access: tuple[User, str] = Depends(_team_access), session: Session = Db) -> dict:
    user, level = access
    return service.get_map(session, user, level)


@router.get("/fields")
def fields(_: User = Team, session: Session = Db) -> list[dict]:
    return service.list_fields(session, True)


@router.get("/people/{person_id}/photo")
def person_photo(person_id: int, _: User = Team, session: Session = Db) -> dict:
    return service.person_photo(session, person_id, only_visible=True)


# ---------- анкета сотрудника ----------


@router.get("/me")
def me(user: User = Team, session: Session = Db) -> dict:
    return service.get_me(session, user)


@router.post("/me/submission")
def submit(body: SubmissionBody, user: User = Team, session: Session = Db) -> dict:
    return service.submit(session, user, body.values, body.photo.model_dump() if body.photo else None, replace=False)


@router.patch("/me/submission")
def replace_submission(body: SubmissionBody, user: User = Team, session: Session = Db) -> dict:
    return service.submit(session, user, body.values, body.photo.model_dump() if body.photo else None, replace=True)


@router.post("/me/submission/cancel")
def cancel_submission(user: User = Team, session: Session = Db) -> dict:
    return service.cancel_submission(session, user)


# ---------- HR ----------


@router.get("/hr/pending-count")
def pending_count(_: User = Hr, session: Session = Db) -> dict:
    return service.pending_count(session)


@router.get("/hr/submissions")
def submissions(status: str = "pending", _: User = Hr, session: Session = Db) -> list[dict]:
    return service.list_submissions(session, status)


@router.get("/hr/submissions/{submission_id}/photo")
def submission_photo(submission_id: int, _: User = Hr, session: Session = Db) -> dict:
    return service.submission_photo(session, submission_id)


@router.post("/hr/submissions/{submission_id}/approve")
def approve(submission_id: int, body: ApproveBody, hr: User = Hr, session: Session = Db) -> dict:
    return service.approve(session, hr, submission_id, _dump(body))


@router.post("/hr/submissions/{submission_id}/reject")
def reject(submission_id: int, body: RejectBody, hr: User = Hr, session: Session = Db) -> dict:
    return service.reject(session, hr, submission_id, body.comment)


@router.get("/hr/people")
def hr_people(_: User = Hr, session: Session = Db) -> list[dict]:
    return service.hr_people(session)


@router.get("/hr/directions")
def hr_directions(_: User = Hr, session: Session = Db) -> list[dict]:
    return service.list_directions(session)


@router.get("/hr/users")
def hr_users(_: User = Hr, session: Session = Db) -> list[dict]:
    return service.hr_users(session)


@router.post("/hr/people")
def create_person(body: PersonCreateBody, hr: User = Hr, session: Session = Db) -> dict:
    return service.create_person(session, hr, _dump(body))


@router.patch("/hr/people/{person_id}")
def update_person(person_id: int, body: PersonPatchBody, hr: User = Hr, session: Session = Db) -> dict:
    return service.update_person(session, hr, person_id, _dump(body))


@router.get("/hr/people/{person_id}/photo")
def hr_person_photo(person_id: int, _: User = Hr, session: Session = Db) -> dict:
    return service.person_photo(session, person_id, only_visible=False)


@router.get("/hr/fields")
def hr_fields(_: User = Hr, session: Session = Db) -> list[dict]:
    return service.list_fields(session, False)


@router.post("/hr/fields")
def create_field(body: FieldCreateBody, hr: User = Hr, session: Session = Db) -> dict:
    return service.create_field(session, hr, _dump(body))


# reorder объявлен раньше {field_id}, иначе «reorder» не разберётся как int
@router.patch("/hr/fields/reorder")
def reorder_fields(body: ReorderBody, hr: User = Hr, session: Session = Db) -> list[dict]:
    return service.reorder_fields(session, hr, body.ids)


@router.patch("/hr/fields/{field_id}")
def update_field(field_id: int, body: FieldPatchBody, hr: User = Hr, session: Session = Db) -> dict:
    return service.update_field(session, hr, field_id, _dump(body))
