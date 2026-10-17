"""Права доступа. Чистые функции; зеркало frontend/src/core/access.js (проверяется тестами по тем же случаям)."""
from collections.abc import Iterable

ACCESS_LEVELS = ("admin", "superuser", "employee", "viewer")


# Доступ к модулю: 'none' | 'structure' | 'view' | 'run'
def compute_module_access(
    *, access_level: str | None, is_active: bool, department_ids: Iterable[int], module_department_ids: Iterable[int]
) -> str:
    if access_level is None or not is_active or access_level not in ACCESS_LEVELS:
        return "none"
    if access_level in ("admin", "superuser"):
        return "run"
    if access_level == "viewer":
        return "structure"
    shared = set(department_ids) & set(module_department_ids)
    return "run" if shared else "view"


def can_see_data(access: str) -> bool:
    return access in ("view", "run")


def can_run(access: str) -> bool:
    return access == "run"


def can_manage_users(*, access_level: str | None, is_active: bool) -> bool:
    return bool(is_active) and access_level == "admin"
