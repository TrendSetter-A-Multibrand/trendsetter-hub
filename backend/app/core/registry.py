"""Реестр модулей. Новый модуль = папка в modules/ и одна строка здесь (+ строка во фронтенде и миграция)."""
from collections.abc import Callable
from dataclasses import dataclass

from fastapi import APIRouter
from sqlalchemy.orm import Session

from app.core.models import User
from app.modules.team import service as team_service
from app.modules.team.router import router as team_router
from app.modules.warehouse.router import router as warehouse_router


@dataclass(frozen=True)
class ModuleManifest:
    id: str
    title: str
    status: str  # "mvp" | "roadmap"
    router: APIRouter | None = None  # None — модуль без бэкенда (roadmap или пока на моках)
    for_all: bool = False  # True — виден всем активным сотрудникам независимо от отдела (просмотр)
    badge: Callable[[Session, User], int] | None = None  # число-бейдж у пункта меню (например, заявки на проверке); 0 — не показывается


MODULES: list[ModuleManifest] = [
    ModuleManifest("purchasing", "Закупки", "roadmap"),
    ModuleManifest("warehouse", "Склад", "mvp", warehouse_router),
    ModuleManifest("wb", "WB-карточки", "roadmap"),
    ModuleManifest("analytics", "Аналитика", "roadmap"),
    ModuleManifest("pricing", "Цены", "roadmap"),
    ModuleManifest("hr", "HR", "roadmap", badge=team_service.pending_badge),
    ModuleManifest("team", "Карта команды", "roadmap", team_router, for_all=True),
]
