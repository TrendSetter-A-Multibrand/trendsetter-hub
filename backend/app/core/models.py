"""Таблицы ядра (схема trendsetter_hub). Структуру меняет только Alembic: create_all не вызывается."""
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, MetaData, SmallInteger, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.config import SCHEMA


class Base(DeclarativeBase):
    metadata = MetaData(schema=SCHEMA)


class Department(Base):
    __tablename__ = "departments"

    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    code: Mapped[str] = mapped_column(Text, unique=True)
    name: Mapped[str] = mapped_column(Text)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    email: Mapped[str] = mapped_column(Text)
    full_name: Mapped[str] = mapped_column(Text)
    password_hash: Mapped[str] = mapped_column(Text)
    access_level: Mapped[str | None] = mapped_column(Text, nullable=True)  # NULL — только на онбординге
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    token_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    onboarding: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    onboarding_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class OnboardingSettings(Base):
    """Общий стартовый пароль новичков: одна строка (id = 1); password_hash IS NULL — самосоздание выключено."""

    __tablename__ = "onboarding_settings"

    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True, default=1)
    password_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_by: Mapped[int | None] = mapped_column(ForeignKey(f"{SCHEMA}.users.id", ondelete="SET NULL"), nullable=True)


class UserDepartment(Base):
    __tablename__ = "user_departments"

    user_id: Mapped[int] = mapped_column(ForeignKey(f"{SCHEMA}.users.id", ondelete="CASCADE"), primary_key=True)
    department_id: Mapped[int] = mapped_column(ForeignKey(f"{SCHEMA}.departments.id"), primary_key=True)


class ModuleDepartment(Base):
    __tablename__ = "module_departments"

    module_id: Mapped[str] = mapped_column(Text, primary_key=True)
    department_id: Mapped[int] = mapped_column(ForeignKey(f"{SCHEMA}.departments.id", ondelete="CASCADE"), primary_key=True)


class AccessGroup(Base):
    __tablename__ = "access_groups"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AccessGroupPermission(Base):
    __tablename__ = "access_group_permissions"

    group_id: Mapped[int] = mapped_column(ForeignKey(f"{SCHEMA}.access_groups.id", ondelete="CASCADE"), primary_key=True)
    module_id: Mapped[str] = mapped_column(Text, primary_key=True)
    permission: Mapped[str] = mapped_column(Text)


class AccessGroupMember(Base):
    __tablename__ = "access_group_members"

    group_id: Mapped[int] = mapped_column(ForeignKey(f"{SCHEMA}.access_groups.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey(f"{SCHEMA}.users.id", ondelete="CASCADE"), primary_key=True)


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    user_id: Mapped[int | None] = mapped_column(ForeignKey(f"{SCHEMA}.users.id", ondelete="SET NULL"), nullable=True)
    action: Mapped[str] = mapped_column(Text)
    module_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    details: Mapped[dict] = mapped_column(JSONB, default=dict)


class UserModulePermission(Base):
    __tablename__ = "user_module_permissions"

    user_id: Mapped[int] = mapped_column(ForeignKey(f"{SCHEMA}.users.id", ondelete="CASCADE"), primary_key=True)
    module_id: Mapped[str] = mapped_column(Text, primary_key=True)
    permission: Mapped[str] = mapped_column(Text)


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey(f"{SCHEMA}.users.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(Text)
    title: Mapped[str] = mapped_column(Text)
    body: Mapped[str] = mapped_column(Text, default="")
    link: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
