"""Telegram-бот StudentSwap: кнопка запуска Mini App.

Запуск:  python bot.py  (нужны BOT_TOKEN и WEBAPP_URL в backend/.env)
"""
import asyncio

from aiogram import Bot, Dispatcher
from aiogram.filters import CommandStart
from aiogram.types import (
    InlineKeyboardButton, InlineKeyboardMarkup, MenuButtonWebApp, Message, WebAppInfo,
)

from app.config import BOT_TOKEN, WEBAPP_URL

dp = Dispatcher()


GREETING = (
    "Привет! Это <b>StudentSwap</b> 🔄\n"
    "Обмен вещами, конспектами и навыками для студентов Санкт-Петербурга.\n"
    "<i>Обменяйся с теми, кто рядом — вещи, конспекты, навыки, всё по-студенчески.</i>\n\n"
    "<b>Что можно делать:</b>\n"
    "📦 <b>Отдавать и обменивать</b> — вещи, технику, учебники, мебель\n"
    "📚 <b>Делиться учёбой</b> — конспекты, лабы, курсовые, презентации\n"
    "🧠 <b>Предлагать навыки</b> — репетиторство, код, дизайн, языки\n"
    "🛒 <b>Скидываться вместе</b> — еда, билеты, подписки\n"
    "🙏 <b>Раздел «Хочу»</b> — размести запрос, и мы сообщим, когда рядом появится нужное\n\n"
    "<b>Как начать:</b>\n"
    "1️⃣ Нажми «Открыть StudentSwap» ниже\n"
    "2️⃣ Укажи свой вуз или колледж и подтверди статус студента по почте — так тебе больше доверяют\n"
    "3️⃣ Публикуй объявление за 30 секунд: фото, описание, условия обмена\n"
    "4️⃣ Ищи по фильтрам и карте, что есть рядом с твоим кампусом\n"
    "5️⃣ Договаривайся в чате, встречайся, а после сделки — оставь отзыв ⭐\n\n"
    "Открой приложение и осмотрись 👇"
)


@dp.message(CommandStart())
async def start(message: Message):
    kb = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="🔄 Открыть StudentSwap",
                             web_app=WebAppInfo(url=WEBAPP_URL))
    ]])
    await message.answer(GREETING, reply_markup=kb, parse_mode="HTML")


async def main():
    bot = Bot(BOT_TOKEN)
    await bot.set_chat_menu_button(
        menu_button=MenuButtonWebApp(text="StudentSwap", web_app=WebAppInfo(url=WEBAPP_URL))
    )
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
