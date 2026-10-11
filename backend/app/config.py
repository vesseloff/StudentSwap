import os
import sys
from pathlib import Path

# Консоль Windows по умолчанию cp1252 и падает на кириллице в print()
for stream in (sys.stdout, sys.stderr):
    if stream and hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="replace")

BASE_DIR = Path(__file__).resolve().parent.parent  # backend/


def _load_dotenv() -> None:
    """Минимальный загрузчик .env без внешних зависимостей."""
    env_file = BASE_DIR / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


_load_dotenv()

BOT_TOKEN: str = os.getenv("BOT_TOKEN", "")
DEV_MODE: bool = os.getenv("DEV_MODE", "0") == "1"

# Администратор (вход по email + паролю)
ADMIN_EMAIL: str = os.getenv("ADMIN_EMAIL", "airjordaniel28@gmail.com").strip().lower()
ADMIN_PASSWORD: str = os.getenv("ADMIN_PASSWORD", "")
ADMIN_TOKEN_TTL_DAYS = 30

# SMTP для писем с кодом верификации.
# Если SMTP_HOST пуст: в DEV_MODE код печатается в лог, в проде — ошибка 503.
SMTP_HOST: str = os.getenv("SMTP_HOST", "")
SMTP_PORT: int = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER: str = os.getenv("SMTP_USER", "")
SMTP_PASSWORD: str = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM: str = os.getenv("SMTP_FROM", SMTP_USER)
SMTP_SSL: bool = os.getenv("SMTP_SSL", "0") == "1"  # 1 = SMTPS (порт 465), иначе STARTTLS
DATABASE_URL: str = os.getenv("DATABASE_URL", f"sqlite:///{BASE_DIR / 'studentswap.db'}")
WEBAPP_URL: str = os.getenv("WEBAPP_URL", "http://localhost:8000/app/")

UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

MAX_CODE_ATTEMPTS = 5             # попыток ввода кода из письма

MAX_PHOTOS_PER_LISTING = 10
MAX_PHOTO_SIZE_MB = 8

# Домены студенческих почт для верификации «Студент подтверждён»
STUDENT_EMAIL_DOMAINS = {
    "itmo.ru", "niuitmo.ru", "student.itmo.ru",
    "spbu.ru", "student.spbu.ru",
    "spbstu.ru", "edu.spbstu.ru",
    "etu.ru", "stud.etu.ru",
    "lesgaft.spb.ru",
    "guap.ru", "pixel.guap.ru",
    "herzen.spb.ru", "unecon.ru", "spmi.ru", "sut.ru",
}
