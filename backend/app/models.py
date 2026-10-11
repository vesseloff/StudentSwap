from datetime import datetime

from sqlalchemy import (
    Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base

# Категории объявлений
CATEGORIES = [
    ("things", "Вещи"),
    ("study", "Учебные материалы"),
    ("skills", "Навыки"),
    ("coop", "Покупки"),
]

# Подкатегории по категориям
SUBCATEGORIES = {
    "things": [
        ("clothes", "Одежда"), ("tech", "Техника"), ("furniture", "Мебель"),
        ("dishes", "Посуда"), ("sport", "Спорт-инвентарь"), ("books", "Книги"),
        ("stationery", "Канцелярия"), ("other", "Другое"),
    ],
    "study": [
        ("notes", "Конспекты"), ("labs", "Лабораторные"), ("coursework", "Курсовые"),
        ("presentations", "Презентации"), ("homework", "Д/з"), ("other", "Другое"),
    ],
    "skills": [
        ("tutoring", "Репетиторство"), ("coding", "Программирование"),
        ("design", "Дизайн"), ("languages", "Иностранные языки"),
        ("video", "Монтаж видео"), ("printing", "Печать"),
        ("techsetup", "Настройка техники"), ("other", "Другое"),
    ],
    "coop": [
        ("food", "Еда"), ("tickets", "Билеты"),
        ("subscriptions", "Подписки"), ("household", "Бытовая химия"),
    ],
}

# Тип сделки
DEAL_TYPES = [
    ("free", "Отдам даром"),
    ("exchange", "Обмен"),
    ("sell", "Продажа"),
    ("service", "Услуга"),
]

# Формат сделки
DEAL_FORMATS = [
    ("offline", "Офлайн"),
    ("online", "Онлайн"),
]


class University(Base):
    __tablename__ = "universities"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    short_name: Mapped[str] = mapped_column(String(50))
    lat: Mapped[float] = mapped_column(Float)
    lon: Mapped[float] = mapped_column(Float)
    is_college: Mapped[bool] = mapped_column(Boolean, default=False)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    tg_id: Mapped[int] = mapped_column(Integer, unique=True, index=True)
    username: Mapped[str | None] = mapped_column(String(64), nullable=True)
    first_name: Mapped[str] = mapped_column(String(128), default="")
    photo_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    university_id: Mapped[int | None] = mapped_column(ForeignKey("universities.id"), nullable=True)
    faculty: Mapped[str | None] = mapped_column(String(128), nullable=True)
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lon: Mapped[float | None] = mapped_column(Float, nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    is_banned: Mapped[bool] = mapped_column(Boolean, default=False)
    consent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    points: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    university: Mapped[University | None] = relationship()
    listings: Mapped[list["Listing"]] = relationship(back_populates="owner")


class Listing(Base):
    __tablename__ = "listings"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    # kind: 'offer' — предложение, 'want' — запрос из раздела «Хочу»
    kind: Mapped[str] = mapped_column(String(10), default="offer", index=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(20), index=True)
    subcategory: Mapped[str | None] = mapped_column(String(30), nullable=True, index=True)
    deal_type: Mapped[str] = mapped_column(String(20), default="exchange")
    format: Mapped[str] = mapped_column(String(10), default="offline")
    price: Mapped[int | None] = mapped_column(Integer, nullable=True)
    exchange_for: Mapped[str | None] = mapped_column(String(300), nullable=True)
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lon: Mapped[float | None] = mapped_column(Float, nullable=True)
    university_id: Mapped[int | None] = mapped_column(ForeignKey("universities.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(10), default="active", index=True)
    views: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    owner: Mapped[User] = relationship(back_populates="listings")
    university: Mapped[University | None] = relationship()
    photos: Mapped[list["Photo"]] = relationship(
        back_populates="listing", cascade="all, delete-orphan"
    )


class Photo(Base):
    __tablename__ = "photos"

    id: Mapped[int] = mapped_column(primary_key=True)
    listing_id: Mapped[int] = mapped_column(ForeignKey("listings.id"), index=True)
    filename: Mapped[str] = mapped_column(String(255))

    listing: Mapped[Listing] = relationship(back_populates="photos")


class Favorite(Base):
    __tablename__ = "favorites"
    __table_args__ = (UniqueConstraint("user_id", "listing_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    listing_id: Mapped[int] = mapped_column(ForeignKey("listings.id"), index=True)


class Review(Base):
    __tablename__ = "reviews"
    __table_args__ = (UniqueConstraint("author_id", "listing_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    target_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    listing_id: Mapped[int] = mapped_column(ForeignKey("listings.id"))
    rating: Mapped[int] = mapped_column(Integer)  # 1..5
    text: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    author: Mapped[User] = relationship(foreign_keys=[author_id])


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    text: Mapped[str] = mapped_column(String(500))
    listing_id: Mapped[int | None] = mapped_column(ForeignKey("listings.id"), nullable=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class EmailVerification(Base):
    __tablename__ = "email_verifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    email: Mapped[str] = mapped_column(String(255))
    code: Mapped[str] = mapped_column(String(10))
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
