"""Сид «Карты команды» (app.modules.team.seed). Файл team.json — только синтетический, в tmp_path."""
import io
import json

import pytest
from sqlalchemy import text

from app.modules.team import seed
from tests.conftest import make_user


def sample() -> dict:
    def p(pid, name, mgr, direction, **kw):
        return {"id": pid, "name": name, "title": "Должность", "managerId": mgr, "directionId": direction, "tag": kw.get("tag"), "team": None, "location": kw.get("location"),
                "workFormat": None, "responsibility": None, "askMeAbout": None, "hobbies": kw.get("hobbies", []), "telegram": kw.get("telegram"), "email": kw.get("email"), "photoUrl": None}

    return {
        "ceoId": "boss", "assistantIds": ["asst"],
        "directions": [
            {"id": "ops", "label": "ОПЕРАЦИИ", "shortName": "Операции", "color": "#1D428A", "avatarInk": "#FFFFFF", "rootIds": ["head"]},
            {"id": "mkt", "label": "МАРКЕТИНГ", "shortName": "Маркетинг", "color": "#FE5000", "avatarInk": "#FFFFFF", "rootIds": ["mhead"]},
        ],
        "people": [
            p("boss", "Босс Главный", None, "leadership"),
            p("asst", "Ассист Помощник", "boss", "leadership"),
            p("head", "Голова Операций", "boss", "ops", tag="СТМ"),
            p("worker", "Работник Иван", "head", "ops", telegram="@wk", email="Worker@Example.com", hobbies=["чай", " "], location="Москва"),
            p("deep", "Глубокий Пётр", "worker", "mkt"),  # directionId файла расходится с деревом: берётся направление корня (ops)
            p("mhead", "Маркетов Глава", "boss", "mkt"),
            p("single", "Одноимённый", "mhead", "mkt"),
        ],
    }


def write(tmp_path, data) -> str:
    f = tmp_path / "team.json"
    f.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return str(f)


def count(db) -> int:
    db.rollback()
    return db.execute(text("SELECT count(*) FROM trendsetter_hub.team_people")).scalar_one()


def test_dry_run_writes_nothing_and_prints_no_personal_data(db, tmp_path):
    report = seed.seed_people(db, write(tmp_path, sample()), apply=False)
    out = report.text()
    assert report.exit_code == 0 and "СУХОЙ ПРОГОН" in out and "Карточек: 7" in out and "с telegram: 1" in out
    assert count(db) == 0
    for secret in ("Worker@Example.com", "wk", "Работник", "Иван"):
        assert secret not in out


def test_apply_loads_people_with_hierarchy(db, tmp_path):
    path = write(tmp_path, sample())
    report = seed.seed_people(db, path, apply=True)
    assert report.exit_code == 0, report.text()
    rows = {r.last_name: r for r in db.execute(text("SELECT p.*, (SELECT last_name FROM trendsetter_hub.team_people m WHERE m.id = p.manager_id) AS mgr FROM trendsetter_hub.team_people p")).all()}
    assert rows["Босс"].is_ceo and rows["Босс"].manager_id is None and rows["Босс"].direction_id == "leadership"
    assert rows["Ассист"].is_assistant and rows["Ассист"].direction_id == "leadership" and rows["Ассист"].mgr == "Босс"
    assert rows["Работник"].first_name == "Иван" and rows["Работник"].mgr == "Голова" and rows["Работник"].direction_id == "ops"
    assert rows["Работник"].answers == {"telegram": "wk", "location": "Москва", "hobbies": ["чай"]} and rows["Работник"].email == "Worker@Example.com"
    assert rows["Глубокий"].direction_id == "ops" and rows["Одноимённый"].direction_id == "mkt" and rows["Одноимённый"].first_name == ""
    assert rows["Голова"].tag == "СТМ" and [rows[k].sort for k in ("Босс", "Ассист", "Голова")] == [0, 1, 2]
    audit = db.execute(text("SELECT details::text FROM trendsetter_hub.audit_log WHERE action = 'team.seed_import'")).scalar_one()
    assert "Worker" not in audit and "wk" not in audit and "Работник" not in audit
    # повтор — отказ, ничего не меняется
    again = seed.seed_people(db, path, apply=True)
    assert again.exit_code == 2 and count(db) == 7


def test_rollback(db, tmp_path):
    assert seed.rollback_seed(db, apply=True).exit_code == 2  # нечего откатывать
    seed.seed_people(db, write(tmp_path, sample()), apply=True)
    dry = seed.rollback_seed(db, apply=False)
    assert dry.exit_code == 0 and count(db) == 7
    assert seed.rollback_seed(db, apply=True).exit_code == 0 and count(db) == 0
    assert seed.rollback_seed(db, apply=True).exit_code == 2  # откат уже выполнен


def test_rollback_refused_after_live_work(db, tmp_path):
    seed.seed_people(db, write(tmp_path, sample()), apply=True)
    user = make_user(db, "u@example.com", "employee")
    db.execute(text("UPDATE trendsetter_hub.team_people SET user_id = :u WHERE last_name = 'Работник'"), {"u": user.id})
    db.commit()
    r = seed.rollback_seed(db, apply=True)
    assert r.exit_code == 2 and "привязано к учётным записям" in r.text() and count(db) == 7


@pytest.mark.parametrize(
    "mutate",
    [
        lambda d: d["people"].append(dict(d["people"][1])),  # повтор id
        lambda d: d["people"][3].update(managerId="nobody"),  # нет руководителя
        lambda d: d["people"][2].update(managerId="worker"),  # цикл, не доходящий до CEO
        lambda d: d["people"][3].update(email="a@example.com") or d["people"][4].update(email="A@example.com"),  # дубль почты
        lambda d: d.update(ceoId="ghost"),
    ],
)
def test_bad_files_exit_1(db, tmp_path, mutate):
    data = sample()
    mutate(data)
    report = seed.seed_people(db, write(tmp_path, data), apply=True)
    assert report.exit_code == 1 and count(db) == 0


def test_stdin_and_broken_json(db, tmp_path):
    ok = seed.seed_people(db, io.BytesIO(json.dumps(sample(), ensure_ascii=False).encode("utf-8")), apply=False)
    assert ok.exit_code == 0
    bad = seed.seed_people(db, io.BytesIO(b"{not json"), apply=False)
    assert bad.exit_code == 1 and "JSON" in bad.text()


def test_main_requires_exactly_one_mode(capsys):
    assert seed.main([]) == 1
    assert seed.main(["x.json", "--rollback"]) == 1
