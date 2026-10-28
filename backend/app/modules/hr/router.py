"""Маршруты модуля «HR»: профиль и отпуск сотрудника, календарь, досье, деньги и документы, нормы отпуска.
Права: Me — любой активный сотрудник; Team — team не ниже view; Hr — run на hr; Resp — responsible на hr;
Mgr — руководитель (проверяется в сервисе). Новое (история, оборудование, чек-листы, график, экспорт) — в history/equipment/checklists/plans/exports."""
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.core import messages as m
from app.core.access import can_manage_users
from app.core.deps import get_current_user
from app.core.models import User
from app.db.database import get_session
from app.modules.hr import audit_view, checklists, equipment, exports, history, plans, service, stats
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


def audit_user(user: User = Depends(get_current_user), session: Session = Db) -> User:
    if not (service.is_responsible(session, user) or can_manage_users(access_level=user.access_level, is_active=user.is_active)):
        raise HTTPException(403, m.FORBIDDEN)
    return user


Me = Depends(get_current_user)
Team = Depends(team_viewer)
Hr = Depends(hr_user)
Resp = Depends(resp_user)
Audit = Depends(audit_user)


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
    birthdayHidden: bool | None = None


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
    visibleToEmployee: bool = False


class DocumentPatchBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    visibleToEmployee: bool | None = None
    title: str | None = None
    category: str | None = None


class HistoryBody(BaseModel):
    kind: str
    effectiveDate: str
    title: str
    oldValue: str | None = None
    newValue: str | None = None
    comment: str | None = None


class EquipmentBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: str
    name: str
    serial: str | None = None
    issuedAt: str
    returnDue: str | None = None
    comment: str | None = None


class EquipmentPatchBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: str | None = None
    name: str | None = None
    serial: str | None = None
    issuedAt: str | None = None
    returnDue: str | None = None
    returnedAt: str | None = None
    comment: str | None = None


class TemplateItemBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str
    daysOffset: int | None = None


class TemplateBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: str
    title: str
    items: list[TemplateItemBody]


class TemplatePatchBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = None
    active: bool | None = None
    items: list[TemplateItemBody] | None = None


class ChecklistStartBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    templateId: int
    startedAt: str | None = None


class ChecklistItemPatchBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    done: bool | None = None
    assigneeUserId: int | None = None
    dueDate: str | None = None
    note: str | None = None


class PlanBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start: str
    end: str
    comment: str | None = None


class PlanRequestBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: str | None = None
    message: str | None = None


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


@router.get("/me/compensation")
def my_compensation(user: User = Me, session: Session = Db) -> dict:
    return service.get_my_compensation(session, user)


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


@router.get("/stats")
def people_stats(_: User = Hr, session: Session = Db) -> dict:
    return stats.get_stats(session)


@router.get("/people/{person_id}/file")
def get_file(person_id: int, user: User = Hr, session: Session = Db) -> dict:
    return service.get_file(session, user, person_id)


@router.patch("/people/{person_id}/file")
def patch_file(person_id: int, body: FilePatchBody, user: User = Hr, session: Session = Db) -> dict:
    return service.update_file(session, user, person_id, _dump(body))


@router.get("/people/{person_id}/sensitive")
def get_sensitive(person_id: int, user: User = Resp, session: Session = Db) -> dict:
    return service.view_sensitive(session, user, person_id)


@router.patch("/people/{person_id}/sensitive")
def patch_sensitive(person_id: int, body: SensitivePatchBody, user: User = Resp, session: Session = Db) -> dict:
    return service.update_sensitive(session, user, person_id, _dump(body))


@router.get("/people/{person_id}/documents")
def list_documents(person_id: int, user: User = Resp, session: Session = Db) -> list[dict]:
    return service.view_documents(session, user, person_id)


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


@router.patch("/documents/{doc_id}")
def patch_document(doc_id: int, body: DocumentPatchBody, user: User = Resp, session: Session = Db) -> dict:
    return service.update_document(session, user, doc_id, _dump(body))


# ---------- свои документы (Me) ----------


@router.get("/me/documents")
def my_documents(user: User = Me, session: Session = Db) -> list[dict]:
    return service.my_documents(session, user)


@router.get("/me/documents/{doc_id}")
def download_my_document(doc_id: int, user: User = Me, session: Session = Db) -> dict:
    return service.download_my_document(session, user, doc_id)


# ---------- дни рождения (Team) ----------


@router.get("/birthdays")
def birthdays(month: str | None = None, _: User = Team, session: Session = Db) -> list[dict]:
    return service.birthdays(session, month)


# ---------- экспорт (Hr) ----------


@router.get("/export/people")
def export_people(user: User = Hr, session: Session = Db) -> dict:
    return exports.export_people(session, user)


@router.get("/export/leave")
def export_leave(start: str = Query(alias="from"), end: str = Query(alias="to"), user: User = Hr, session: Session = Db) -> dict:
    return exports.export_leave(session, user, start, end)


# ---------- история (Hr; salary — Resp) ----------


@router.get("/people/{person_id}/history")
def list_history(person_id: int, user: User = Hr, session: Session = Db) -> list[dict]:
    return history.list_history(session, user, person_id)


