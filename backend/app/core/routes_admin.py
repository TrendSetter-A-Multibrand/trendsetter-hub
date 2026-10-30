from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core import messages as m
from app.core import onboarding
from app.core.access import ACCESS_LEVELS, GROUP_PERMISSIONS
from app.core.audit import log_action
from app.core.deps import require_manager
from app.core.models import (
    AccessGroup,
    AccessGroupMember,
    AccessGroupPermission,
    Department,
    OnboardingSettings,
    User,
    UserDepartment,
    UserModulePermission,
)
from app.core.registry import MODULES
from app.core.security import MAX_PASSWORD_BYTES, CHANGE_MAX_CHARS, hash_password, password_is_valid
from app.core.validation import validate_department_code, validate_department_name, validate_group_name, validate_new_user
from app.db.database import get_session

router = APIRouter(prefix="/admin", tags=["admin"])


def _department_ids_by_user(session: Session) -> dict[int, list[int]]:
    result: dict[int, list[int]] = {}
    for user_id, department_id in session.execute(
        select(UserDepartment.user_id, UserDepartment.department_id).order_by(UserDepartment.department_id)
    ):
        result.setdefault(user_id, []).append(department_id)
    return result


def _public_user(user: User, department_ids: list[int]) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "access_level": user.access_level,
        "department_ids": department_ids,
        "is_active": user.is_active,
        "must_change_password": user.must_change_password,
        "onboarding": user.onboarding,
        "onboarding_expires_at": user.onboarding_expires_at.isoformat() if user.onboarding_expires_at else None,
    }


def _check_department_ids(session: Session, ids: list[int]) -> None:
    found = set(session.scalars(select(Department.id).where(Department.id.in_(ids))).all()) if ids else set()
    if set(ids) != found:
        raise HTTPException(422, m.UNKNOWN_DEPARTMENT)


def _set_departments(session: Session, user_id: int, ids: list[int]) -> None:
    session.query(UserDepartment).filter(UserDepartment.user_id == user_id).delete()
    for department_id in sorted(set(ids)):
        session.add(UserDepartment(user_id=user_id, department_id=department_id))


def _get_user(session: Session, user_id: int) -> User:
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(404, m.USER_NOT_FOUND)
    return user


# ---------- пользователи ----------


@router.get("/users")
def list_users(_: User = Depends(require_manager), session: Session = Depends(get_session)) -> list[dict]:
    deps = _department_ids_by_user(session)
    return [_public_user(u, deps.get(u.id, [])) for u in session.scalars(select(User).order_by(User.id))]


class CreateUserBody(BaseModel):
    email: str
    full_name: str
    access_level: str
    password: str
    department_ids: list[int] = []


@router.post("/users")
def create_user(body: CreateUserBody, me: User = Depends(require_manager), session: Session = Depends(get_session)) -> dict:
    existing = list(session.scalars(select(User.email)).all())
    problem = validate_new_user(body.email, body.full_name, body.access_level, body.password, existing)
    if problem:
        raise HTTPException(409 if problem == m.EMAIL_DUPLICATE else 422, problem)
    _check_department_ids(session, body.department_ids)
    user = User(
        email=body.email.strip(),
        full_name=body.full_name.strip(),
        access_level=body.access_level,
        password_hash=hash_password(body.password),
        is_active=True,
    )
    session.add(user)
    try:
        session.flush()
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, m.EMAIL_DUPLICATE) from None
    _set_departments(session, user.id, body.department_ids)
    log_action(session, me.id, "user.create", target_user_id=user.id, access_level=user.access_level)
    session.commit()
    return _public_user(user, sorted(set(body.department_ids)))


class PatchUserBody(BaseModel):
    access_level: str | None = None
    department_ids: list[int] | None = None
    is_active: bool | None = None


