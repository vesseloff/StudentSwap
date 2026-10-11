# Развёртывание StudentSwap на VPS (Ubuntu 24.04)

Данные твоего сервера: IP `139.100.234.169`, домен `student-swap.ru`.
Все команды на Windows выполняй в **PowerShell**; команды на сервере — после входа по SSH.

---

## Шаг 0. Указать домен на сервер (DNS)

В панели управления доменом `student-swap.ru` (у регистратора) поменяй **A-записи**:

| Тип | Имя (host) | Значение          |
|-----|------------|-------------------|
| A   | @          | 139.100.234.169   |
| A   | www        | 139.100.234.169   |

Сейчас домен смотрит на `95.163.244.138` (заглушку) — это надо изменить.
Обновление DNS занимает от нескольких минут до пары часов. Проверить:
```
nslookup student-swap.ru
```
должно показать `139.100.234.169`.

---

## Шаг 1. Проверить доступ к серверу (с Windows)

```
ssh -i $env:USERPROFILE\.ssh\studentswap_vps root@139.100.234.169
```
Если сервер только что создан — SSH может быть недоступен 5–10 минут, подожди.
После входа увидишь приглашение `root@...:~#`. Выйти обратно: `exit`.

---

## Шаг 2. Загрузить код на сервер (с Windows)

Из папки проекта `d:\ClaudeCode\StudentSwap` выполни:
```
ssh -i $env:USERPROFILE\.ssh\studentswap_vps root@139.100.234.169 "mkdir -p /opt/studentswap"
scp -i $env:USERPROFILE\.ssh\studentswap_vps -r backend frontend deploy root@139.100.234.169:/opt/studentswap/
```
(Локальные `studentswap.db`, `uploads`, `backups`, `.venv` копировать не нужно —
база и папки создадутся на сервере заново. Если они большие, можно их не слать.)

---

## Шаг 3. Создать боевой .env на сервере

Зайди на сервер (Шаг 1) и создай файл конфигурации:
```
cp /opt/studentswap/deploy/.env.production /opt/studentswap/backend/.env
nano /opt/studentswap/backend/.env
```
Проверь/поменяй:
- `ADMIN_PASSWORD` — придумай новый надёжный пароль;
- остальное уже заполнено (бот-токен, SMTP Яндекса, домен).
Сохранить в nano: `Ctrl+O`, `Enter`, выйти `Ctrl+X`.

---

## Шаг 4. Запустить установку

На сервере:
```
bash /opt/studentswap/deploy/deploy.sh
```
Скрипт сам поставит Python, nginx, создаст сервисы, включит файрвол и выпустит
HTTPS-сертификат. **Важно:** к этому моменту DNS (Шаг 0) уже должен указывать на сервер,
иначе последний шаг (сертификат) не пройдёт — тогда повтори только его:
```
certbot --nginx -d student-swap.ru -d www.student-swap.ru
```

---

## Шаг 5. Переключить бота на боевой домен

Кнопка меню бота сейчас ведёт на временный туннель. После запуска `bot.py`
на сервере она сама обновится на `https://student-swap.ru/app/`
(берётся из `WEBAPP_URL`). Проверь: открой `@StudentSwapBot` → кнопка меню.

---

## Проверка и обслуживание

```
systemctl status studentswap-api     # статус API
systemctl status studentswap-bot     # статус бота
journalctl -u studentswap-api -f     # логи API вживую
systemctl restart studentswap-api    # перезапуск после изменений
```

Открой в браузере: **https://student-swap.ru/app/** — должно грузиться приложение
(в браузере без Telegram будет «Нет авторизации» — это норма при DEV_MODE=0).

---

## Обновление кода в будущем

С Windows заново скопируй изменённые файлы и перезапусти сервис:
```
scp -i $env:USERPROFILE\.ssh\studentswap_vps -r backend root@139.100.234.169:/opt/studentswap/
ssh -i $env:USERPROFILE\.ssh\studentswap_vps root@139.100.234.169 "systemctl restart studentswap-api studentswap-bot"
```

---

## Безопасность после установки

- Смени пароль root: на сервере команда `passwd` (текущий засветился в переписке).
- Вход по паролю можно отключить (оставив только ключ): в `/etc/ssh/sshd_config`
  поставить `PasswordAuthentication no`, затем `systemctl restart ssh`.
  ВНИМАНИЕ: сначала убедись, что вход по ключу работает, иначе потеряешь доступ.
- Отзови и пересоздай пароль приложения Яндекса, если он где-то засветился.
