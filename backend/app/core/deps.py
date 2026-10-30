from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import messages as m
from app.core.access import can_manage_users, can_run, compute_module_access, is_module_responsible
from app.core.models import AccessGroupMember, AccessGroupPermission, ModuleDepartment, User, UserDepartment, UserModulePermission
from app.core.security import read_token_claims
from app.db.database import get_session

bearer = HTTPBearer(auto_error=False)

ONBOARDING_CODE = "onboarding_required"


class OnboardingRequired(HTTPException):
    """403 для новичка, который ещё не завершил первый вход: сменил пароль, отправил анкету и получил одобрение HR."""

    def __init__(self) -> None:
        super().__init__(403, m.ONBOARDING_REQUIRED)


def get_authenticated_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    session: Session = Depends(get_session),
) -> User:
    claims = read_token_claims(credentials.credentials) if credentials else None
    # Пользователь перечитывается из БД на каждом запросе: отключённый теряет доступ сразу, не дожидаясь конца токена
    user = session.get(User, claims[0]) if claims is not None else None
    # Смена/сброс пароля увеличивает token_version: прежние токены перестают действовать
    if user is None or not user.is_active or claims[1] != (user.token_version or 0):
        raise HTTPException(401, m.UNAUTHORIZED)
    return user


def get_current_user(user: User = Depends(get_authenticated_user)) -> User:
    """Все маршруты, кроме /core/me, /auth/change-password и анкеты новичка (own_profile_user), закрыты для новичка здесь."""
    if user.must_change_password or user.onboarding:
        raise OnboardingRequired()
    return user


def require_manager(user: User = Depends(get_current_user)) -> User:
    if not can_manage_users(access_level=user.access_level, is_active=user.is_active):
        raise HTTPException(403, m.FORBIDDEN)
    return user


def module_rights(session: Session, user: User, module_ids: list[str]) -> dict[str, tuple[str, bool]]:
    """{module_id: (access, responsible)}; читается из БД на каждый вызов (права групп и личные права действуют сразу)."""
    from app.core.registry import MODULES  # отложенный импорт: registry тянет роутеры модулей, а они — deps

    for_all_ids = {mod.id for mod in MODULES if mod.for_all}
    own = session.scalars(select(UserDepartment.department_id).where(UserDepartment.user_id == user.id)).all()
    module_deps: dict[str, list[int]] = {}
    group_perms: dict[str, list[str]] = {}
    if module_ids:
        for module_id, department_id in session.execute(
            select(ModuleDepartment.module_id, ModuleDepartment.department_id).where(ModuleDepartment.module_id.in_(module_ids))
        ):
            module_deps.setdefault(module_id, []).append(department_id)
        for module_id, permission in session.execute(
            select(AccessGroupPermission.module_id, AccessGroupPermission.permission)
            .join(AccessGroupMember, AccessGroupMember.group_id == AccessGroupPermission.group_id)
            .where(AccessGroupMember.user_id == user.id, AccessGroupPermission.module_id.in_(module_ids))
        ):
            group_perms.setdefault(module_id, []).append(permission)
        # Личные права (user_module_permissions) складываются с групповыми: итог — максимум
        for module_id, permission in session.execute(
            select(UserModulePermission.module_id, UserModulePermission.permission).where(
                UserModulePermission.user_id == user.id, UserModulePermission.module_id.in_(module_ids)
            )
        ):
            group_perms.setdefault(module_id, []).append(permission)
    return {
        module_id: (
            compute_module_access(
                access_level=user.access_level,
                is_active=user.is_active,
                department_ids=own,
                module_department_ids=module_deps.get(module_id, []),
                group_permissions=group_perms.get(module_id, []),
                for_all=module_id in for_all_ids,
            ),
            is_module_responsible(
                access_level=user.access_level, is_active=user.is_active, group_permissions=group_perms.get(module_id, [])
            ),
        )
        for module_id in module_ids
    }


def require_module_run(module_id: str):
    """Зависимость: пользователь может запускать модуль (admin/superuser, сотрудник отдела модуля или участник группы с правом запуска)."""

    def dependency(user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> User:
        access, _ = module_rights(session, user, [module_id])[module_id]
        if not can_run(access):
            raise HTTPException(403, m.FORBIDDEN)
        return user

    return dependency


def module_responsible(module_id: str):
    """Зависимость: True, если пользователь ответственный по группе за модуль. Исключений не бросает."""

    def dependency(user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> bool:
        return module_rights(session, user, [module_id])[module_id][1]

    return dependency