@router.patch("/users/{user_id}")
def patch_user(user_id: int, body: PatchUserBody, me: User = Depends(require_manager), session: Session = Depends(get_session)) -> dict:
    user = _get_user(session, user_id)
    is_self = user.id == me.id
    if body.access_level is not None:
        if body.access_level not in ACCESS_LEVELS:
            raise HTTPException(422, m.UNKNOWN_LEVEL)
        if is_self and body.access_level != user.access_level:
            raise HTTPException(422, m.SELF_LEVEL)
    if body.is_active is False and is_self:
        raise HTTPException(422, m.SELF_DISABLE)
    if body.department_ids is not None:
        _check_department_ids(session, body.department_ids)
    if body.access_level is not None:
        user.access_level = body.access_level
    if body.is_active is not None:
        user.is_active = body.is_active
    if body.department_ids is not None:
        _set_departments(session, user.id, body.department_ids)
    log_action(session, me.id, "user.update", target_user_id=user.id, changes=body.model_dump(exclude_none=True))
    session.commit()
    return _public_user(user, _department_ids_by_user(session).get(user.id, []))


class PasswordBody(BaseModel):
    password: str


@router.post("/users/{user_id}/password")
def reset_password(user_id: int, body: PasswordBody, me: User = Depends(require_manager), session: Session = Depends(get_session)) -> dict:
    user = _get_user(session, user_id)
    if not password_is_valid(body.password):
        raise HTTPException(422, m.PASSWORD_INVALID)
    user.password_hash = hash_password(body.password)
    user.token_version = (user.token_version or 0) + 1  # сессии пользователя закрыты
    log_action(session, me.id, "core.password_reset", target_user_id=user.id)
    session.commit()
    return {}


# ---------- онбординг нового сотрудника ----------


def _onboarding_out(session: Session) -> dict:
    row = onboarding.settings_row(session)
    updated_by = session.get(User, row.updated_by) if row and row.updated_by else None
    return {
        "passwordSet": bool(row and row.password_hash),
        "domain": onboarding.SELF_REGISTER_DOMAINS[0],
        "domains": list(onboarding.SELF_REGISTER_DOMAINS),
        "updatedAt": row.updated_at.isoformat() if row and row.password_hash and row.updated_at else None,
        "updatedBy": updated_by.full_name if updated_by else None,
        "ttlDays": onboarding.ONBOARDING_TTL_DAYS,
        "dailyLimit": onboarding.SELF_REGISTER_DAILY_LIMIT,
        "registeredToday": onboarding.self_register_count_24h(session),
    }


@router.get("/onboarding")
def get_onboarding(_: User = Depends(require_manager), session: Session = Depends(get_session)) -> dict:
    return _onboarding_out(session)


class OnboardingPasswordBody(BaseModel):
    password: str


@router.post("/onboarding/password")
def set_onboarding_password(body: OnboardingPasswordBody, me: User = Depends(require_manager), session: Session = Depends(get_session)) -> dict:
    pw = body.password
    if pw == "":  # пусто = очистить общий пароль: самосоздание и вход общим паролем выключены
        row = onboarding.settings_row(session)
        if row is not None:
            row.password_hash = None
            row.updated_at = datetime.now(UTC)
            row.updated_by = me.id
        log_action(session, me.id, "core.onboarding_password_clear")
        session.commit()
        return _onboarding_out(session)
    if len(pw) < onboarding.SHARED_PASSWORD_MIN_LEN or len(pw) > CHANGE_MAX_CHARS or len(pw.encode()) > MAX_PASSWORD_BYTES:
        raise HTTPException(422, m.ONBOARDING_PASSWORD_INVALID)
    row = onboarding.settings_row(session)
    if row is None:  # строка создаётся миграцией; на случай её отсутствия создаём
        row = OnboardingSettings(id=1)
        session.add(row)
    row.password_hash = hash_password(pw)
    row.updated_at = datetime.now(UTC)
    row.updated_by = me.id
    log_action(session, me.id, "core.onboarding_password_set")  # без значения
    session.commit()
    return _onboarding_out(session)


def _get_onboarding_user(session: Session, user_id: int) -> User:
    user = _get_user(session, user_id)
    if not user.onboarding:
        raise HTTPException(422, m.ONBOARDING_NOT_ACTIVE)
    return user


