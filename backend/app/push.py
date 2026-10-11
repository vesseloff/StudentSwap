"""Push-уведомления через Telegram Bot API (sendMessage).

Отправка идёт в фоновом потоке и никогда не роняет основной запрос.
Пользователь получит сообщение, только если хотя бы раз нажал Start у бота.
"""
import json
import threading
import urllib.request

from .config import BOT_TOKEN, WEBAPP_URL


def _token_configured() -> bool:
    return bool(BOT_TOKEN) and "your-bot-token" not in BOT_TOKEN


def send_telegram_push(tg_id: int, text: str) -> None:
    if not _token_configured():
        print(f"[StudentSwap] (push выключен: BOT_TOKEN не задан) tg_id={tg_id}: {text}")
        return

    def _worker():
        payload = {"chat_id": tg_id, "text": f"🔔 {text}"}
        if WEBAPP_URL.startswith("https://"):
            payload["reply_markup"] = {"inline_keyboard": [[
                {"text": "Открыть StudentSwap", "web_app": {"url": WEBAPP_URL}}
            ]]}
        try:
            req = urllib.request.Request(
                f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
                data=json.dumps(payload).encode(),
                headers={"Content-Type": "application/json"},
            )
            urllib.request.urlopen(req, timeout=10)
        except Exception as exc:
            # Обычная причина: пользователь не нажимал Start у бота
            print(f"[StudentSwap] Push не доставлен tg_id={tg_id}: {exc}")

    threading.Thread(target=_worker, daemon=True).start()
