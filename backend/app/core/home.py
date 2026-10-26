"""Главная страница: погода (MET Norway) и курсы ЦБ РФ. Контракт — docs/TZ-home.md.

Внешний HTTP — только через _http_get (осознанное исключение из правила «тяжёлое — в воркере»: лёгкий GET, таймаут 5 с,
не чаще раза в час, под блокировкой). Кэш — в памяти процесса: uvicorn один (backend/Dockerfile); TODO(Q-H4) при нескольких процессах.
БД не используется. В лог — только тип ошибки, без тела ответа.
"""

import logging
import math
import re
import threading
from datetime import date, datetime, time, timedelta, timezone
from email.utils import parsedate_to_datetime
from zoneinfo import ZoneInfo

import httpx

log = logging.getLogger(__name__)

# TODO(Q-H3): подтвердить контакт в User-Agent (домен или e-mail)
USER_AGENT = "TrendsetterHub/1.0 (+https://trendsettercrew.com)"
HTTP_TIMEOUT = 5.0

MET_URL = "https://api.met.no/weatherapi/locationforecast/2.0/complete?lat={lat:.4f}&lon={lon:.4f}"
MET_SOURCE = "MET Norway"
# TODO(Q-H7): города и валюты — жёсткие константы
CITIES = (
    {"id": "yerevan", "lat": 40.1792, "lon": 44.4991, "timezone": "Asia/Yerevan"},
    {"id": "moscow", "lat": 55.7558, "lon": 37.6173, "timezone": "Europe/Moscow"},
)
WEATHER_DAYS = 7
WEATHER_MIN_INTERVAL = 3600  # не чаще раза в час
WEATHER_MAX_AGE = 24 * 3600  # старше — не отдаём
RETRY_AFTER_FAILURE = 600

# TODO(Q-H2): неофициальное JSON-зеркало ЦБ; официальный XML (cp1251) — запасной вариант
RATES_URL = "https://www.cbr-xml-daily.ru/daily_json.js"
RATES_SOURCE = "ЦБ РФ"
RATES_CODES = ("USD", "EUR", "AMD")
RATES_MIN_INTERVAL = 3 * 3600
RATES_MAX_AGE = 4 * 24 * 3600

_SYMBOL_SUFFIX = re.compile(r"_(day|night|polartwilight)$")
_lock = threading.Lock()
_rates_lock = threading.Lock()


