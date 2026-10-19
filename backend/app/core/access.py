"""Права доступа. Чистые функции; зеркало frontend/src/core/access.js (проверяется тестами по тем же случаям)."""
from collections.abc import Iterable

ACCESS_LEVELS = ("admin", "superuser", "employee", "viewer")


ACCESS_ORDER = ("none", "structure", "view", "run")
GROUP_PERMISSIONS = ("view", "run", "responsible")


# Доступ к модулю: 'none' | 'structure' | 'view' | 'run'
def compute_module_access(
    *,
    access_level: str | None,
    is_active: bool,
    department_ids: Iterable[int],
    module_department_ids: Iterable[int],
    group_permissions: Iterable[str] = (),
) -> str:
    base = _base_access(access_level, is_active, department_ids, module_department_ids)
    if base == "none":
        return "none"
    # Группы только расширяют права; неизвестные значения игнорируются
    permissions = set(group_permissions)
    # TODO(Q-G1): группа поднимает и viewer
    if "run" in permissions or "responsible" in permissions:
        granted = "run"
    elif "view" in permissions:
        granted = "view"
    else:
        granted = "none"
    return max(base, granted, key=ACCESS_ORDER.index)


def _base_access(access_level, is_active, department_ids, module_department_ids) -> str:
    if access_level is None or not is_active or access_level not in ACCESS_LEVELS:
        return "none"
    if access_level in ("admin", "superuser"):
        return "run"
    if access_level == "viewer":
        return "structure"
    shared = set(department_ids) & set(module_department_ids)
    return "run" if shared else "view"


def is_module_responsible(*, access_level: str | None, is_active: bool, group_permissions: Iterable[str]) -> bool:
    """Ответственный по группе (право `responsible`). Сам по себе уровень admin/superuser ответственным не делает."""
    # TODO(Q-G2): admin/superuser автоматически не ответственные
    return bool(is_active) and access_level in ACCESS_LEVELS and "responsible" in set(group_permissions)


def can_see_data(access: str) -> bool:
    return access in ("view", "run")


def can_run(access: str) -> bool:
    return access == "run"


def can_manage_users(*, access_level: str | None, is_active: bool) -> bool:
    return bool(is_active) and access_level == "admin"
