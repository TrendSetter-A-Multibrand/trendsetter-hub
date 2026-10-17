FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app/backend

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Код бэкенда и SQL-скрипты схемы (их выполняет ревизия Alembic 0001)
COPY backend/ /app/backend/
COPY db/ /app/db/

RUN useradd --create-home --uid 10001 hub
USER hub

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
