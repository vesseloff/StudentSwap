import secrets
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from ..auth import get_current_user
from ..config import MAX_PHOTO_SIZE_MB, MAX_PHOTOS_PER_LISTING, UPLOAD_DIR
from ..database import get_db
from ..models import SUBCATEGORIES, Favorite, Listing, Photo, User
from ..schemas import ListingCreate, ListingOut
from ..utils import haversine_km, listing_out, match_wants, notify

router = APIRouter(prefix="/api/listings", tags=["listings"])

ALLOWED_IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}


def _favorite_ids(db: Session, user: User) -> set[int]:
    return {
        f.listing_id
        for f in db.query(Favorite).filter(Favorite.user_id == user.id).all()
    }


@router.get("", response_model=list[ListingOut])
def search_listings(
    q: str | None = None,
    kind: str = Query(default="offer", pattern="^(offer|want)$"),
    category: str | None = Query(default=None, pattern="^(things|study|skills|coop)$"),
    subcategory: str | None = Query(default=None, max_length=30),
    deal_type: str | None = Query(default=None, pattern="^(free|exchange|sell|service)$"),
    format: str | None = Query(default=None, pattern="^(offline|online)$"),
    university_id: int | None = None,
    max_km: float | None = Query(default=None, ge=0.1, le=50),
    lat: float | None = None,
    lon: float | None = None,
    sort: str = Query(default="new", pattern="^(new|near|popular)$"),
    limit: int = Query(default=50, le=100),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = (
        db.query(Listing)
        .options(joinedload(Listing.owner), joinedload(Listing.photos),
                 joinedload(Listing.university))
        .join(User, Listing.user_id == User.id)
        .filter(Listing.status == "active", Listing.kind == kind,
                User.is_banned.is_(False))
    )
    if q:
        pattern = f"%{q.strip()}%"
        query = query.filter(or_(Listing.title.ilike(pattern),
                                 Listing.description.ilike(pattern)))
    if category:
        query = query.filter(Listing.category == category)
    if subcategory:
        query = query.filter(Listing.subcategory == subcategory)
    if deal_type:
        query = query.filter(Listing.deal_type == deal_type)
    if format:
        query = query.filter(Listing.format == format)
    if university_id:
        query = query.filter(Listing.university_id == university_id)

    if sort == "popular":
        query = query.order_by(Listing.views.desc(), Listing.created_at.desc())
    else:
        query = query.order_by(Listing.created_at.desc())

    items = query.limit(500).all()

    # Гео-фильтр по радиусу от точки пользователя
    viewer_lat = lat if lat is not None else user.lat
    viewer_lon = lon if lon is not None else user.lon
    if max_km is not None and viewer_lat is not None and viewer_lon is not None:
        items = [
            l for l in items
            if l.lat is not None and l.lon is not None
            and haversine_km(viewer_lat, viewer_lon, l.lat, l.lon) <= max_km
        ]

    fav_ids = _favorite_ids(db, user)
    result = [
        listing_out(l, db, user, viewer_lat, viewer_lon, fav_ids) for l in items
    ]
    if sort == "near" and viewer_lat is not None:
        result.sort(key=lambda x: x.distance_km if x.distance_km is not None else 1e9)
    return result[offset:offset + limit]


@router.get("/mine", response_model=list[ListingOut])
def my_listings(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    items = (
        db.query(Listing)
        .options(joinedload(Listing.photos))
        .filter(Listing.user_id == user.id)
        .order_by(Listing.created_at.desc())
        .all()
    )
    fav_ids = _favorite_ids(db, user)
    return [listing_out(l, db, user, user.lat, user.lon, fav_ids) for l in items]


@router.get("/favorites", response_model=list[ListingOut])
def favorite_listings(user: User = Depends(get_current_user),
                      db: Session = Depends(get_db)):
    fav_ids = _favorite_ids(db, user)
    if not fav_ids:
        return []
    items = (
        db.query(Listing)
        .filter(Listing.id.in_(fav_ids), Listing.status == "active")
        .order_by(Listing.created_at.desc())
        .all()
    )
    return [listing_out(l, db, user, user.lat, user.lon, fav_ids) for l in items]


@router.get("/{listing_id}", response_model=ListingOut)
def get_listing(listing_id: int, user: User = Depends(get_current_user),
                db: Session = Depends(get_db)):
    listing = db.get(Listing, listing_id)
    if not listing:
        raise HTTPException(404, "Объявление не найдено")
    if listing.user_id != user.id:
        listing.views += 1
        # Уведомление о просмотрах на круглых числах
        if listing.views in (10, 25, 50, 100):
            notify(db, listing.user_id,
                   f"Твоё объявление «{listing.title}» просмотрели {listing.views} раз",
                   listing.id)
        db.commit()
    return listing_out(listing, db, user, user.lat, user.lon, _favorite_ids(db, user))


@router.post("", response_model=ListingOut, status_code=201)
def create_listing(data: ListingCreate, user: User = Depends(get_current_user),
                   db: Session = Depends(get_db)):
    if data.subcategory:
        valid = {sub_id for sub_id, _ in SUBCATEGORIES.get(data.category, [])}
        if data.subcategory not in valid:
            raise HTTPException(422, "Неизвестная подкатегория")
    if not user.is_verified:
        active = (
            db.query(Listing)
            .filter(Listing.user_id == user.id, Listing.status == "active")
            .count()
        )
        if active >= 1:
            raise HTTPException(
                403,
                "Без подтверждения статуса студента можно разместить только одно объявление. "
                "Подтверди почту вуза — и публикуй без ограничений.",
            )
    listing = Listing(user_id=user.id, **data.model_dump())
    # Если гео не указано — берём точку пользователя или его вуза
    if listing.lat is None:
        if user.lat is not None:
            listing.lat, listing.lon = user.lat, user.lon
        elif user.university:
            listing.lat, listing.lon = user.university.lat, user.university.lon
    if listing.university_id is None:
        listing.university_id = user.university_id
    db.add(listing)
    db.flush()
    match_wants(db, listing)
    db.commit()
    return listing_out(listing, db, user, user.lat, user.lon, set())


@router.post("/{listing_id}/photos", response_model=ListingOut)
async def upload_photo(listing_id: int, file: UploadFile,
                       user: User = Depends(get_current_user),
                       db: Session = Depends(get_db)):
    listing = db.get(Listing, listing_id)
    if not listing or listing.user_id != user.id:
        raise HTTPException(404, "Объявление не найдено")
    if len(listing.photos) >= MAX_PHOTOS_PER_LISTING:
        raise HTTPException(422, f"Максимум {MAX_PHOTOS_PER_LISTING} фото")
    ext = ALLOWED_IMAGE_TYPES.get(file.content_type or "")
    if not ext:
        raise HTTPException(422, "Поддерживаются JPEG, PNG, WebP")
    content = await file.read()
    if len(content) > MAX_PHOTO_SIZE_MB * 1024 * 1024:
        raise HTTPException(422, f"Файл больше {MAX_PHOTO_SIZE_MB} МБ")
    filename = f"{listing_id}_{secrets.token_hex(8)}{ext}"
    (UPLOAD_DIR / filename).write_bytes(content)
    db.add(Photo(listing_id=listing_id, filename=filename))
    db.commit()
    db.refresh(listing)
    return listing_out(listing, db, user, user.lat, user.lon, set())


@router.post("/{listing_id}/close", response_model=ListingOut)
def close_listing(listing_id: int, user: User = Depends(get_current_user),
                  db: Session = Depends(get_db)):
    listing = db.get(Listing, listing_id)
    if not listing or listing.user_id != user.id:
        raise HTTPException(404, "Объявление не найдено")
    listing.status = "closed"
    db.commit()
    return listing_out(listing, db, user, user.lat, user.lon, set())


@router.delete("/{listing_id}", status_code=204)
def delete_listing(listing_id: int, user: User = Depends(get_current_user),
                   db: Session = Depends(get_db)):
    listing = db.get(Listing, listing_id)
    if not listing or listing.user_id != user.id:
        raise HTTPException(404, "Объявление не найдено")
    for photo in listing.photos:
        path = Path(UPLOAD_DIR / photo.filename)
        if path.exists():
            path.unlink()
    db.query(Favorite).filter(Favorite.listing_id == listing_id).delete()
    db.delete(listing)
    db.commit()
