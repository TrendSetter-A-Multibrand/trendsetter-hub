"""Главная: погода (MET Norway) и курсы ЦБ РФ. Сеть запрещена: _http_get подменён. Контракт — docs/TZ-home.md."""

from datetime import datetime, timedelta, timezone
from email.utils import format_datetime

import httpx
import pytest

from app.core import home
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
