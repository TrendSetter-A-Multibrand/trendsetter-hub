"""Расчёт баланса отпуска. Чистые функции без БД (даты и числа приходят аргументами).

Единица — календарные дни. TODO(Q-D1): нормы Армении и порядок подсчёта сверить с юристом/бухгалтером.
TODO(Q-D2): праздничные дни внутри отпуска считаются как обычные.
"""
import calendar
from collections.abc import Iterable
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

CENT = Decimal("0.01")


def request_days(start: date, end: date) -> Decimal:
    """Календарные дни включительно."""
    return Decimal((end - start).days + 1)


def full_months(since: date, today: date) -> int:
    """Полные месяцы от даты приёма до сегодняшнего дня (0, если дата в будущем)."""
    months = (today.year - since.year) * 12 + today.month - since.month
    if today.day < since.day:
        months -= 1
    return max(months, 0)


def add_months(d: date, months: int) -> date:
    """Дата через N месяцев; если в целевом месяце нет такого дня — последний день месяца."""
    index = d.year * 12 + d.month - 1 + months
    year, month = divmod(index, 12)
    month += 1
    return date(year, month, min(d.day, calendar.monthrange(year, month)[1]))


def compute_balance(
    *,
    hired_at: date | None,
    accrual_per_month: Decimal,
    first_leave_after_months: int,
    adjust: Decimal,
    requests: Iterable[tuple[str, str, date, Decimal]],  # (kind, status, end_date, days)
    today: date,
) -> dict | None:
    """Баланс на сегодня; None, если HR не указал дату приёма.

    accrued = полные месяцы × норма в месяц (до сотых); used — одобренные ежегодные с end < today, planned — с end >= today;
    available = accrued + adjust - used - planned. available_from — дата, с которой возникает право (если оно ещё не наступило).
    """
    if hired_at is None:
        return None
    months = full_months(hired_at, today)
    accrued = (Decimal(months) * Decimal(accrual_per_month)).quantize(CENT, rounding=ROUND_HALF_UP)
    used = planned = Decimal(0)
    for kind, status, end_date, days in requests:
        if kind != "annual" or status != "approved":
            continue
        if end_date < today:
            used += Decimal(days)
        else:
            planned += Decimal(days)
    available_from = add_months(hired_at, first_leave_after_months) if months < first_leave_after_months else None
    return {
        "accrued": accrued,
        "adjust": Decimal(adjust),
        "used": used,
        "planned": planned,
        "available": accrued + Decimal(adjust) - used - planned,
        "available_from": available_from,
    }
