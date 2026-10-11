from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import inspect, text

from .backup import start_backup_thread
from .config import UPLOAD_DIR
from .database import Base, SessionLocal, engine
from .routers import admin, listings, misc, users
from .seed import seed

app = FastAPI(title="StudentSwap API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(users.router)
app.include_router(listings.router)
app.include_router(misc.router)
app.include_router(admin.router)


def _migrate():
    """Досоздаёт колонки, добавленные после первого запуска (без Alembic)."""
    wanted = {
        "users": {
            "is_banned": "BOOLEAN DEFAULT 0",
            "consent_at": "DATETIME",
        },
        "email_verifications": {"attempts": "INTEGER DEFAULT 0"},
    }
    insp = inspect(engine)
    for table, columns in wanted.items():
        if table not in insp.get_table_names():
            continue
        existing = {c["name"] for c in insp.get_columns(table)}
        for col, ddl in columns.items():
            if col not in existing:
                with engine.begin() as conn:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}"))


@app.on_event("startup")
def on_startup():
    _migrate()
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        seed(db)
    start_backup_thread()


@app.get("/")
def root():
    return RedirectResponse("/app/")


@app.get("/api/health")
def health():
    return {"status": "ok"}


FRONTEND_DIR = Path(__file__).resolve().parent.parent.parent / "frontend"
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")
app.mount("/app", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
