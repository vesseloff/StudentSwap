"""Отправка почты через SMTP (коды верификации)."""
import smtplib
from email.message import EmailMessage
from email.utils import formataddr

from .config import (
    SMTP_FROM, SMTP_HOST, SMTP_PASSWORD, SMTP_PORT, SMTP_SSL, SMTP_USER,
)


def smtp_configured() -> bool:
    return bool(SMTP_HOST and SMTP_FROM)


def send_mail(to: str, subject: str, text: str) -> None:
    """Отправляет письмо; бросает исключение при ошибке SMTP."""
    msg = EmailMessage()
    msg["From"] = formataddr(("StudentSwap", SMTP_FROM))
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(text)

    if SMTP_SSL:
        server = smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=15)
    else:
        server = smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15)
    try:
        if not SMTP_SSL:
            server.starttls()
        if SMTP_USER:
            server.login(SMTP_USER, SMTP_PASSWORD)
        server.send_message(msg)
    finally:
        server.quit()