class SourceError(Exception):
    """Источник ответил не 200 или ответ не разобрался."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _http_get(url: str, headers: dict) -> httpx.Response:
    return httpx.get(url, headers=headers, timeout=HTTP_TIMEOUT)


def _ts() -> float:
    return _now().timestamp()


# ---- погода: чистые функции ----


def round_half_up(x: float) -> int:
    return math.floor(x + 0.5)


def strip_symbol(code: str | None) -> str | None:
    return _SYMBOL_SUFFIX.sub("", code) if code else None


def _symbol_of(point: dict, key: str) -> str | None:
    return (((point["data"].get(key) or {}).get("summary") or {}).get("symbol_code")) or None


def pick_symbol(points: list[tuple[datetime, dict]], day: date, tz: ZoneInfo) -> str | None:
    """Символ дня: слот next_6_hours, покрывающий 12:00 (самый поздний); иначе ближайший к 12:00; иначе по next_1_hours."""
    noon = datetime.combine(day, time(12, 0), tzinfo=tz)
    day_points = [(t, p) for t, p in points if t.date() == day]
    for key in ("next_6_hours", "next_1_hours"):
        candidates = [(t, _symbol_of(p, key)) for t, p in day_points if _symbol_of(p, key)]
        if not candidates:
            continue
        if key == "next_6_hours":
            covering = [(t, s) for t, s in candidates if t <= noon < t + timedelta(hours=6)]
            if covering:
                return strip_symbol(max(covering, key=lambda c: c[0])[1])
        best = min(candidates, key=lambda c: (abs(c[0] - noon), c[0]))
        return strip_symbol(best[1])
    return None


def aggregate_days(timeseries: list[dict], tz_name: str) -> dict[str, dict]:
    """{ 'YYYY-MM-DD': {min, max, symbol} } по местным датам города (см. TZ-home.md, «Агрегация по дням»)."""
    tz = ZoneInfo(tz_name)
    points: list[tuple[datetime, dict]] = []
    for item in timeseries:
        try:
            t = datetime.fromisoformat(item["time"].replace("Z", "+00:00")).astimezone(tz)
        except (KeyError, ValueError, AttributeError):
            continue
        if isinstance(item.get("data"), dict):
            points.append((t, item))
    temps: dict[date, list[float]] = {}
    for t, item in points:
        details = ((item["data"].get("instant") or {}).get("details")) or {}
        if isinstance(details.get("air_temperature"), (int, float)):
            temps.setdefault(t.date(), []).append(details["air_temperature"])
        d6 = ((item["data"].get("next_6_hours") or {}).get("details")) or {}
        end = (t.astimezone(timezone.utc) + timedelta(hours=6)).astimezone(tz)
        inside = end.date() == t.date() or (end.date() == t.date() + timedelta(days=1) and end.timetz().replace(tzinfo=None) == time(0, 0))
        if inside:
            for k in ("air_temperature_min", "air_temperature_max"):
                if isinstance(d6.get(k), (int, float)):
                    temps.setdefault(t.date(), []).append(d6[k])
    out = {}
    for day, values in temps.items():
        out[day.isoformat()] = {
            "min": round_half_up(min(values)),
            "max": round_half_up(max(values)),
            "symbol": pick_symbol(points, day, tz),
        }
    return out


def parse_met(payload: dict, tz_name: str) -> tuple[str | None, dict[str, dict]]:
    props = payload["properties"]
    return (props.get("meta") or {}).get("updated_at"), aggregate_days(props["timeseries"], tz_name)


def select_days(days_by_date: dict[str, dict], tz_name: str, now: datetime) -> list[dict]:
    """До 7 дней начиная с «сегодня» в зоне города; даты без данных не выводятся."""
    today = now.astimezone(ZoneInfo(tz_name)).date().isoformat()
    dates = sorted(d for d in days_by_date if d >= today)[:WEATHER_DAYS]
    return [{"date": d, **days_by_date[d]} for d in dates]


# ---- погода: кэш ----


def _new_city_state() -> dict:
    return {
        "days_by_date": {}, "updated_at": None, "fetched_at": 0.0, "expires_at": 0.0,
        "last_modified": None, "next_try_at": 0.0, "failed": False,
    }


_weather: dict[str, dict] = {c["id"]: _new_city_state() for c in CITIES}
_rates: dict = {"data": None, "fetched_at": 0.0, "next_try_at": 0.0, "failed": False}


def reset_cache() -> None:
    with _lock:
        for c in CITIES:
            _weather[c["id"]] = _new_city_state()
    with _rates_lock:
        _rates.update({"data": None, "fetched_at": 0.0, "next_try_at": 0.0, "failed": False})


def _expires_ts(response: httpx.Response, now: float) -> float:
    try:
        return parsedate_to_datetime(response.headers["Expires"]).timestamp()
    except (KeyError, TypeError, ValueError):
        return now


def _refresh_city(city: dict, state: dict, now: float) -> None:
    headers = {"User-Agent": USER_AGENT}
    if state["last_modified"]:
        headers["If-Modified-Since"] = state["last_modified"]
    try:
        response = _http_get(MET_URL.format(lat=city["lat"], lon=city["lon"]), headers)
        if response.status_code == 304:
            state.update(fetched_at=now, expires_at=_expires_ts(response, now), failed=False)
        elif response.status_code == 200:
            updated_at, days = parse_met(response.json(), city["timezone"])
            state.update(
                days_by_date=days, updated_at=updated_at, fetched_at=now, expires_at=_expires_ts(response, now),
                last_modified=response.headers.get("Last-Modified"), failed=False,
            )
        else:
            raise SourceError(f"status {response.status_code}")
    except Exception as exc:  # noqa: BLE001 — источник не должен ломать главную
        log.warning("home weather: %s", type(exc).__name__)
        state.update(next_try_at=now + RETRY_AFTER_FAILURE, failed=True)


def weather_payload() -> dict:
    cities = []
    with _lock:
        now_dt = _now()
        now = now_dt.timestamp()
        for city in CITIES:
            state = _weather[city["id"]]
            if now >= max(state["fetched_at"] + WEATHER_MIN_INTERVAL, state["expires_at"]) and now >= state["next_try_at"]:
                _refresh_city(city, state, now)
            fresh = bool(state["days_by_date"]) and now - state["fetched_at"] <= WEATHER_MAX_AGE
            days = select_days(state["days_by_date"], city["timezone"], now_dt) if fresh else []
            cities.append({
                "id": city["id"],
                "timezone": city["timezone"],
                "updatedAt": state["updated_at"] if days else None,
                "stale": state["failed"] and bool(days),
                "days": days,
            })
    return {"source": MET_SOURCE, "cities": cities}


# ---- курсы ----


def parse_rates(payload: dict) -> dict:
    valute = payload["Valute"]
    rates = []
    for code in RATES_CODES:
        item = valute.get(code)
        if not item:
            continue
        nominal, value, previous = item["Nominal"], item["Value"], item["Previous"]
        rates.append({
            "code": code, "nominal": nominal, "value": value, "previous": previous,
            "perUnit": round(value / nominal, 6),
        })
    return {
        "date": str(payload["Date"])[:10],
        "previousDate": str(payload["PreviousDate"])[:10] if payload.get("PreviousDate") else None,
        "rates": rates,
    }


def rates_payload() -> dict:
    with _rates_lock:
        now = _ts()
        if now >= _rates["fetched_at"] + RATES_MIN_INTERVAL and now >= _rates["next_try_at"]:
            try:
                response = _http_get(RATES_URL, {"User-Agent": USER_AGENT})
                if response.status_code != 200:
                    raise SourceError(f"status {response.status_code}")
                _rates.update(data=parse_rates(response.json()), fetched_at=now, failed=False)
            except Exception as exc:  # noqa: BLE001
                log.warning("home rates: %s", type(exc).__name__)
                _rates.update(next_try_at=now + RETRY_AFTER_FAILURE, failed=True)
        data = _rates["data"]
        if not data or now - _rates["fetched_at"] > RATES_MAX_AGE:
            return {"source": RATES_SOURCE, "date": None, "previousDate": None, "stale": False, "rates": []}
        return {"source": RATES_SOURCE, **data, "stale": _rates["failed"]}
