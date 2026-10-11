"""Автоматическое резервное копирование базы данных.

SQLite: копия через встроенный backup-API (безопасно при работающем приложении),
раз в сутки, в backend/backups/, хранятся последние 14 копий.
PostgreSQL: настраивается снаружи (pg_dump по cron) — тут только подсказка в лог.
"""
import sqlite3
import threading
import time
from datetime import datetime
from pathlib import Path

from .config import BASE_DIR, DATABASE_URL

BACKUP_DIR = BASE_DIR / "backups"
BACKUP_INTERVAL_HOURS = 24
BACKUP_KEEP = 14


def _sqlite_path() -> Path | None:
    if not DATABASE_URL.startswith("sqlite"):
        return None
    raw = DATABASE_URL.partition("///")[2]
    if not raw:
        return None
    path = Path(raw)
    return path if path.is_absolute() else BASE_DIR / path


def make_backup() -> Path | None:
    src = _sqlite_path()
    if src is None or not src.exists():
        return None
    BACKUP_DIR.mkdir(exist_ok=True)
    dst = BACKUP_DIR / f"studentswap_{datetime.now():%Y-%m-%d_%H%M%S}.db"
    source = sqlite3.connect(src)
    target = sqlite3.connect(dst)
    try:
        source.backup(target)
    finally:
        target.close()
        source.close()
    # Ротация: оставляем последние BACKUP_KEEP копий
    files = sorted(BACKUP_DIR.glob("studentswap_*.db"))
    for old in files[:-BACKUP_KEEP]:
        old.unlink()
    return dst


def start_backup_thread() -> None:
    if _sqlite_path() is None:
        print("[StudentSwap] Бэкапы: база не SQLite — настройте pg_dump по cron")
        return

    def loop():
        while True:
            try:
                path = make_backup()
                if path:
                    print(f"[StudentSwap] Бэкап базы создан: {path.name}")
            except Exception as exc:
                print(f"[StudentSwap] Ошибка бэкапа: {exc}")
            time.sleep(BACKUP_INTERVAL_HOURS * 3600)

    threading.Thread(target=loop, daemon=True).start()
