"""Главная: погода (MET Norway) и курсы ЦБ РФ. Сеть запрещена: _http_get подменён. Контракт — docs/TZ-home.md."""

import json
import re
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
import pytest
from sqlalchemy import text

from app.core import home
from app.core.models import UserModulePermission
from tests.conftest import login, make_user

UTC = timezone.utc
T0 = datetime(2026, 10, 26, 8, 0, tzinfo=UTC)


def _no_network(url, headers):
    raise AssertionError("network")


@pytest.fixture(autouse=True)
def isolate(monkeypatch):
    home.reset_cache()
    monkeypatch.setattr(home, "_http_get", _no_network)
    yield
    home.reset_cache()


class Clock:
    def __init__(self, start=T0):
        self.now = start

    def __call__(self):
        return self.now

    def advance(self, **kw):
        self.now += timedelta(**kw)


@pytest.fixture()
def clock(monkeypatch):
    c = Clock()
    monkeypatch.setattr(home, "_now", c)
    return c


class FakeHttp:
    """Подмена _http_get: очередь ответов (последний повторяется), журнал запросов."""

    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls = []

    def __call__(self, url, headers):
        self.calls.append((url, dict(headers)))
        return self.responses.pop(0) if len(self.responses) > 1 else self.responses[0]


def point(time, temp, six=None, one=None):
    data = {"instant": {"details": {"air_temperature": temp}}}
    if six:
        data["next_6_hours"] = {"summary": {"symbol_code": six[0]}, "details": {"air_temperature_min": six[1], "air_temperature_max": six[2]}}
    if one:
        data["next_1_hours"] = {"summary": {"symbol_code": one}}
    return {"time": time, "data": data}


def hour_point(time, temp, symbol="cloudy_day", precip=None, wind=None):
    """Почасовая точка: есть next_1_hours (символ, осадки), ветер — в instant."""
    details = {"air_temperature": temp}
    if wind is not None:
        details["wind_speed"] = wind
    one = {"summary": {"symbol_code": symbol}}
    if precip is not None:
        one["details"] = {"precipitation_amount": precip}
    return {"time": time, "data": {"instant": {"details": details}, "next_1_hours": one}}


def met(timeseries=None, updated="2026-10-26T07:17:39Z"):
    series = timeseries if timeseries is not None else [point("2026-10-26T08:00:00Z", 10.0, ("clearsky_day", 8.0, 12.0))]
    return {"type": "Feature", "properties": {"meta": {"updated_at": updated}, "timeseries": series}}


def met_response(status=200, expires_in=0, payload=None, last_modified="Mon, 26 Oct 2026 07:17:39 GMT", now=T0):
    headers = {"Last-Modified": last_modified, "Expires": format_datetime(now + timedelta(seconds=expires_in), usegmt=True)}
    return httpx.Response(status, json=payload if payload is not None else met(), headers=headers)


CBR = {
    "Date": "2026-10-24T11:30:00+03:00",
    "PreviousDate": "2026-10-23T11:30:00+03:00",
    "Valute": {
        "AMD": {"CharCode": "AMD", "Nominal": 100, "Value": 22.3011, "Previous": 22.4519},
        "USD": {"CharCode": "USD", "Nominal": 1, "Value": 81.1234, "Previous": 80.9876},
        "EUR": {"CharCode": "EUR", "Nominal": 1, "Value": 94.5, "Previous": 94.7},
        "GBP": {"CharCode": "GBP", "Nominal": 1, "Value": 100.0, "Previous": 99.0},
    },
}


# ---- чистые функции: агрегация погоды ----


def test_aggregate_days_uses_city_timezone():
    # 21:00Z = 01:00 следующего дня в Ереване (UTC+4)
    days = home.aggregate_days([point("2026-10-26T21:00:00Z", 5.0)], "Asia/Yerevan")
    assert list(days) == ["2026-10-27"]
    days = home.aggregate_days([point("2026-10-26T21:00:00Z", 5.0)], "Europe/Paris")
    assert list(days) == ["2026-10-26"]


