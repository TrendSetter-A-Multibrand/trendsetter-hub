"""Реестр модулей. Новый модуль = папка в modules/ и одна строка здесь (+ строка во фронтенде и миграция)."""
from collections.abc import Callable
from dataclasses import dataclass

from fastapi import APIRouter
from sqlalchemy.orm import Session

from app.core.models import User
from app.modules.hr import reminders as hr_reminders
from app.modules.hr import service as hr_service
from app.modules.hr.router import router as hr_router
from app.modules.news import service as news_service
from app.modules.news.router import router as news_router
from app.modules.team.router import router as team_router
from app.modules.warehouse.router import router as warehouse_router
from app.modules.wb.router import router as wb_router


@dataclass(frozen=True)
class ModuleManifest:
    id: str
    title: str
    status: str  # "mvp" | "roadmap"
    router: APIRouter | None = None  # None — модуль без бэкенда (roadmap или пока на моках)
    for_all: bool = False  # True — виден всем активным сотрудникам независимо от отдела (просмотр)
    badge: Callable[[Session, User], int] | None = None  # число-бейдж у пункта меню (например, заявки на проверке); 0 — не показывается
    daily_job: Callable[[Session], None] | None = None  # ежедневная задача (напоминания); вызывается из /core/me, сама отмечает «уже запускалась сегодня»
    home_editor: bool = False  # «Ответственный» этого модуля может настраивать виджеты главной


MODULES: list[ModuleManifest] = [
    ModuleManifest("purchasing", "Закупки", "roadmap"),
    ModuleManifest("warehouse", "Склад", "mvp", warehouse_router),
    ModuleManifest("wb", "Wildberries", "mvp", wb_router),
    ModuleManifest("analytics", "Аналитика", "roadmap"),
    ModuleManifest("pricing", "Цены", "roadmap"),
    ModuleManifest("hr", "HR", "roadmap", hr_router, badge=hr_service.badge, daily_job=hr_reminders.run_daily),
    ModuleManifest("team", "Карта команды", "roadmap", team_router, for_all=True),
    ModuleManifest("news", "Новости", "mvp", news_router, for_all=True, badge=news_service.badge, home_editor=True),
]
