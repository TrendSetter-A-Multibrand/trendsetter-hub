from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.core import messages
from app.core.routes_admin import router as admin_router
from app.core.routes_auth import router as auth_router
from app.core.registry import MODULES
from app.core.routes_core import router as core_router


def create_app() -> FastAPI:
    app = FastAPI(title="Trendsetter Hub API", docs_url=None, redoc_url=None, openapi_url=None)

    settings = get_settings()
    if settings.cors_origins or settings.cors_origin_regex:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_origin_regex=settings.cors_origin_regex,
            allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
            allow_headers=["Authorization", "Content-Type"],
        )

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_: Request, __: RequestValidationError) -> JSONResponse:
        # Фронтенд показывает detail как текст: отдаём русское сообщение, а не структуру pydantic
        return JSONResponse(status_code=422, content={"detail": messages.INVALID})

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok"}

    app.include_router(auth_router)
    app.include_router(core_router)
    app.include_router(admin_router)
    for module in MODULES:
        if module.router is not None:
            app.include_router(module.router)
    return app


app = create_app()