def test_aggregate_days_min_max_and_six_hour_intervals():
    series = [
        point("2026-10-26T21:00:00Z", 5.0, ("cloudy", 4.0, 6.0)),  # 27.10 01:00-07:00 целиком в дне
        point("2026-10-27T07:00:00Z", 10.0, ("partlycloudy_day", 9.0, 14.0)),  # 11:00-17:00
        point("2026-10-27T15:00:00Z", 8.0, ("clearsky_night", -5.0, 30.0)),  # 19:00-01:00: пересекает полночь, не учитывается
        point("2026-10-28T14:00:00Z", 3.0, ("rain", -2.0, 7.0)),  # 28.10 18:00-00:00: конец ровно в полночь, внутри дня
    ]
    days = home.aggregate_days(series, "Asia/Yerevan")
    assert (days["2026-10-27"]["min"], days["2026-10-27"]["max"]) == (4, 14)
    assert (days["2026-10-28"]["min"], days["2026-10-28"]["max"]) == (-2, 7)
    assert set(days) == {"2026-10-27", "2026-10-28"}


def test_aggregate_days_symbol_covering_noon_and_suffix():
    series = [
        point("2026-10-27T05:00:00Z", 9.0, ("fog", 8.0, 9.0)),  # 09:00-15:00, покрывает 12:00
        point("2026-10-27T07:00:00Z", 10.0, ("partlycloudy_day", 9.0, 14.0)),  # 11:00-17:00, покрывает 12:00, позже
        point("2026-10-27T10:00:00Z", 10.0, ("clearsky_night", 9.0, 14.0)),  # 14:00 — не покрывает
    ]
    assert home.aggregate_days(series, "Asia/Yerevan")["2026-10-27"]["symbol"] == "partlycloudy"


def test_aggregate_days_symbol_fallbacks():
    # нет покрывающего слота: ближайший к 12:00, при равенстве — более ранний (05:00 и 19:00 — по 7 ч от полудня)
    series = [
        point("2026-10-27T01:00:00Z", 9.0, ("snow", 1.0, 2.0)),
        point("2026-10-27T15:00:00Z", 9.0, ("rain_night", 1.0, 2.0)),
    ]
    assert home.aggregate_days(series, "Asia/Yerevan")["2026-10-27"]["symbol"] == "snow"
    # только next_1_hours
    series = [point("2026-10-27T07:00:00Z", 9.0, one="lightrain_night")]
    assert home.aggregate_days(series, "Asia/Yerevan")["2026-10-27"]["symbol"] == "lightrain"
    # символа нет вовсе (хвостовая точка без next_*)
    series = [point("2026-10-27T07:00:00Z", 9.0)]
    assert home.aggregate_days(series, "Asia/Yerevan")["2026-10-27"] == {"min": 9, "max": 9, "symbol": None}


def test_aggregate_days_tail_point_and_junk_do_not_break():
    series = [point("2026-10-27T07:00:00Z", 9.0, ("cloudy", 8.0, 10.0)), {"time": "bad", "data": {}}, {"data": {}}, point("2026-10-27T13:00:00Z", 7.0)]
    assert home.aggregate_days(series, "Asia/Yerevan")["2026-10-27"]["min"] == 7


def test_round_half_up():
    assert [home.round_half_up(x) for x in (2.5, 2.4, -0.5, -1.5, -1.6, 0.49)] == [3, 2, 0, -1, -2, 0]
    days = home.aggregate_days([point("2026-10-27T07:00:00Z", 2.5), point("2026-10-27T08:00:00Z", -1.5)], "Asia/Yerevan")
    assert (days["2026-10-27"]["min"], days["2026-10-27"]["max"]) == (-1, 3)


