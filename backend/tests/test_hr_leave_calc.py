"""Расчёт баланса отпуска: чистые функции, без БД."""
from datetime import date
from decimal import Decimal

from app.modules.hr import leave

TODAY = date(2026, 10, 23)
RATE = Decimal("2.333")


def balance(hired, requests=(), adjust=0, first=0):
    return leave.compute_balance(
        hired_at=hired, accrual_per_month=RATE, first_leave_after_months=first, adjust=Decimal(adjust), requests=list(requests), today=TODAY
    )


def test_full_months():
    assert leave.full_months(date(2026, 4, 23), TODAY) == 6
    assert leave.full_months(date(2026, 4, 24), TODAY) == 5  # день месяца ещё не наступил
    assert leave.full_months(date(2027, 1, 1), TODAY) == 0  # приём в будущем


def test_add_months_clamps_to_month_end():
    assert leave.add_months(date(2026, 8, 31), 6) == date(2027, 2, 28)
    assert leave.add_months(date(2026, 4, 23), 6) == date(2026, 10, 23)


def test_request_days_inclusive():
    assert leave.request_days(date(2026, 11, 2), date(2026, 11, 2)) == 1
    assert leave.request_days(date(2026, 11, 2), date(2026, 11, 15)) == 14


def test_no_hire_date_means_no_balance():
    assert balance(None) is None


def test_accrual_rounding():
    b = balance(date(2026, 4, 23))  # 6 полных месяцев: 13.998 -> 14.00
    assert b["accrued"] == Decimal("14.00") and b["available"] == Decimal("14.00") and b["available_from"] is None


def test_used_and_planned_only_for_approved_annual():
    requests = [
        ("annual", "approved", date(2026, 10, 1), Decimal(5)),  # использовано (end < today)
        ("annual", "approved", date(2026, 10, 23), Decimal(3)),  # запланировано (end >= today)
        ("annual", "approved", date(2026, 12, 31), Decimal(7)),
        ("annual", "pending", date(2026, 12, 31), Decimal(20)),  # не учитывается
        ("annual", "rejected", date(2026, 12, 31), Decimal(20)),
        ("unpaid", "approved", date(2026, 12, 31), Decimal(9)),  # не annual
        ("sick", "approved", date(2026, 10, 1), Decimal(4)),
    ]
    b = balance(date(2025, 10, 23), requests, adjust=2)  # 12 месяцев: 27.996 -> 28.00
    assert (b["accrued"], b["adjust"], b["used"], b["planned"]) == (Decimal("28.00"), Decimal(2), Decimal(5), Decimal(10))
    assert b["available"] == Decimal("28.00") + 2 - 5 - 10


def test_negative_adjustment():
    assert balance(date(2025, 10, 23), adjust=-10)["available"] == Decimal("18.00")


def test_first_leave_right_not_reached():
    b = balance(date(2026, 8, 31), first=6)  # 1 полный месяц
    assert b["available_from"] == date(2027, 2, 28)
    assert b["accrued"] == Decimal("2.33")
