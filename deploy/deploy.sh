#!/usr/bin/env bash
# StudentSwap — установка на чистый Ubuntu 24.04 (запускать на СЕРВЕРЕ от root).
# Предполагается, что код уже загружен в /opt/studentswap
# (backend/ и frontend/ внутри), а backend/.env заполнен продакшен-значениями.
set -euo pipefail

APP_DIR=/opt/studentswap
DOMAIN=student-swap.ru
EMAIL=veselo28daniel@yandex.ru   # для Let's Encrypt (уведомления об истечении сертификата)

echo "==> [1/8] Пакеты системы"
apt-get update -y
apt-get install -y python3 python3-venv python3-pip nginx certbot python3-certbot-nginx ufw

echo "==> [2/8] Системный пользователь studentswap"
id -u studentswap >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin studentswap

echo "==> [3/8] Виртуальное окружение и зависимости"
cd "$APP_DIR/backend"
python3 -m venv .venv
./.venv/bin/pip install --upgrade pip
./.venv/bin/pip install -r requirements.txt

echo "==> [4/8] Права на файлы"
chown -R studentswap:studentswap "$APP_DIR"
chmod 600 "$APP_DIR/backend/.env"

echo "==> [5/8] systemd-сервисы (API + бот)"
cp "$APP_DIR/deploy/studentswap-api.service" /etc/systemd/system/
cp "$APP_DIR/deploy/studentswap-bot.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now studentswap-api.service
systemctl enable --now studentswap-bot.service

echo "==> [6/8] nginx"
cp "$APP_DIR/deploy/nginx-studentswap.conf" /etc/nginx/sites-available/studentswap
ln -sf /etc/nginx/sites-available/studentswap /etc/nginx/sites-enabled/studentswap
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "==> [7/8] Файрвол (SSH + HTTP/HTTPS)"
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo "==> [8/8] HTTPS-сертификат Let's Encrypt"
echo "    Требуется, чтобы A-запись $DOMAIN уже указывала на этот сервер."
certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect

echo
echo "==> ГОТОВО. Проверка:"
systemctl --no-pager status studentswap-api.service | head -4
echo "Открой: https://$DOMAIN/app/"