@router.post("/people/{person_id}/history")
def add_history(person_id: int, body: HistoryBody, user: User = Hr, session: Session = Db) -> dict:
    return history.add_history(session, user, person_id, _dump(body))


@router.post("/history/{history_id}/delete")
def delete_history(history_id: int, user: User = Hr, session: Session = Db) -> dict:
    return history.delete_history(session, user, history_id)


# ---------- оборудование (Hr) ----------


@router.get("/people/{person_id}/equipment")
def list_equipment(person_id: int, _: User = Hr, session: Session = Db) -> list[dict]:
    return equipment.list_equipment(session, person_id)


@router.post("/people/{person_id}/equipment")
def add_equipment(person_id: int, body: EquipmentBody, user: User = Hr, session: Session = Db) -> dict:
    return equipment.add_equipment(session, user, person_id, _dump(body))


@router.patch("/equipment/{item_id}")
def patch_equipment(item_id: int, body: EquipmentPatchBody, user: User = Hr, session: Session = Db) -> dict:
    return equipment.update_equipment(session, user, item_id, _dump(body))


@router.post("/equipment/{item_id}/delete")
def delete_equipment(item_id: int, user: User = Hr, session: Session = Db) -> dict:
    return equipment.delete_equipment(session, user, item_id)


# ---------- чек-листы ----------


@router.get("/checklist-templates")
def list_templates(_: User = Hr, session: Session = Db) -> list[dict]:
    return checklists.list_templates(session)


@router.post("/checklist-templates")
def create_template(body: TemplateBody, user: User = Hr, session: Session = Db) -> dict:
    return checklists.create_template(session, user, _dump(body))


@router.patch("/checklist-templates/{template_id}")
def patch_template(template_id: int, body: TemplatePatchBody, user: User = Hr, session: Session = Db) -> dict:
    return checklists.update_template(session, user, template_id, _dump(body))


@router.get("/checklists")
def checklist_overview(status: str = "active", _: User = Hr, session: Session = Db) -> list[dict]:
    return checklists.overview(session, status)


@router.get("/checklists/mine")
def my_checklist_items(user: User = Me, session: Session = Db) -> list[dict]:
    return checklists.my_items(session, user)


@router.get("/people/{person_id}/checklists")
def list_checklists(person_id: int, _: User = Hr, session: Session = Db) -> list[dict]:
    return checklists.list_for_person(session, person_id)


@router.post("/people/{person_id}/checklists")
def start_checklist(person_id: int, body: ChecklistStartBody, user: User = Hr, session: Session = Db) -> dict:
    return checklists.start_checklist(session, user, person_id, _dump(body))


@router.patch("/checklist-items/{item_id}")
def patch_checklist_item(item_id: int, body: ChecklistItemPatchBody, user: User = Me, session: Session = Db) -> dict:
    return checklists.update_item(session, user, item_id, _dump(body))  # HR — любой пункт; исполнитель — только свой (done/note)


@router.post("/checklists/{checklist_id}/close")
def close_checklist(checklist_id: int, user: User = Hr, session: Session = Db) -> dict:
    return checklists.close_checklist(session, user, checklist_id, "done")


@router.post("/checklists/{checklist_id}/cancel")
def cancel_checklist(checklist_id: int, user: User = Hr, session: Session = Db) -> dict:
    return checklists.close_checklist(session, user, checklist_id, "cancelled")


# ---------- годовой график отпусков ----------


@router.get("/me/leave/plans")
def my_plans(year: int | None = None, user: User = Me, session: Session = Db) -> list[dict]:
    return plans.my_plans(session, user, year)


@router.post("/me/leave/plans")
def create_plan(body: PlanBody, user: User = Me, session: Session = Db) -> dict:
    return plans.create_plan(session, user, _dump(body))


@router.post("/me/leave/plans/{plan_id}/cancel")
def cancel_plan(plan_id: int, user: User = Me, session: Session = Db) -> dict:
    return plans.cancel_plan(session, user, plan_id)


@router.post("/me/leave/plans/{plan_id}/request")
def convert_plan(plan_id: int, body: PlanRequestBody, user: User = Me, session: Session = Db) -> dict:
    return plans.convert_plan(session, user, plan_id, _dump(body))


@router.get("/me/leave/team-plan")
def team_plan(year: int | None = None, user: User = Me, session: Session = Db) -> list[dict]:
    return plans.team_plans(session, user, year)  # Mgr: 403, если нет подчинённых


@router.get("/leave/plan")
def hr_plan(year: int | None = None, _: User = Hr, session: Session = Db) -> list[dict]:
    return plans.all_plans(session, year)


# ---------- журнал (responsible на hr или администратор) ----------


@router.get("/audit")
def audit(
    personId: int | None = None,
    action: str | None = None,
    date_from: str | None = Query(None, alias="from"),
    date_to: str | None = Query(None, alias="to"),
    limit: int = Query(50, ge=1, le=audit_view.LIMIT_MAX),
    offset: int = Query(0, ge=0),
    user: User = Audit,
    session: Session = Db,
) -> dict:
    return audit_view.list_audit(session, user, personId, action, date_from, date_to, limit, offset)
