"""Админ-панель: вход по email + паролю, бан пользователей, удаление объявлений.

Токен — подписанный HMAC со сроком действия, хранится на клиенте,
передаётся в заголовке X-Admin-Token.
"""
import hashlib
import hmac
import time

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..config import (
    ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_TOKEN_TTL_DAYS, BOT_TOKEN, UPLOAD_DIR,
)
from ..database import get_db
from ..models import Favorite, Listing, User

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _secret() -> bytes:
    return hashlib.sha256(f"{BOT_TOKEN}:{ADMIN_PASSWORD}".encode()).digest()


def _make_token() -> str:
    ts = str(int(time.time()))
    sig = hmac.new(_secret(), ts.encode(), hashlib.sha256).hexdigest()
    return f"{ts}.{sig}"


def _check_token(token: str) -> bool:
    if not ADMIN_PASSWORD:
        return False
    ts, _, sig = token.partition(".")
    if not ts.isdigit() or not sig:
        return False
    expected = hmac.new(_secret(), ts.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig):
        return False
    return time.time() - int(ts) < ADMIN_TOKEN_TTL_DAYS * 86400


def admin_required(x_admin_token: str = Header(default="")):
    if not _check_token(x_admin_token):
        raise HTTPException(401, "Нужен вход администратора")


class AdminLogin(BaseModel):
    email: str = Field(max_length=255)
    password: str = Field(max_length=255)


class AdminUserOut(BaseModel):
    id: int
    tg_id: int
    username: str | None
    first_name: str
    is_verified: bool
    is_banned: bool
    points: int
    listings_count: int


@router.post("/login")
def login(data: AdminLogin):
    if not ADMIN_PASSWORD:
        raise HTTPException(403, "Админ-доступ не настроен (задайте ADMIN_PASSWORD в .env)")
    email_ok = hmac.compare_digest(data.email.strip().lower(), ADMIN_EMAIL)
    pass_ok = hmac.compare_digest(data.password, ADMIN_PASSWORD)
    if not (email_ok and pass_ok):
        raise HTTPException(401, "Неверный email или пароль")
    return {"token": _make_token(), "ttl_days": ADMIN_TOKEN_TTL_DAYS}


@router.get("/users", response_model=list[AdminUserOut],
            dependencies=[Depends(admin_required)])
def users(q: str | None = None, db: Session = Depends(get_db)):
    query = db.query(User, func.count(Listing.id).label("cnt")) \
        .outerjoin(Listing, Listing.user_id == User.id) \
        .group_by(User.id)
    if q:
        pattern = f"%{q.strip()}%"
        query = query.filter(
            User.first_name.ilike(pattern) | User.username.ilike(pattern)
        )
    rows = query.order_by(User.created_at.desc()).limit(100).all()
    return [
        AdminUserOut(
            id=u.id, tg_id=u.tg_id, username=u.username, first_name=u.first_name,
            is_verified=u.is_verified, is_banned=u.is_banned, points=u.points,
            listings_count=cnt,
        )
        for u, cnt in rows
    ]


@router.post("/users/{user_id}/ban", dependencies=[Depends(admin_required)])
def ban_user(user_id: int, db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "Пользователь не найден")
    user.is_banned = True
    db.commit()
    return {"ok": True, "is_banned": True}


@router.post("/users/{user_id}/unban", dependencies=[Depends(admin_required)])
def unban_user(user_id: int, db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "Пользователь не найден")
    user.is_banned = False
    db.commit()
    return {"ok": True, "is_banned": False}


@router.delete("/listings/{listing_id}", status_code=204,
               dependencies=[Depends(admin_required)])
def delete_listing(listing_id: int, db: Session = Depends(get_db)):
    listing = db.get(Listing, listing_id)
    if not listing:
        raise HTTPException(404, "Объявление не найдено")
    for photo in listing.photos:
        path = UPLOAD_DIR / photo.filename
        if path.exists():
            path.unlink()
    db.query(Favorite).filter(Favorite.listing_id == listing_id).delete()
    db.delete(listing)
    db.commit()
