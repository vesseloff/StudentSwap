from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import (
    CATEGORIES, DEAL_FORMATS, DEAL_TYPES, SUBCATEGORIES,
    Favorite, Listing, Notification, Review, University, User,
)
from ..schemas import NotificationOut, ReviewCreate, ReviewOut, UniversityOut
from ..utils import notify, user_public

router = APIRouter(prefix="/api", tags=["misc"])


@router.get("/meta")
def meta(db: Session = Depends(get_db)):
    return {
        "categories": [{"id": k, "name": v} for k, v in CATEGORIES],
        "subcategories": {
            cat: [{"id": k, "name": v} for k, v in subs]
            for cat, subs in SUBCATEGORIES.items()
        },
        "deal_types": [{"id": k, "name": v} for k, v in DEAL_TYPES],
        "formats": [{"id": k, "name": v} for k, v in DEAL_FORMATS],
        "universities": [
            UniversityOut.model_validate(u).model_dump()
            for u in db.query(University).order_by(University.short_name).all()
        ],
    }


@router.post("/favorites/{listing_id}")
def toggle_favorite(listing_id: int, user: User = Depends(get_current_user),
                    db: Session = Depends(get_db)):
    if not db.get(Listing, listing_id):
        raise HTTPException(404, "Объявление не найдено")
    fav = (
        db.query(Favorite)
        .filter(Favorite.user_id == user.id, Favorite.listing_id == listing_id)
        .first()
    )
    if fav:
        db.delete(fav)
        db.commit()
        return {"is_favorite": False}
    db.add(Favorite(user_id=user.id, listing_id=listing_id))
    db.commit()
    return {"is_favorite": True}


@router.post("/reviews", response_model=ReviewOut, status_code=201)
def create_review(data: ReviewCreate, user: User = Depends(get_current_user),
                  db: Session = Depends(get_db)):
    listing = db.get(Listing, data.listing_id)
    if not listing:
        raise HTTPException(404, "Объявление не найдено")
    if listing.user_id == user.id:
        raise HTTPException(422, "Нельзя оставить отзыв на своё объявление")
    exists = (
        db.query(Review)
        .filter(Review.author_id == user.id, Review.listing_id == data.listing_id)
        .first()
    )
    if exists:
        raise HTTPException(422, "Отзыв по этой сделке уже оставлен")
    review = Review(
        author_id=user.id,
        target_id=listing.user_id,
        listing_id=data.listing_id,
        rating=data.rating,
        text=data.text,
    )
    db.add(review)
    # Баллы доверия за успешную сделку — обеим сторонам
    owner = db.get(User, listing.user_id)
    owner.points += 10
    user.points += 5
    notify(db, listing.user_id,
           f"{user.first_name} оставил(а) отзыв ({data.rating}★) по «{listing.title}». +10 баллов!",
           listing.id)
    db.commit()
    out = ReviewOut.model_validate(review)
    out.author = user_public(user, db)
    return out


@router.get("/notifications/count")
def notifications_count(user: User = Depends(get_current_user),
                        db: Session = Depends(get_db)):
    unread = (
        db.query(Notification)
        .filter(Notification.user_id == user.id, Notification.is_read.is_(False))
        .count()
    )
    return {"unread": unread}


@router.get("/notifications", response_model=list[NotificationOut])
def notifications(user: User = Depends(get_current_user),
                  db: Session = Depends(get_db)):
    return (
        db.query(Notification)
        .filter(Notification.user_id == user.id)
        .order_by(Notification.created_at.desc())
        .limit(50)
        .all()
    )


@router.post("/notifications/read")
def mark_read(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.query(Notification).filter(
        Notification.user_id == user.id, Notification.is_read.is_(False)
    ).update({"is_read": True})
    db.commit()
    return {"ok": True}