def test_select_days_from_today_in_city_zone():
    by_date = {f"2026-10-{d}": {"min": 1, "max": 2, "symbol": None} for d in range(24, 34 - 3)}  # 24..30
    # 21:30Z 26.10 = 27.10 01:30 в Ереване
    now = datetime(2026, 10, 26, 21, 30, tzinfo=UTC)
    got = home.select_days(by_date, "Asia/Yerevan", now)
    assert [d["date"] for d in got] == ["2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]
    assert [d["date"] for d in home.select_days(by_date, "Europe/Paris", now)][0] == "2026-10-26"  # Париж ещё 26-е
    many = {f"2026-11-{d:02d}": {"min": 1, "max": 2, "symbol": None} for d in range(1, 15)}
    assert len(home.select_days(many, "Asia/Yerevan", now)) == 7


# ---- чистые функции: курсы ----


def test_parse_rates():
    parsed = home.parse_rates(CBR)
    assert parsed["date"] == "2026-10-24" and parsed["previousDate"] == "2026-10-23"
    assert [r["code"] for r in parsed["rates"]] == ["USD", "EUR", "AMD"]
    amd = parsed["rates"][2]
    assert amd == {"code": "AMD", "nominal": 100, "value": 22.3011, "previous": 22.4519, "perUnit": 0.223011}
    assert parsed["rates"][0]["perUnit"] == 81.1234


def test_parse_rates_skips_missing_currency():
    payload = {**CBR, "Valute": {k: v for k, v in CBR["Valute"].items() if k != "EUR"}}
    assert [r["code"] for r in home.parse_rates(payload)["rates"]] == ["USD", "AMD"]


def _slot_ids(series, tz="Asia/Yerevan"):
    out = home.aggregate_slots(series, tz)
    return {d: [s["id"] for s in slots] for d, slots in out.items()}


def test_aggregate_slots_boundaries():
    # Ереван UTC+4: 06:59Z... берём местные часы: 05:00, 06:00, 10:59 (в 10:00 час), 11:00, 21:00, 22:00
    def at(h):  # местный час h -> UTC
        return f"2026-10-27T{(h - 4) % 24:02d}:00:00Z"

    series = [hour_point(at(h), 5.0) for h in (5, 6, 10, 11, 12, 13, 16, 17, 21, 22)]
    assert _slot_ids(series) == {"2026-10-27": ["morning", "noon", "lunch", "evening"]}
    for h, expected in ((5, None), (6, "morning"), (10, "morning"), (11, "noon"), (13, "lunch"), (16, "lunch"), (17, "evening"), (21, "evening"), (22, None)):
        got = _slot_ids([hour_point(at(h), 5.0)])
        assert got == ({"2026-10-27": [expected]} if expected else {}), h


def test_aggregate_slots_uses_city_timezone_and_ignores_points_without_next_1_hours():
    # 07:00Z = 11:00 Ереван (noon), но 07:00 в UTC (morning)
    series = [hour_point("2026-10-27T07:00:00Z", 5.0)]
    assert _slot_ids(series, "Asia/Yerevan") == {"2026-10-27": ["noon"]}
    assert _slot_ids(series, "UTC") == {"2026-10-27": ["morning"]}
    no_hourly = [point("2026-10-27T07:00:00Z", 5.0, ("cloudy", 4.0, 6.0)), {"time": "bad", "data": {}}, {"data": {}}]
    assert home.aggregate_slots(no_hourly, "Asia/Yerevan") == {}


def test_aggregate_slots_temp_reference_hour_and_fallback():
    # окно lunch 13-17, опорный час 14:00 (10:00Z)
    series = [hour_point("2026-10-27T09:00:00Z", 10.0), hour_point("2026-10-27T10:00:00Z", 12.0), hour_point("2026-10-27T11:00:00Z", 8.4)]
    slot = home.aggregate_slots(series, "Asia/Yerevan")["2026-10-27"][0]
    assert (slot["temp"], slot["tempMin"], slot["tempMax"]) == (12, 8, 12)
    # опорной точки нет — первая по времени
    series = [hour_point("2026-10-27T11:00:00Z", 8.5), hour_point("2026-10-27T09:00:00Z", 10.0)]
    slot = home.aggregate_slots(series, "Asia/Yerevan")["2026-10-27"][0]
    assert (slot["temp"], slot["tempMin"], slot["tempMax"]) == (10, 9, 10)  # 8.5 -> 9 (half up)


def test_aggregate_slots_symbols_precip_wind():
    series = [
        hour_point("2026-10-27T09:00:00Z", 10.0, "cloudy", precip=0.04, wind=2.0),
        hour_point("2026-10-27T10:00:00Z", 10.0, "rain_day", precip=0.3, wind=4.46),
        hour_point("2026-10-27T11:00:00Z", 10.0, "cloudy_night", precip=0.26, wind=3.0),
        hour_point("2026-10-27T12:00:00Z", 10.0, "heavyrain", precip=1.0),
    ]
    slot = home.aggregate_slots(series, "Asia/Yerevan")["2026-10-27"][0]
    assert slot["symbols"] == ["cloudy", "rain", "heavyrain"]
    assert slot["precip"] == 1.6  # 0.04 + 0.3 + 0.26 + 1.0 = 1.6
    assert slot["wind"] == 4.5
    # нет ветра и осадков
    slot = home.aggregate_slots([hour_point("2026-10-27T09:00:00Z", 10.0)], "Asia/Yerevan")["2026-10-27"][0]
    assert slot["wind"] is None and slot["precip"] == 0


# ---- кэш погоды ----


def test_weather_request_and_shape(clock, monkeypatch):
    fake = FakeHttp(met_response())
    monkeypatch.setattr(home, "_http_get", fake)
    out = home.weather_payload()
    assert out["source"] == "MET Norway"
    assert [c["id"] for c in out["cities"]] == ["yerevan", "moscow"]
    assert out["cities"][0]["days"][0] == {"date": "2026-10-26", "min": 8, "max": 12, "symbol": "clearsky"}
    assert out["cities"][0]["updatedAt"] == "2026-10-26T07:17:39Z"
    assert out["cities"][0]["stale"] is False
    urls = [c[0] for c in fake.calls]
    assert urls[0] == "https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=40.1792&lon=44.4991"
    assert urls[1] == "https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=55.7558&lon=37.6173"
    assert all("TrendsetterHub" in c[1]["User-Agent"] for c in fake.calls)
    assert all("If-Modified-Since" not in c[1] for c in fake.calls)


def test_weather_cache_hit_within_hour(clock, monkeypatch):
    fake = FakeHttp(met_response())
    monkeypatch.setattr(home, "_http_get", fake)
    home.weather_payload()
    clock.advance(minutes=59)
    home.weather_payload()
    assert len(fake.calls) == 2  # по одному на город, повторных нет


def test_weather_conditional_request_and_304_keeps_data(clock, monkeypatch):
    fake = FakeHttp(met_response(), met_response(), httpx.Response(304, headers={"Expires": format_datetime(T0 + timedelta(hours=3), usegmt=True)}))
    monkeypatch.setattr(home, "_http_get", fake)
    home.weather_payload()
    clock.advance(minutes=61)
    out = home.weather_payload()
    assert len(fake.calls) == 4
    assert fake.calls[2][1]["If-Modified-Since"] == "Mon, 26 Oct 2026 07:17:39 GMT"
    assert out["cities"][0]["days"] and out["cities"][0]["stale"] is False
    # 304 сдвинул fetched_at: в пределах часа повторов нет
    clock.advance(minutes=30)
    home.weather_payload()
    assert len(fake.calls) == 4


def test_weather_respects_expires(clock, monkeypatch):
    fake = FakeHttp(met_response(expires_in=3 * 3600))
    monkeypatch.setattr(home, "_http_get", fake)
    home.weather_payload()
    clock.advance(minutes=61)
    home.weather_payload()
    assert len(fake.calls) == 2
    clock.advance(hours=2)
    home.weather_payload()
    assert len(fake.calls) == 4


def test_weather_failure_keeps_old_data_stale_and_retry_after_600s(clock, monkeypatch):
    fake = FakeHttp(met_response(), met_response(), httpx.Response(500, text="secret body"))
    monkeypatch.setattr(home, "_http_get", fake)
    home.weather_payload()
    clock.advance(minutes=61)
    out = home.weather_payload()
    assert len(fake.calls) == 4
    assert out["cities"][0]["stale"] is True and out["cities"][0]["days"]
    clock.advance(minutes=9)
    home.weather_payload()
    assert len(fake.calls) == 4  # раньше 600 с не повторяем
    clock.advance(minutes=2)
    home.weather_payload()
    assert len(fake.calls) == 6


def test_weather_failure_without_cache_is_empty(clock, monkeypatch):
    monkeypatch.setattr(home, "_http_get", FakeHttp(httpx.Response(500)))
    out = home.weather_payload()
    assert [(c["days"], c["updatedAt"], c["stale"]) for c in out["cities"]] == [([], None, False)] * 2


@pytest.mark.parametrize("status", [429, 203, 403])
def test_weather_bad_status_is_failure(clock, monkeypatch, status):
    fake = FakeHttp(met_response(), met_response(), httpx.Response(status, json=met()))
    monkeypatch.setattr(home, "_http_get", fake)
    home.weather_payload()
    clock.advance(minutes=61)
    out = home.weather_payload()
    assert out["cities"][0]["stale"] is True


def test_weather_broken_json_is_failure(clock, monkeypatch):
    monkeypatch.setattr(home, "_http_get", FakeHttp(httpx.Response(200, content=b"not json")))
    out = home.weather_payload()
    assert out["cities"][0]["days"] == []


def test_weather_data_older_than_24h_not_served(clock, monkeypatch):
    fake = FakeHttp(met_response(), met_response(), httpx.Response(500))
    monkeypatch.setattr(home, "_http_get", fake)
    home.weather_payload()
    clock.advance(hours=25)
    out = home.weather_payload()
    assert out["cities"][0]["days"] == [] and out["cities"][0]["updatedAt"] is None and out["cities"][0]["stale"] is False


def test_weather_log_has_no_body(clock, monkeypatch, caplog):
    monkeypatch.setattr(home, "_http_get", FakeHttp(httpx.Response(500, text="TOP-SECRET-BODY")))
    with caplog.at_level("WARNING"):
        home.weather_payload()
    assert "TOP-SECRET-BODY" not in caplog.text and "SourceError" in caplog.text


# ---- кэш курсов ----


def cbr_response(payload=None):
    return httpx.Response(200, json=payload or CBR)


def test_rates_shape_and_cache_ttl(clock, monkeypatch):
    fake = FakeHttp(cbr_response())
    monkeypatch.setattr(home, "_http_get", fake)
    out = home.rates_payload()
    assert out["source"] == "ЦБ РФ" and out["date"] == "2026-10-24" and out["stale"] is False
    assert [r["code"] for r in out["rates"]] == ["USD", "EUR", "AMD"]
    assert "TrendsetterHub" in fake.calls[0][1]["User-Agent"]
    clock.advance(hours=2, minutes=59)
    home.rates_payload()
    assert len(fake.calls) == 1
    clock.advance(minutes=2)
    home.rates_payload()
    assert len(fake.calls) == 2


def test_rates_failure_is_stale_and_old_data_dropped(clock, monkeypatch):
    fake = FakeHttp(cbr_response(), httpx.Response(500))
    monkeypatch.setattr(home, "_http_get", fake)
    home.rates_payload()
    clock.advance(hours=4)
    out = home.rates_payload()
    assert out["stale"] is True and out["rates"]
    assert len(fake.calls) == 2
    clock.advance(minutes=5)
    home.rates_payload()
    assert len(fake.calls) == 2  # повтор не раньше 600 с
    clock.advance(days=4)
    out = home.rates_payload()
    assert out == {"source": "ЦБ РФ", "date": None, "previousDate": None, "stale": False, "rates": []}


def test_rates_failure_without_cache_is_empty_shape(clock, monkeypatch):
    monkeypatch.setattr(home, "_http_get", FakeHttp(httpx.Response(200, content=b"<html>")))
    assert home.rates_payload() == {"source": "ЦБ РФ", "date": None, "previousDate": None, "stale": False, "rates": []}


# ---- эндпоинты (нужна БД, как в соседних тестах) ----


@pytest.mark.parametrize("path", ["/core/home/weather", "/core/home/rates"])
def test_home_requires_token(client, path):
    assert client.get(path).status_code == 401


@pytest.mark.parametrize("level", ["employee", "viewer"])
def test_home_endpoints_ok_for_employee_and_viewer(client, db, monkeypatch, level):
    make_user(db, f"{level}@example.com", level)
    headers = login(client, f"{level}@example.com")
    fake = FakeHttp(met_response(), met_response())

    def routed(url, h):
        return cbr_response() if "cbr-xml" in url else fake(url, h)

    monkeypatch.setattr(home, "_http_get", routed)
    # на всякий случай: время подменять не нужно, но данные MET могут быть «вчерашними» — проверяем только форму
    weather = client.get("/core/home/weather", headers=headers)
    assert weather.status_code == 200
    body = weather.json()
    assert body["source"] == "MET Norway"
    assert [c["id"] for c in body["cities"]] == ["yerevan", "moscow"]
    assert set(body["cities"][0]) == {"id", "timezone", "updatedAt", "stale", "days"}
    rates = client.get("/core/home/rates", headers=headers)
    assert rates.status_code == 200
    assert [r["code"] for r in rates.json()["rates"]] == ["USD", "EUR", "AMD"]
    assert set(rates.json()) == {"source", "date", "previousDate", "stale", "rates"}


def test_home_endpoints_do_not_fail_when_source_down(client, db):
    make_user(db, "e@example.com", "employee")
    headers = login(client, "e@example.com")  # _http_get бросает AssertionError("network")
    weather = client.get("/core/home/weather", headers=headers)
    assert weather.status_code == 200
    assert [c["days"] for c in weather.json()["cities"]] == [[], []]
    rates = client.get("/core/home/rates", headers=headers)
    assert rates.status_code == 200 and rates.json()["rates"] == []


# ---- параметр city и slots (home-city) ----


def _urls(fake):
    return [c[0] for c in fake.calls]


LEGACY = (
    ("yerevan", 40.1792, 44.4991, "Asia/Yerevan"),
    ("moscow", 55.7558, 37.6173, "Europe/Moscow"),
    ("saintPetersburg", 59.9386, 30.3141, "Europe/Moscow"),
    ("kazan", 55.7961, 49.1064, "Europe/Moscow"),
    ("krasnodar", 45.0355, 38.9753, "Europe/Moscow"),
    ("yekaterinburg", 56.8389, 60.6057, "Asia/Yekaterinburg"),
    ("novosibirsk", 55.0084, 82.9357, "Asia/Novosibirsk"),
    ("minsk", 53.9006, 27.5590, "Europe/Minsk"),
    ("tbilisi", 41.7151, 44.8271, "Asia/Tbilisi"),
    ("baku", 40.4093, 49.8671, "Asia/Baku"),
    ("almaty", 43.2220, 76.8512, "Asia/Almaty"),
    ("astana", 51.1605, 71.4704, "Asia/Almaty"),
    ("tashkent", 41.2995, 69.2401, "Asia/Tashkent"),
    ("bishkek", 42.8746, 74.5698, "Asia/Bishkek"),
    ("istanbul", 41.0082, 28.9784, "Europe/Istanbul"),
    ("dubai", 25.2048, 55.2708, "Asia/Dubai"),
    ("belgrade", 44.7866, 20.4489, "Europe/Belgrade"),
)
LONDON = "g2643743"


def test_cities_catalog_shape():
    ids = list(home.CITIES)
    assert 700 <= len(ids) <= 1400 and len(set(ids)) == len(ids)
    assert home.DEFAULT_CITY_IDS == ("yerevan", "moscow") and ids[:2] == ["yerevan", "moscow"]
    pattern = re.compile(r"^([a-zA-Z]+|g\d{1,9})$")
    points = set()
    for cid, c in home.CITIES.items():
        assert c["id"] == cid and pattern.match(cid)
        ZoneInfo(c["timezone"])
        assert -90 <= c["lat"] <= 90 and -180 <= c["lon"] <= 180
        assert c["lat"] == round(c["lat"], 4) and c["lon"] == round(c["lon"], 4)
        points.add((c["lat"], c["lon"]))
    assert len(points) == len(ids)  # одна точка — одна запись


def test_cities_legacy_first_and_unchanged():
    ids = list(home.CITIES)
    assert ids[:17] == [row[0] for row in LEGACY]
    for cid, lat, lon, tz in LEGACY:
        assert home.CITIES[cid] == {"id": cid, "lat": lat, "lon": lon, "timezone": tz}


def test_cities_legacy_geonameids_not_duplicated_as_g_ids():
    overrides = json.loads((Path(__file__).parents[1] / "scripts" / "city_overrides.json").read_text(encoding="utf-8"))
    assert [l["id"] for l in overrides["legacy"]] == [row[0] for row in LEGACY]
    for l in overrides["legacy"]:
        assert f"g{l['geonameid']}" not in home.CITIES


def test_weather_city_param_adds_third_city(clock, monkeypatch):
    fake = FakeHttp(met_response())
    monkeypatch.setattr(home, "_http_get", fake)
    out = home.weather_payload("kazan")
    assert [c["id"] for c in out["cities"]] == ["yerevan", "moscow", "kazan"]
    assert len(fake.calls) == 3 and "lat=55.7961&lon=49.1064" in _urls(fake)[2]


@pytest.mark.parametrize("city", [None, "", "yerevan", "moscow", "zzz", "../../x", "Kazan"])
def test_weather_city_param_default_or_unknown_gives_two(clock, monkeypatch, city):
    monkeypatch.setattr(home, "_http_get", FakeHttp(met_response()))
    assert [c["id"] for c in home.weather_payload(city)["cities"]] == ["yerevan", "moscow"]


def test_weather_city_any_catalog_city_adds_third_with_its_coordinates(clock, monkeypatch):
    fake = FakeHttp(met_response())
    monkeypatch.setattr(home, "_http_get", fake)
    c = home.CITIES[LONDON]
    out = home.weather_payload(LONDON)
    assert [x["id"] for x in out["cities"]] == ["yerevan", "moscow", LONDON]
    assert out["cities"][2]["timezone"] == "Europe/London"
    assert f"lat={c['lat']:.4f}&lon={c['lon']:.4f}" in _urls(fake)[2]


@pytest.mark.parametrize("city", ["g0", "g999999999", "G2643743", " g2643743", "g2643743 ", "g2643743\n", "g02643743", "g-1"])
def test_weather_city_param_malformed_g_id_gives_two(clock, monkeypatch, city):
    fake = FakeHttp(met_response())
    monkeypatch.setattr(home, "_http_get", fake)
    assert [c["id"] for c in home.weather_payload(city)["cities"]] == ["yerevan", "moscow"]
    assert len(fake.calls) == 2


def test_weather_cache_keys_subset_of_whitelist_and_hourly(clock, monkeypatch):
    fake = FakeHttp(met_response())
    monkeypatch.setattr(home, "_http_get", fake)
    for cid in ("kazan", LONDON, "g1275339", "zzz", "g0"):
        home.weather_payload(cid)
    assert set(home._weather) <= set(home.CITIES)
    assert set(home._weather) == {"yerevan", "moscow", "kazan", LONDON, "g1275339"}
    calls = len(fake.calls)
    assert calls == 5
    for cid in ("kazan", LONDON, "g1275339"):
        home.weather_payload(cid)
    assert len(fake.calls) == calls  # повтор в пределах часа не ходит в MET


def test_weather_city_cached_per_city(clock, monkeypatch):
    fake = FakeHttp(met_response())
    monkeypatch.setattr(home, "_http_get", fake)
    home.weather_payload("kazan")
    assert len(fake.calls) == 3
    home.weather_payload("kazan")
    assert len(fake.calls) == 3
    home.weather_payload()
    assert len(fake.calls) == 3


def _day_series():
    """Ереван 27.10 (UTC+4): почасовые точки 11:00..21:00 местного (07:00Z..17:00Z)."""
    return [hour_point(f"2026-10-27T{h:02d}:00:00Z", 10.0 + h - 7, "cloudy_day", precip=0.1, wind=2.0) for h in range(7, 18)]


def test_weather_slots_only_in_first_day(clock, monkeypatch):
    clock.now = datetime(2026, 10, 27, 11, 30, tzinfo=UTC)  # 15:30 в Ереване
    series = _day_series() + [hour_point("2026-10-28T08:00:00Z", 9.0)]
    monkeypatch.setattr(home, "_http_get", FakeHttp(met_response(payload=met(series), now=clock.now)))
    days = home.weather_payload()["cities"][0]["days"]
    assert [d["date"] for d in days] == ["2026-10-27", "2026-10-28"]
    slots = days[0]["slots"]
    assert [s["id"] for s in slots] == ["morning", "noon", "lunch", "evening"]
    assert [s["past"] for s in slots] == [True, True, False, False]
    assert slots[0]["temp"] is None and slots[1]["temp"] == 11 and slots[2]["precip"] == 0.4
    assert "slots" not in days[1]
    assert "past" not in next(iter(home._weather["yerevan"]["slots_by_date"].values()))[0]


def test_weather_no_slots_when_first_day_is_not_today(clock, monkeypatch):
    # данные только на завтра: days[0] — не «сегодня» города
    clock.now = datetime(2026, 10, 26, 8, 0, tzinfo=UTC)
    monkeypatch.setattr(home, "_http_get", FakeHttp(met_response(payload=met([hour_point("2026-10-27T08:00:00Z", 9.0)]))))
    days = home.weather_payload()["cities"][0]["days"]
    assert days[0]["date"] == "2026-10-27" and "slots" not in days[0]


def test_weather_city_param_endpoint(client, db, monkeypatch):
    make_user(db, "city@x.ru", "employee")
    headers = login(client, "city@x.ru")
    monkeypatch.setattr(home, "_http_get", FakeHttp(met_response()))
    ids = lambda r: [c["id"] for c in r.json()["cities"]]  # noqa: E731
    assert ids(client.get("/core/home/weather", headers=headers)) == ["yerevan", "moscow"]
    assert ids(client.get("/core/home/weather?city=kazan", headers=headers)) == ["yerevan", "moscow", "kazan"]
    assert ids(client.get("/core/home/weather?city=moscow", headers=headers)) == ["yerevan", "moscow"]
    assert ids(client.get("/core/home/weather?city=zzz", headers=headers)) == ["yerevan", "moscow"]
    assert client.get("/core/home/weather?city=" + "a" * 41, headers=headers).status_code == 422


# ---- виджеты главной ----

WIDGETS = "/core/home/widgets"


def _audit(db):
    return db.execute(text("SELECT action, module_id, details FROM trendsetter_hub.audit_log WHERE action = 'home.widgets_update' ORDER BY id")).all()


def test_widgets_require_token(client):
    assert client.get(WIDGETS).status_code == 401
    assert client.post(WIDGETS, json={"widgets": [{"id": "a", "enabled": True}]}).status_code == 401


@pytest.mark.parametrize("level", ["employee", "viewer", "superuser", "admin"])
def test_widgets_get_for_everyone_empty_by_default(client, db, level):
    make_user(db, f"{level}@example.com", level)
    r = client.get(WIDGETS, headers=login(client, f"{level}@example.com"))
    assert r.status_code == 200 and r.json() == {"widgets": []}


@pytest.fixture()
def roles(client, db):
    make_user(db, "admin@example.com", "admin")
    make_user(db, "emp@example.com", "employee")
    make_user(db, "sup@example.com", "superuser")
    make_user(db, "viewer@example.com", "viewer")
    editor = make_user(db, "editor@example.com", "employee")
    db.add(UserModulePermission(user_id=editor.id, module_id="news", permission="responsible"))
    hr_resp = make_user(db, "hr@example.com", "employee")
    db.add(UserModulePermission(user_id=hr_resp.id, module_id="hr", permission="responsible"))
    db.commit()
    return lambda role: login(client, f"{role}@example.com")


@pytest.mark.parametrize("role", ["emp", "sup", "viewer", "hr"])
def test_widgets_post_forbidden_without_right(client, roles, role):
    r = client.post(WIDGETS, json={"widgets": [{"id": "leave", "enabled": False}]}, headers=roles(role))
    assert r.status_code == 403
    assert client.get(WIDGETS, headers=roles("emp")).json() == {"widgets": []}


@pytest.mark.parametrize("role", ["admin", "editor"])
def test_widgets_post_replaces_all_and_logs(client, db, roles, role):
    headers = roles(role)
    first = [{"id": "weather", "enabled": True}, {"id": "leave", "enabled": False}, {"id": "clocks", "enabled": True}]
    r = client.post(WIDGETS, json={"widgets": first}, headers=headers)
    assert r.status_code == 200 and r.json() == {"widgets": first}
    assert client.get(WIDGETS, headers=roles("viewer")).json() == {"widgets": first}
    second = [{"id": "rates", "enabled": False}, {"id": "clocks", "enabled": True}]
    assert client.post(WIDGETS, json={"widgets": second}, headers=headers).json() == {"widgets": second}
    assert client.get(WIDGETS, headers=headers).json() == {"widgets": second}
    rows = _audit(db)
    assert [(a, mod, d) for a, mod, d in rows] == [
        ("home.widgets_update", None, {"count": 3, "disabled": ["leave"]}),
        ("home.widgets_update", None, {"count": 2, "disabled": ["rates"]}),
    ]


@pytest.mark.parametrize(
    "widgets",
    [
        [],
        [{"id": "a", "enabled": True}, {"id": "a", "enabled": False}],
        [{"id": "Bad_Id", "enabled": True}],
        [{"id": "", "enabled": True}],
        [{"id": "x" * 41, "enabled": True}],
        [{"id": f"w{i}", "enabled": True} for i in range(31)],
        [{"id": "a"}],
    ],
)
def test_widgets_post_validation(client, roles, widgets):
    headers = roles("admin")
    assert client.post(WIDGETS, json={"widgets": [{"id": "keep", "enabled": True}]}, headers=headers).status_code == 200
    assert client.post(WIDGETS, json={"widgets": widgets}, headers=headers).status_code == 422
    assert client.get(WIDGETS, headers=headers).json() == {"widgets": [{"id": "keep", "enabled": True}]}


def test_widgets_post_accepts_30_and_unknown_ids(client, roles):
    widgets = [{"id": f"unknown-{i}", "enabled": i % 2 == 0} for i in range(30)]
    assert client.post(WIDGETS, json={"widgets": widgets}, headers=roles("admin")).json() == {"widgets": widgets}

