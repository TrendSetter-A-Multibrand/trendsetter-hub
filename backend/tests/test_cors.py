import importlib

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def cors_client(monkeypatch):
    monkeypatch.setenv("HUB_CORS_ORIGINS", "https://hub.example.com")
    monkeypatch.setenv("HUB_CORS_ORIGIN_REGEX", r"^https://preview-[a-z0-9-]+\.example\.app$")
    import app.main as main

    importlib.reload(main)
    yield TestClient(main.create_app())
    monkeypatch.undo()
    importlib.reload(main)


def preflight(client, origin):
    return client.options(
        "/auth/login",
        headers={"Origin": origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"},
    )


def test_listed_origin_allowed(cors_client):
    assert preflight(cors_client, "https://hub.example.com").headers.get("access-control-allow-origin") == "https://hub.example.com"


def test_regex_origin_allowed(cors_client):
    assert preflight(cors_client, "https://preview-abc-1.example.app").headers.get("access-control-allow-origin") == "https://preview-abc-1.example.app"


def test_foreign_origin_rejected(cors_client):
    assert "access-control-allow-origin" not in preflight(cors_client, "https://evil.example.org").headers
