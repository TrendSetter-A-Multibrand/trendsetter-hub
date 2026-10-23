"""Маршруты модуля «HR»: профиль и отпуск сотрудника, календарь, досье, деньги и документы, нормы отпуска.
Права: Me — любой активный сотрудник; Team — team не ниже view; Hr — run на hr; Resp — responsible на hr."""
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.core import messages as m
from app.core.deps import get_current_user
from app.core.models import User
from app.db.database import get_session
from app.modules.hr import service
from app.modules.team.router import team_viewer

router = APIRouter(prefix="/modules/hr", tags=["hr"])
Db = Depends(get_session)


def hr_user(user: User = Depends(get_current_user), session: Session = Db) -> User:
    if not service.is_hr(session, user):
        raise HTTPException(403, m.FORBIDDEN)
    return user


def resp_user(user: User = Depends(get_current_user), session: Session = Db) -> User:
    if not service.is_responsible(session, user):
        raise HTTPException(403, m.FORBIDDEN)
    return user


Me = Depends(get_current_user)
Team = Depends(team_viewer)
Hr = Depends(hr_user)
Resp = Depends(resp_user)


class LeaveRequestBody(BaseModel):
    kind: str
    start: str
    end: str
    message: str | None = None


class HrLeaveRequestBody(LeaveRequestBody):
    status: Literal["approved"] | None = None


class DecisionBody(BaseModel):
    approve: bool
    comment: str | None = None


class AdjustmentBody(BaseModel):
    deltaDays: Decimal
    reason: str


class FilePatchBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    legalName: str | None = None
    birthDate: str | None = None
    country: str | None = None
    employmentType: str | None = None
    hiredAt: str | None = None
    probationUntil: str | None = None
    contractNo: str | None = None
    contractDate: str | None = None
    workSchedule: str | None = None
    dismissedAt: str | None = None
    dismissalReason: str | None = None
    phone: str | None = None
    personalEmail: str | None = None
    emergencyContact: str | None = None
    notes: str | None = None


class SensitivePatchBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    salary: Decimal | None = None
    currency: str | None = None
    payDay1: int | None = None
    payDay2: int | None = None
    bonusNote: str | None = None
    taxId: str | None = None
    socialId: str | None = None
    passport: str | None = None
    bankDetails: str | None = None


class DocumentBody(BaseModel):
    category: str
    title: str
    fileName: str
    dataBase64: str


class PolicyPatchBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    daysPerYear: Decimal | None = None
    accruePerMonth: Decimal | None = None
    firstLeaveAfterMonths: int | None = None


def _dump(body: BaseModel) -> dict:
    return body.model_dump(exclude_unset=True)


# ---------- профиль сотрудника (Me) ----------


@router.get("/me/leave")
def my_leave(user: User = Me, session: Session = Db) -> dict:
    return service.get_my_leave(session, user)


@router.get("/me/file")
def my_file(user: User = Me, session: Session = Db) -> dict:
    return service.get_my_file(session, user)


@router.post("/me/leave/requests")
def create_my_request(body: LeaveRequestBody, user: User = Me, session: Session = Db) -> dict:
    return service.create_my_request(session, user, _dump(body))


@router.post("/me/leave/requests/{request_id}/cancel")
def cancel_my_request(request_id: int, user: User = Me, session: Session = Db) -> dict:
    return service.cancel_my_request(session, user, request_id)


@router.get("/me/approvals")
def my_approvals(user: User = Me, session: Session = Db) -> list[dict]:
    return service.my_approvals(session, user)


@router.post("/leave/requests/{request_id}/decision")
def decision(request_id: int, body: DecisionBody, user: User = Me, session: Session = Db) -> dict:
    return service.decide(session, user, request_id, body.approve, body.comment)


@router.post("/leave/requests/{request_id}/cancel")
def cancel_request_by_hr(request_id: int, user: User = Hr, session: Session = Db) -> dict:
    return service.cancel_request_by_hr(session, user, request_id)


# ---------- календарь (Team) ----------


@router.get("/leave/calendar")
def leave_calendar(
    start: str = Query(alias="from"), end: str = Query(alias="to"), _: User = Team, session: Session = Db
) -> list[dict]:
    return service.calendar(session, start, end)


# ---------- HR ----------


@router.get("/people/{person_id}/file")
def get_file(person_id: int, user: User = Hr, session: Session = Db) -> dict:
    return service.get_file(session, user, person_id)


@router.patch("/people/{person_id}/file")
def patch_file(person_id: int, body: FilePatchBody, user: User = Hr, session: Session = Db) -> dict:
    return service.update_file(session, user, person_id, _dump(body))


@router.get("/people/{person_id}/sensitive")
def get_sensitive(person_id: int, _: User = Resp, session: Session = Db) -> dict:
    return service.get_sensitive(session, person_id)


@router.patch("/people/{person_id}/sensitive")
def patch_sensitive(person_id: int, body: SensitivePatchBody, user: User = Resp, session: Session = Db) -> dict:
    return service.update_sensitive(session, user, person_id, _dump(body))


@router.get("/people/{person_id}/documents")
def list_documents(person_id: int, _: User = Resp, session: Session = Db) -> list[dict]:
    return service.list_documents(session, person_id)


@router.post("/people/{person_id}/documents")
def upload_document(person_id: int, body: DocumentBody, user: User = Resp, session: Session = Db) -> dict:
    return service.upload_document(session, user, person_id, _dump(body))


@router.get("/documents/{doc_id}")
def download_document(doc_id: int, user: User = Resp, session: Session = Db) -> dict:
    return service.download_document(session, user, doc_id)


@router.post("/documents/{doc_id}/delete")
def delete_document(doc_id: int, user: User = Resp, session: Session = Db) -> dict:
    return service.delete_document(session, user, doc_id)


@router.post("/people/{person_id}/leave/requests")
def create_request_for(person_id: int, body: HrLeaveRequestBody, user: User = Hr, session: Session = Db) -> dict:
    return service.create_request_for(session, user, person_id, _dump(body))


@router.post("/people/{person_id}/leave/adjustments")
def add_adjustment(person_id: int, body: AdjustmentBody, user: User = Hr, session: Session = Db) -> dict:
    return service.add_adjustment(session, user, person_id, _dump(body))


@router.get("/leave/requests")
def list_requests(status: str = "all", personId: int | None = None, _: User = Hr, session: Session = Db) -> list[dict]:
    return service.list_requests(session, status, personId)


@router.get("/leave/policies")
def list_policies(_: User = Hr, session: Session = Db) -> list[dict]:
    return service.list_policies(session)


@router.patch("/leave/policies/{country}")
def patch_policy(country: str, body: PolicyPatchBody, user: User = Resp, session: Session = Db) -> dict:
    return service.update_policy(session, user, country, _dump(body))