@router.post("/users/{user_id}/onboarding/extend")
def extend_onboarding(user_id: int, me: User = Depends(require_manager), session: Session = Depends(get_session)) -> dict:
    user = _get_user(session, user_id)
    if not (user.onboarding and user.must_change_password):
        raise HTTPException(422, m.ONBOARDING_EXTEND_NOT_ALLOWED)
    user.onboarding_expires_at = datetime.now(UTC) + timedelta(days=onboarding.ONBOARDING_TTL_DAYS)
    log_action(session, me.id, "user.onboarding_extend", target_user_id=user.id)
    session.commit()
    return _public_user(user, _department_ids_by_user(session).get(user.id, []))


class FinishOnboardingBody(BaseModel):
    access_level: str
    department_ids: list[int] = []


@router.post("/users/{user_id}/onboarding/finish")
def finish_user_onboarding(
    user_id: int, body: FinishOnboardingBody, me: User = Depends(require_manager), session: Session = Depends(get_session)
) -> dict:
    user = _get_onboarding_user(session, user_id)
    if user.must_change_password:
        raise HTTPException(422, m.ONBOARDING_PASSWORD_PENDING)
    try:
        onboarding.finish_onboarding(session, user, body.access_level, body.department_ids, ACCESS_LEVELS)
        log_action(
            session, me.id, "user.onboarding_finish", target_user_id=user.id, access_level=user.access_level, department_ids=sorted(set(body.department_ids))
        )
        session.commit()
    except IntegrityError:  # например, отдел удалён между проверкой и записью
        session.rollback()
        raise HTTPException(409, m.CONFLICT) from None
    return _public_user(user, _department_ids_by_user(session).get(user.id, []))


@router.post("/users/{user_id}/onboarding/delete")
def delete_onboarding_user(user_id: int, me: User = Depends(require_manager), session: Session = Depends(get_session)) -> dict:
    user = _get_onboarding_user(session, user_id)
    if user.id == me.id:
        raise HTTPException(422, m.SELF_DISABLE)
    # Запись для разбора пишется до удаления; user_id в журнале после удаления станет NULL
    log_action(
        session,
        me.id,
        "user.onboarding_delete",
        target_user_id=user.id,
        email=user.email,
        created_at=user.created_at.isoformat() if user.created_at else None,
        last_login_at=user.last_login_at.isoformat() if user.last_login_at else None,
    )
    session.delete(user)
    session.commit()
    return {}


# ---------- отделы ----------


def _department_out(session: Session, department: Department) -> dict:
    count = session.scalar(
        select(func.count())
        .select_from(UserDepartment)
        .join(User, User.id == UserDepartment.user_id)
        .where(UserDepartment.department_id == department.id, User.is_active.is_(True))
    )
    return {"id": department.id, "code": department.code, "name": department.name, "user_count": count or 0}


@router.get("/departments")
def list_departments(_: User = Depends(require_manager), session: Session = Depends(get_session)) -> list[dict]:
    return [_department_out(session, d) for d in session.scalars(select(Department).order_by(Department.id))]


class CreateDepartmentBody(BaseModel):
    code: str
    name: str


@router.post("/departments")
def create_department(body: CreateDepartmentBody, me: User = Depends(require_manager), session: Session = Depends(get_session)) -> dict:
    existing = session.execute(select(Department.id, Department.name, Department.code)).all()
    name_problem = validate_department_name(body.name, [(i, n) for i, n, _ in existing])
    if name_problem:
        raise HTTPException(409 if name_problem == m.NAME_DUPLICATE else 422, name_problem)
    code_problem = validate_department_code(body.code, [c for _, _, c in existing])
    if code_problem:
        raise HTTPException(409 if code_problem == m.CODE_DUPLICATE else 422, code_problem)
    department = Department(code=body.code, name=body.name.strip())
    session.add(department)
    try:
        session.flush()
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, m.CONFLICT) from None
    log_action(session, me.id, "department.create", department_id=department.id, code=department.code)
    session.commit()
    return _department_out(session, department)


