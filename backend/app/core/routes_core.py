from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.access import can_manage_users, compute_module_access
from app.core.deps import get_current_user
from app.core.models import Department, ModuleDepartment, User, UserDepartment
from app.core.registry import MODULES
from app.db.database import get_session

router = APIRouter(prefix="/core", tags=["core"])


@router.get("/me")
def me(user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> dict:
    departments = session.scalars(
        select(Department)
        .join(UserDepartment, UserDepartment.department_id == Department.id)
        .where(UserDepartment.user_id == user.id)
        .order_by(Department.id)
    ).all()
    module_deps: dict[str, list[int]] = {}
    for module_id, department_id in session.execute(select(ModuleDepartment.module_id, ModuleDepartment.department_id)):
        module_deps.setdefault(module_id, []).append(department_id)
    own = [d.id for d in departments]
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "access_level": user.access_level,
        "departments": [{"id": d.id, "code": d.code, "name": d.name} for d in departments],
        "can_manage_users": can_manage_users(access_level=user.access_level, is_active=user.is_active),
        "module_access": {
            mod.id: compute_module_access(
                access_level=user.access_level,
                is_active=user.is_active,
                department_ids=own,
                module_department_ids=module_deps.get(mod.id, []),
            )
            for mod in MODULES
        },
    }


@router.get("/runs")
def runs(limit: int = 5, user: User = Depends(get_current_user)) -> list:
    # Таблицы задач пока нет (очередь — следующий этап): «последние запуски» пусты
    return []
