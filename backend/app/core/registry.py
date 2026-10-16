"""Реестр модулей. Новый модуль = папка в modules/ и одна строка здесь (+ строка во фронтенде и миграция)."""
from dataclasses import dataclass


@dataclass(frozen=True)
class ModuleManifest:
    id: str
    title: str
    status: str  # "mvp" | "roadmap"


MODULES: list[ModuleManifest] = [
    ModuleManifest("purchasing", "Закупки", "mvp"),
    ModuleManifest("warehouse", "Склад", "mvp"),
    ModuleManifest("wb", "WB-карточки", "roadmap"),
    ModuleManifest("analytics", "Аналитика", "roadmap"),
    ModuleManifest("pricing", "Цены", "roadmap"),
]
