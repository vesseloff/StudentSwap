import random
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..config import (
    ADMIN_EMAIL, ADMIN_PASSWORD, DEV_MODE, MAX_CODE_ATTEMPTS,
    STUDENT_EMAIL_DOMAINS,
)
from ..database import get_db
from ..mailer import send_mail, smtp_configured
from ..models import EmailVerification, Notification, Review, User
from ..schemas import EmailConfirm, EmailRequest, ProfileUpdate, ReviewOut, UserMe, UserPublic
from ..utils import user_public

router = APIRouter(prefix="/api/users", tags=["users"])


def _me(user: User, db: Session) -> UserMe:
    base = user_public(user, db)
    me = UserMe(**base.model_dump(), tg_id=user.tg_id, email=user.email,
                lat=user.lat, lon=user.lon)
    me.unread_notifications = (
        db.query(Notification)
        .filter(Notification.user_id == user.id, Notification.is_read.is_(False))
        .count()
    )
    me.consent_accepted = user.consent_at is not None
    return me


@router.get("/me", response_model=UserMe)
def get_me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _me(user, db)


@router.post("/consent", response_model=UserMe)
def accept_consent(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Пользователь принял Пользовательское соглашение и Политику конфиденциальности."""
    if user.consent_at is None:
        user.consent_at = datetime.utcnow()
        db.commit()
    return _me(user, db)


@router.patch("/me", response_model=UserMe)
def update_me(
    data: ProfileUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(user, field, value)
    db.commit()
    return _me(user, db)


@router.get("/{user_id}", response_model=UserPublic)
def get_user(user_id: int, db: Session = Depends(get_db),
             _: User = Depends(get_current_user)):
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(404, "Пользователь не найден")
    return user_public(target, db)


@router.get("/{user_id}/reviews", response_model=list[ReviewOut])
def user_reviews(user_id: int, db: Session = Depends(get_db),
                 _: User = Depends(get_current_user)):
    reviews = (
        db.query(Review)
        .filter(Review.target_id == user_id)
        .order_by(Review.created_at.desc())
        .limit(50)
        .all()
    )
    out = []
    for r in reviews:
        item = ReviewOut.model_validate(r)
        item.author = user_public(r.author, db)
        out.append(item)
    return out


@router.post("/verify/request")
def request_verification(
    data: EmailRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    email = data.email.strip().lower()
    # Скрытый вход администратора: его email в форме верификации
    # переключает на запрос пароля (кода на почту не шлём).
    if ADMIN_PASSWORD and email == ADMIN_EMAIL:
        return {"ok": True, "admin": True,
                "message": "Режим администратора: введите пароль"}
    domain = email.rpartition("@")[2]
    if "@" not in email or not domain:
        raise HTTPException(422, "Некорректный email")
    if domain not in STUDENT_EMAIL_DOMAINS:
        raise HTTPException(
            422,
            "Нужна почта вуза (например, @itmo.ru, @spbu.ru, @edu.spbstu.ru, @stud.etu.ru)",
        )
    code = f"{random.randint(0, 999999):06d}"

    if smtp_configured():
        try:
            send_mail(
                email,
                "StudentSwap: код подтверждения",
                f"Привет!\n\nТвой код подтверждения статуса студента: {code}\n\n"
                "Введи его в приложении StudentSwap. Код действует для последнего запроса.\n"
                "Если ты не запрашивал(а) код — просто проигнорируй это письмо.",
            )
        except Exception as exc:
            print(f"[StudentSwap] Ошибка отправки письма на {email}: {exc}")
            raise HTTPException(502, "Не удалось отправить письмо. Попробуй ещё раз через минуту.")
        message = f"Код отправлен на {email}. Проверь почту (и папку «Спам»)."
    elif DEV_MODE:
        print(f"[StudentSwap] Код подтверждения для {email}: {code}")
        message = f"(DEV) SMTP не настроен — код в логе сервера для {email}"
    else:
        raise HTTPException(503, "Отправка почты не настроена на сервере (SMTP_HOST в .env)")

    db.query(EmailVerification).filter(EmailVerification.user_id == user.id).delete()
    db.add(EmailVerification(user_id=user.id, email=email, code=code))
    db.commit()
    return {"ok": True, "message": message}


@router.post("/verify/confirm", response_model=UserMe)
def confirm_verification(
    data: EmailConfirm,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ver = (
        db.query(EmailVerification)
        .filter(EmailVerification.user_id == user.id)
        .order_by(EmailVerification.created_at.desc())
        .first()
    )
    if not ver:
        raise HTTPException(422, "Сначала запроси код на почту вуза")
    if ver.code != data.code.strip():
        ver.attempts += 1
        remaining = MAX_CODE_ATTEMPTS - ver.attempts
        if remaining <= 0:
            db.delete(ver)  # код сгорает после 5 неверных попыток
            db.commit()
            raise HTTPException(
                422, "Код заблокирован после 5 неверных попыток. Запроси новый код.")
        db.commit()
        raise HTTPException(422, f"Неверный код. Осталось попыток: {remaining}")
    user.email = ver.email
    user.is_verified = True
    db.delete(ver)
    db.commit()
    return _me(user, db)
