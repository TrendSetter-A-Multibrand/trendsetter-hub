"""Реестр модулей. Новый модуль = папка в modules/ и одна строка здесь (+ строка во фронтенде и миграция)."""
from dataclasses import dataclass

from fastapi import APIRouter

from app.modules.warehouse.router import router as warehouse_router


@dataclass(frozen=True)
class ModuleManifest:
    id: str
    title: str
    status: str  # "mvp" | "roadmap"
    router: APIRouter | None = None  # None — модуль без бэкенда (roadmap или пока на моках)


MODULES: list[ModuleManifest] = [
    ModuleManifest("purchasing", "Закупки", "roadmap"),
    ModuleManifest("warehouse", "Склад", "mvp", warehouse_router),
    ModuleManifest("wb", "WB-карточки", "roadmap"),
    ModuleManifest("analytics", "Аналитика", "roadmap"),
    ModuleManifest("pricing", "Цены", "roadmap"),
]