class PatchDepartmentBody(BaseModel):
    name: str | None = None
    code: str | None = None


@router.patch("/departments/{department_id}")
def rename_department(department_id: int, body: PatchDepartmentBody, me: User = Depends(require_manager), session: Session = Depends(get_session)) -> dict:
    department = session.get(Department, department_id)
    if department is None:
        raise HTTPException(404, m.DEPARTMENT_NOT_FOUND)
    if body.code is not None:
        raise HTTPException(422, m.CODE_IMMUTABLE)
    existing = session.execute(select(Department.id, Department.name)).all()
    problem = validate_department_name(body.name, [(i, n) for i, n in existing], department.id)
    if problem:
        raise HTTPException(409 if problem == m.NAME_DUPLICATE else 422, problem)
    department.name = body.name.strip()
    log_action(session, me.id, "department.rename", department_id=department.id, name=department.name)
    session.commit()
    return _department_out(session, department)


# ---------- группы доступа ----------
# TODO(Q-G4): удаление групп не реализовано — группу можно обнулить (убрать права и участников)


def _group_out(session: Session, group: AccessGroup) -> dict:
    permissions = {
        module_id: permission
        for module_id, permission in session.execute(
            select(AccessGroupPermission.module_id, AccessGroupPermission.permission).where(AccessGroupPermission.group_id == group.id)
        )
    }
    user_ids = sorted(session.scalars(select(AccessGroupMember.user_id).where(AccessGroupMember.group_id == group.id)).all())
    active = (
        session.scalar(
            select(func.count())
            .select_from(AccessGroupMember)
            .join(User, User.id == AccessGroupMember.user_id)
            .where(AccessGroupMember.group_id == group.id, User.is_active.is_(True))
        )
        or 0
    )
    return {"id": group.id, "name": group.name, "permissions": permissions, "user_ids": user_ids, "user_count": active}


def _check_user_ids(session: Session, ids: list[int]) -> None:
    found = set(session.scalars(select(User.id).where(User.id.in_(ids))).all()) if ids else set()
    if set(ids) != found:
        raise HTTPException(422, m.UNKNOWN_USER)


def _check_permissions(permissions: dict[str, str]) -> None:
    module_ids = {mod.id for mod in MODULES}
    for module_id, permission in permissions.items():
        if module_id not in module_ids:
            raise HTTPException(422, m.UNKNOWN_MODULE)
        if permission not in GROUP_PERMISSIONS:
            raise HTTPException(422, m.UNKNOWN_PERMISSION)


def _set_permissions(session: Session, group_id: int, permissions: dict[str, str]) -> None:
    session.query(AccessGroupPermission).filter(AccessGroupPermission.group_id == group_id).delete()
    for module_id, permission in sorted(permissions.items()):
        session.add(AccessGroupPermission(group_id=group_id, module_id=module_id, permission=permission))


def _set_members(session: Session, group_id: int, ids: list[int]) -> None:
    session.query(AccessGroupMember).filter(AccessGroupMember.group_id == group_id).delete()
    for user_id in sorted(set(ids)):
        session.add(AccessGroupMember(group_id=group_id, user_id=user_id))


def _check_group_name(session: Session, name: str | None, self_id: int | None = None) -> None:
    existing = session.execute(select(AccessGroup.id, AccessGroup.name)).all()
    problem = validate_group_name(name, [(i, n) for i, n in existing], self_id)
    if problem:
        raise HTTPException(409 if problem == m.GROUP_NAME_DUPLICATE else 422, problem)


@router.get("/groups")
def list_groups(_: User = Depends(require_manager), session: Session = Depends(get_session)) -> list[dict]:
    return [_group_out(session, g) for g in session.scalars(select(AccessGroup).order_by(AccessGroup.id))]


class CreateGroupBody(BaseModel):
    name: str
    permissions: dict[str, str] = {}
    user_ids: list[int] = []


