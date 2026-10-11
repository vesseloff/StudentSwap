from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class UniversityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    short_name: str
    lat: float
    lon: float
    is_college: bool = False


class UserPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    username: str | None
    first_name: str
    photo_url: str | None
    is_verified: bool
    university: UniversityOut | None = None
    faculty: str | None = None
    points: int = 0
    rating: float = 0.0
    rating_count: int = 0


class UserMe(UserPublic):
    tg_id: int
    email: str | None = None
    lat: float | None = None
    lon: float | None = None
    unread_notifications: int = 0
    consent_accepted: bool = False


class ProfileUpdate(BaseModel):
    university_id: int | None = None
    faculty: str | None = Field(default=None, max_length=128)
    lat: float | None = None
    lon: float | None = None


class ListingCreate(BaseModel):
    kind: str = Field(default="offer", pattern="^(offer|want)$")
    title: str = Field(min_length=3, max_length=200)
    description: str = Field(default="", max_length=4000)
    category: str = Field(pattern="^(things|study|skills|coop)$")
    subcategory: str | None = Field(default=None, max_length=30)
    deal_type: str = Field(default="exchange", pattern="^(free|exchange|sell|service)$")
    format: str = Field(default="offline", pattern="^(offline|online)$")
    price: int | None = Field(default=None, ge=0, le=10_000_000)
    exchange_for: str | None = Field(default=None, max_length=300)
    lat: float | None = None
    lon: float | None = None
    university_id: int | None = None


class ListingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    kind: str
    title: str
    description: str
    category: str
    subcategory: str | None
    deal_type: str
    format: str
    price: int | None
    exchange_for: str | None
    lat: float | None
    lon: float | None
    status: str
    views: int
    created_at: datetime
    owner: UserPublic
    university: UniversityOut | None
    photo_urls: list[str] = []
    distance_km: float | None = None
    is_favorite: bool = False


class ReviewCreate(BaseModel):
    listing_id: int
    rating: int = Field(ge=1, le=5)
    text: str = Field(default="", max_length=1000)


class ReviewOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    rating: int
    text: str
    created_at: datetime
    author: UserPublic


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    text: str
    listing_id: int | None
    is_read: bool
    created_at: datetime


class EmailRequest(BaseModel):
    email: str = Field(max_length=255)


class EmailConfirm(BaseModel):
    code: str = Field(max_length=10)
