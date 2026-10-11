/* API-клиент StudentSwap. Авторизация через Telegram initData,
   в браузере без Telegram — dev-режим с тестовым пользователем. */

const API_BASE = "";

const tg = window.Telegram && window.Telegram.WebApp;
const IS_TELEGRAM = !!(tg && tg.initData);

function authHeader() {
  if (IS_TELEGRAM) return "tma " + tg.initData;
  // Dev-режим: сервер принимает это только при DEV_MODE=1
  let devUser = localStorage.getItem("devUser");
  if (!devUser) {
    devUser = JSON.stringify({
      id: 100000 + Math.floor(Math.random() * 900000),
      first_name: "Тест",
      username: "dev_user_" + Math.floor(Math.random() * 1000),
    });
    localStorage.setItem("devUser", devUser);
  }
  // HTTP-заголовки не пропускают не-latin1 символы — кодируем JSON в base64
  return "dev " + btoa(String.fromCharCode(...new TextEncoder().encode(devUser)));
}

function adminToken() {
  return localStorage.getItem("adminToken") || "";
}
function adminHeaders() {
  const t = adminToken();
  return t ? { "X-Admin-Token": t } : {};
}

async function api(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    ...options,
    headers: {
      Authorization: authHeader(),
      ...(options.body && !(options.body instanceof FormData)
        ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = typeof data.detail === "string"
      ? data.detail
      : (data.detail && data.detail[0] && data.detail[0].msg) || "Ошибка запроса";
    throw new Error(msg);
  }
  return data;
}

const API = {
  me: () => api("/api/users/me"),
  updateMe: (data) => api("/api/users/me", { method: "PATCH", body: JSON.stringify(data) }),
  user: (id) => api(`/api/users/${id}`),
  userReviews: (id) => api(`/api/users/${id}/reviews`),
  verifyRequest: (email) => api("/api/users/verify/request", { method: "POST", body: JSON.stringify({ email }) }),
  verifyConfirm: (code) => api("/api/users/verify/confirm", { method: "POST", body: JSON.stringify({ code }) }),
  acceptConsent: () => api("/api/users/consent", { method: "POST" }),

  meta: () => api("/api/meta"),

  listings: (params) => api("/api/listings?" + new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== ""))
  )),
  listing: (id) => api(`/api/listings/${id}`),
  myListings: () => api("/api/listings/mine"),
  favorites: () => api("/api/listings/favorites"),
  createListing: (data) => api("/api/listings", { method: "POST", body: JSON.stringify(data) }),
  closeListing: (id) => api(`/api/listings/${id}/close`, { method: "POST" }),
  deleteListing: (id) => api(`/api/listings/${id}`, { method: "DELETE" }),
  uploadPhoto: (id, file) => {
    const fd = new FormData();
    fd.append("file", file);
    return api(`/api/listings/${id}/photos`, { method: "POST", body: fd });
  },

  toggleFavorite: (id) => api(`/api/favorites/${id}`, { method: "POST" }),

  // Админ (X-Admin-Token из localStorage)
  adminLogin: (email, password) =>
    api("/api/admin/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  adminUsers: (q) =>
    api("/api/admin/users" + (q ? "?q=" + encodeURIComponent(q) : ""), { headers: adminHeaders() }),
  adminBan: (id) => api(`/api/admin/users/${id}/ban`, { method: "POST", headers: adminHeaders() }),
  adminUnban: (id) => api(`/api/admin/users/${id}/unban`, { method: "POST", headers: adminHeaders() }),
  adminDeleteListing: (id) =>
    api(`/api/admin/listings/${id}`, { method: "DELETE", headers: adminHeaders() }),
  createReview: (data) => api("/api/reviews", { method: "POST", body: JSON.stringify(data) }),
  notifications: () => api("/api/notifications"),
  notifCount: () => api("/api/notifications/count"),
  markNotificationsRead: () => api("/api/notifications/read", { method: "POST" }),
};