@router.post("/groups")
def create_group(body: CreateGroupBody, me: User = Depends(require_manager), session: Session = Depends(get_session)) -> dict:
    _check_group_name(session, body.name)
    _check_permissions(body.permissions)
    _check_user_ids(session, body.user_ids)
    group = AccessGroup(name=body.name.strip())
    session.add(group)
    try:
        session.flush()
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, m.GROUP_NAME_DUPLICATE) from None
    _set_permissions(session, group.id, body.permissions)
    _set_members(session, group.id, body.user_ids)
    log_action(
        session, me.id, "group.create", group_id=group.id, name=group.name, permissions=body.permissions, user_ids=sorted(set(body.user_ids))
    )
    session.commit()
    return _group_out(session, group)


class PatchGroupBody(BaseModel):
    name: str | None = None
    permissions: dict[str, str] | None = None
    user_ids: list[int] | None = None


@router.patch("/groups/{group_id}")
def patch_group(group_id: int, body: PatchGroupBody, me: User = Depends(require_manager), session: Session = Depends(get_session)) -> dict:
    group = session.get(AccessGroup, group_id)
    if group is None:
        raise HTTPException(404, m.GROUP_NOT_FOUND)
    if body.name is not None:
        _check_group_name(session, body.name, group.id)
    if body.permissions is not None:
        _check_permissions(body.permissions)
    if body.user_ids is not None:
        _check_user_ids(session, body.user_ids)
    changes: dict = {}
    # autoflush срабатывает на любом запросе внутри блока, поэтому уникальность имени ловим вокруг всего блока
    try:
        if body.name is not None and body.name.strip() != group.name:
            group.name = body.name.strip()
            changes["name"] = group.name
        if body.permissions is not None:
            if body.permissions != _group_out(session, group)["permissions"]:
                changes["permissions"] = body.permissions
            _set_permissions(session, group.id, body.permissions)
        if body.user_ids is not None:
            before = set(session.scalars(select(AccessGroupMember.user_id).where(AccessGroupMember.group_id == group.id)).all())
            after = set(body.user_ids)
            if after - before:
                changes["added_user_ids"] = sorted(after - before)
            if before - after:
                changes["removed_user_ids"] = sorted(before - after)
            _set_members(session, group.id, body.user_ids)
        session.flush()
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, m.GROUP_NAME_DUPLICATE) from None
    log_action(session, me.id, "group.update", group_id=group.id, **changes)
    session.commit()
    return _group_out(session, group)


# ---------- личные права на модуль (в дополнение к групповым; итог — максимум) ----------


def _user_permissions(session: Session, user_id: int) -> dict[str, str]:
    return {
        module_id: permission
        for module_id, permission in session.execute(
            select(UserModulePermission.module_id, UserModulePermission.permission)
            .where(UserModulePermission.user_id == user_id)
            .order_by(UserModulePermission.module_id)
        )
    }


@router.get("/users/{user_id}/module-permissions")
def get_user_permissions(user_id: int, _: User = Depends(require_manager), session: Session = Depends(get_session)) -> dict:
    _get_user(session, user_id)
    return {"permissions": _user_permissions(session, user_id)}


class UserPermissionBody(BaseModel):
    moduleId: str
    permission: str | None = None


@router.patch("/users/{user_id}/module-permissions")
def set_user_permission(
    user_id: int, body: UserPermissionBody, me: User = Depends(require_manager), session: Session = Depends(get_session)
) -> dict:
    _get_user(session, user_id)
    _check_permissions({body.moduleId: body.permission or GROUP_PERMISSIONS[0]})
    existing = session.get(UserModulePermission, (user_id, body.moduleId))
    if body.permission is None:
        if existing is not None:
            session.delete(existing)
    elif existing is None:
        session.add(UserModulePermission(user_id=user_id, module_id=body.moduleId, permission=body.permission))
    else:
        existing.permission = body.permission
    log_action(session, me.id, "core.user_permission_set", target_user_id=user_id, module_id=body.moduleId, permission=body.permission)
    session.commit()
    return {"permissions": _user_permissions(session, user_id)}
