"""Те же 16 случаев, что в frontend/src/core/access.test.js: бэкенд и фронтенд не должны расходиться."""
import pytest

from app.core.access import can_manage_users, can_run, can_see_data, compute_module_access, is_module_responsible


def u(level, deps, active=True):
    return {"access_level": level, "is_active": active, "department_ids": deps}


CASES = [
    (1, u("admin", []), [1], "run"),
    (2, u("admin", [1]), [1], "run"),
    (3, u("superuser", []), [1], "run"),
    (4, u("superuser", [2]), [1], "run"),
    (5, u("employee", [1]), [1], "run"),
    (6, u("employee", [2]), [1], "view"),
    (7, u("viewer", [1]), [1], "structure"),
    (8, u("viewer", [2]), [1], "structure"),
    (9, u("employee", []), [1], "view"),
    (10, u("employee", [1]), [], "view"),
    (11, u("employee", [2]), [1, 2], "run"),
    (12, u("employee", [1, 3]), [3], "run"),
    (13, u("employee", [1], active=False), [1], "none"),
    (14, u("boss", [1]), [1], "none"),
    (16, u("admin", [], active=False), [1], "none"),
]


@pytest.mark.parametrize("n,user,module_deps,expected", CASES)
def test_compute_module_access(n, user, module_deps, expected):
    assert (
        compute_module_access(
            access_level=user["access_level"],
            is_active=user["is_active"],
            department_ids=user["department_ids"],
            module_department_ids=module_deps,
        )
        == expected
    )


def test_no_user():
    assert compute_module_access(access_level=None, is_active=True, department_ids=[], module_department_ids=[1]) == "none"


def test_can_manage_users():
    assert can_manage_users(access_level="admin", is_active=True)
    assert not can_manage_users(access_level="superuser", is_active=True)
    assert not can_manage_users(access_level="admin", is_active=False)


def test_can_see_and_run():
    assert [can_see_data(a) for a in ("none", "structure", "view", "run")] == [False, False, True, True]
    assert [can_run(a) for a in ("none", "structure", "view", "run")] == [False, False, False, True]


# Случаи 17–27 и R1–R6 одинаковы в frontend/src/core/access.test.js
GROUP_CASES = [
    (17, u("viewer", []), [1], ["view"], "view"),
    (18, u("viewer", []), [1], ["run"], "run"),
    (19, u("employee", [2]), [1], ["view"], "view"),
    (20, u("employee", [2]), [1], ["run"], "run"),
    (21, u("employee", [2]), [1], ["responsible"], "run"),
    (22, u("employee", [1]), [1], ["view"], "run"),
    (23, u("employee", [1], active=False), [1], ["run"], "none"),
    (24, u("boss", [1]), [1], ["run"], "none"),
    (25, u("superuser", []), [1], ["view"], "run"),
    (26, u("viewer", []), [1], ["view", "run"], "run"),
    (27, u("viewer", []), [1], [], "structure"),
]


@pytest.mark.parametrize("n,user,module_deps,group_permissions,expected", GROUP_CASES)
def test_compute_module_access_with_groups(n, user, module_deps, group_permissions, expected):
    assert (
        compute_module_access(
            access_level=user["access_level"],
            is_active=user["is_active"],
            department_ids=user["department_ids"],
            module_department_ids=module_deps,
            group_permissions=group_permissions,
        )
        == expected
    )


def test_group_permissions_default_is_empty():
    for _, user, module_deps, _, _ in GROUP_CASES:
        args = dict(
            access_level=user["access_level"], is_active=user["is_active"], department_ids=user["department_ids"], module_department_ids=module_deps
        )
        assert compute_module_access(**args) == compute_module_access(**args, group_permissions=[])


def test_unknown_group_permissions_ignored():
    assert (
        compute_module_access(access_level="viewer", is_active=True, department_ids=[], module_department_ids=[1], group_permissions=["boss"])
        == "structure"
    )


RESPONSIBLE_CASES = [
    ("R1", "employee", True, ["responsible"], True),
    ("R2", "employee", True, ["run"], False),
    ("R3", "admin", True, [], False),
    ("R4", "employee", False, ["responsible"], False),
    ("R5", "viewer", True, ["responsible"], True),
    ("R6", "boss", True, ["responsible"], False),
]


@pytest.mark.parametrize("n,level,active,group_permissions,expected", RESPONSIBLE_CASES)
def test_is_module_responsible(n, level, active, group_permissions, expected):
    assert is_module_responsible(access_level=level, is_active=active, group_permissions=group_permissions) is expected
