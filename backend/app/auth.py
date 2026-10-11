"""Авторизация через Telegram WebApp initData.

Клиент шлёт заголовок:  Authorization: tma <initData>
В DEV_MODE также принимается:  Authorization: dev <json-пользователя>
(JSON может быть закодирован в base64 — HTTP-заголовки не пропускают кириллицу)
"""
import base64
import hashlib
import hmac
import json
import time
from urllib.parse import parse_qsl

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from .config import BOT_TOKEN, DEV_MODE
from .database import get_db
from .models import User

AUTH_MAX_AGE_SECONDS = 24 * 3600


def _validate_init_data(init_data: str) -> dict:
    """Проверяет подпись initData по алгоритму Telegram и возвращает поле user."""
    if not BOT_TOKEN:
        raise HTTPException(500, "BOT_TOKEN не настроен на сервере")
    try:
        pairs = dict(parse_qsl(init_data, keep_blank_values=True))
        received_hash = pairs.pop("hash")
    except Exception:
        raise HTTPException(401, "Некорректный initData")

    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))
    secret_key = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
    calculated = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(calculated, received_hash):
        raise HTTPException(401, "Подпись initData не совпадает")

    auth_date = int(pairs.get("auth_date", "0"))
    if time.time() - auth_date > AUTH_MAX_AGE_SECONDS:
        raise HTTPException(401, "initData устарел, переоткройте Mini App")

    return json.loads(pairs.get("user", "{}"))


def get_current_user(
    authorization: str = Header(default=""),
    db: Session = Depends(get_db),
) -> User:
    scheme, _, payload = authorization.partition(" ")
    scheme = scheme.lower()

    if scheme == "dev" and DEV_MODE:
        try:
            raw = payload if payload.lstrip().startswith("{") \
                else base64.b64decode(payload).decode("utf-8")
            tg_user = json.loads(raw)
        except (json.JSONDecodeError, ValueError, UnicodeDecodeError):
            raise HTTPException(401, "Некорректный dev-пользователь")
    elif scheme == "tma" and payload:
        tg_user = _validate_init_data(payload)
    else:
        raise HTTPException(401, "Нет авторизации. Откройте приложение через Telegram.")

    tg_id = tg_user.get("id")
    if not tg_id:
        raise HTTPException(401, "В initData нет пользователя")

    user = db.query(User).filter(User.tg_id == tg_id).first()
    if user is None:
        user = User(
            tg_id=tg_id,
            username=tg_user.get("username"),
            first_name=tg_user.get("first_name", ""),
            photo_url=tg_user.get("photo_url"),
        )
        db.add(user)
        db.commit()
    else:
        # Обновляем имя/username при каждом входе
        user.username = tg_user.get("username") or user.username
        user.first_name = tg_user.get("first_name") or user.first_name
        user.photo_url = tg_user.get("photo_url") or user.photo_url
        db.commit()
    if user.is_banned:
        raise HTTPException(403, "Аккаунт заблокирован администратором")
    return user
