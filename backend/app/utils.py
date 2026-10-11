import math

from sqlalchemy.orm import Session

from .models import Listing, Notification, Review, User
from .push import send_telegram_push
from .schemas import ListingOut, UserPublic


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def user_public(user: User, db: Session) -> UserPublic:
    rows = (
        db.query(Review.rating).filter(Review.target_id == user.id).all()
    )
    count = len(rows)
    avg = round(sum(r[0] for r in rows) / count, 2) if count else 0.0
    data = UserPublic.model_validate(user)
    data.rating = avg
    data.rating_count = count
    return data


def listing_out(
    listing: Listing,
    db: Session,
    viewer: User | None = None,
    viewer_lat: float | None = None,
    viewer_lon: float | None = None,
    favorite_ids: set[int] | None = None,
) -> ListingOut:
    out = ListingOut.model_validate(listing)
    out.owner = user_public(listing.owner, db)
    out.photo_urls = [f"/uploads/{p.filename}" for p in listing.photos]
    if (
        viewer_lat is not None and viewer_lon is not None
        and listing.lat is not None and listing.lon is not None
    ):
        out.distance_km = round(
            haversine_km(viewer_lat, viewer_lon, listing.lat, listing.lon), 2
        )
    if favorite_ids is not None:
        out.is_favorite = listing.id in favorite_ids
    return out


def notify(db: Session, user_id: int, text: str, listing_id: int | None = None) -> None:
    db.add(Notification(user_id=user_id, text=text, listing_id=listing_id))
    # Дублируем пуш-сообщением в личку через бота
    user = db.get(User, user_id)
    if user:
        send_telegram_push(user.tg_id, text)


def match_wants(db: Session, new_listing: Listing) -> None:
    """При публикации предложения ищем запросы «Хочу» с пересечением по словам
    и шлём их авторам уведомление «Рядом появилось то, что ты искал»."""
    if new_listing.kind != "offer":
        return
    words = {
        w.lower().strip(".,!?()")
        for w in new_listing.title.split()
        if len(w) >= 4
    }
    if not words:
        return
    wants = (
        db.query(Listing)
        .filter(Listing.kind == "want", Listing.status == "active",
                Listing.user_id != new_listing.user_id)
        .all()
    )
    for want in wants:
        want_words = {
            w.lower().strip(".,!?()") for w in want.title.split() if len(w) >= 4
        }
        if words & want_words:
            notify(
                db, want.user_id,
                f"Рядом появилось то, что ты искал: «{new_listing.title}»",
                new_listing.id,
            )
