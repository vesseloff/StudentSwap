/* StudentSwap Mini App — основная логика интерфейса */

// Ключ API Яндекс Карт (JS API 2.1). Для продакшена получите ключ:
// https://developer.tech.yandex.ru/ и вставьте сюда.
const YMAPS_API_KEY = "a05f0f00-c93b-424d-bd79-7c527c6b3c92";

const state = {
  me: null,
  meta: { categories: [], subcategories: {}, deal_types: [], formats: [], universities: [] },
  view: "feed",
  feed: {
    q: "", category: "", subcategory: "", deal_type: "", format: "",
    university_id: "", max_km: "", sort: "new",
  },
  ymap: null,
};

const CATEGORY_ICON = { things: "package", study: "book", skills: "bulb", coop: "bag" };

const $ = (sel) => document.querySelector(sel);
const view = () => $("#view");

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add("hidden"), 2600);
}

function haptic() {
  if (IS_TELEGRAM && tg.HapticFeedback) tg.HapticFeedback.impactOccurred("light");
}

function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso + "Z").getTime()) / 1000;
  if (diff < 60) return "только что";
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`;
  return `${Math.floor(diff / 86400)} дн назад`;
}

function priceLabel(l) {
  if (l.deal_type === "free") return `${icon("gift", 15)} Даром`;
  if (l.deal_type === "exchange")
    return l.exchange_for ? `${icon("swap", 15)} Обмен на: ${esc(l.exchange_for)}` : `${icon("swap", 15)} Обмен`;
  if (l.price != null) return `${icon("tag", 15)} ${l.price.toLocaleString("ru-RU")} ₽`;
  return `${icon("tag", 15)} Услуга`;
}

function subcatName(l) {
  const subs = state.meta.subcategories[l.category] || [];
  const s = subs.find((x) => x.id === l.subcategory);
  return s ? s.name : "";
}

function starsInline(n) {
  return `<span class="stars-inline">${icon("star", 13).repeat(Math.max(1, n))}</span>`;
}

/* ---------- Модалка ---------- */
function openModal(html) {
  $("#modal-content").innerHTML = html;
  $("#modal").classList.remove("hidden");
}
let modalLocked = false; // запрет закрытия по клику вне окна (для экрана согласия)
function closeModal() {
  if (modalLocked) return;
  $("#modal").classList.add("hidden");
}
document.addEventListener("click", (e) => {
  if (e.target.classList.contains("modal-backdrop")) closeModal();
});

/* ---------- Карточка объявления ---------- */
function cardHTML(l) {
  const photo = l.photo_urls.length
    ? `<img class="card-photo" src="${l.photo_urls[0]}" alt="">`
    : `<div class="card-photo">${icon(CATEGORY_ICON[l.category] || "package", 34)}</div>`;
  const uni = l.university ? `<span>${icon("gradcap", 13)} ${esc(l.university.short_name)}</span>` : "";
  const dist = l.distance_km != null
    ? `<span>${icon("pin", 13)} ${l.distance_km < 1 ? Math.round(l.distance_km * 1000) + " м" : l.distance_km + " км"}</span>` : "";
  const online = l.format === "online" ? `<span>${icon("globe", 13)} онлайн</span>` : "";
  const ver = l.owner.is_verified ? ` <span class="verified">${icon("checkbadge", 13)}</span>` : "";
  return `
    <div class="card" data-id="${l.id}">
      ${photo}
      <div class="card-body">
        <div class="card-title">${esc(l.title)}</div>
        <div class="card-price">${priceLabel(l)}</div>
        <div class="card-meta">
          <span>${esc(l.owner.first_name)}${ver}</span>
          ${uni}${dist}${online}
          <span>${icon("eye", 13)} ${l.views}</span>
          <span>${icon("clock", 13)} ${timeAgo(l.created_at)}</span>
        </div>
      </div>
      <button class="card-fav ${l.is_favorite ? "on" : ""}" data-fav="${l.id}">${icon("heart", 20)}</button>
    </div>`;
}

function bindCards(container) {
  if (!container) return;
  container.querySelectorAll(".card").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest(".card-fav")) return;
      openListing(Number(el.dataset.id));
    });
  });
  container.querySelectorAll(".card-fav").forEach((el) => {
    el.addEventListener("click", async () => {
      haptic();
      try {
        const r = await API.toggleFavorite(Number(el.dataset.fav));
        el.classList.toggle("on", r.is_favorite);
      } catch (err) { toast(err.message); }
    });
  });
}

/* ---------- Лента ---------- */
function activeFilterCount() {
  const f = state.feed;
  return ["category", "subcategory", "deal_type", "format", "university_id", "max_km"]
    .filter((k) => f[k]).length;
}

async function renderFeed() {
  const f = state.feed;
  const cats = [{ id: "", name: "Все" }, ...state.meta.categories];
  const subs = f.category ? (state.meta.subcategories[f.category] || []) : [];
  const nFilters = activeFilterCount();

  view().innerHTML = `
    <div class="search-row">
      <div class="search-wrap">
        ${icon("search", 17)}
        <input class="search-input" id="feed-q" placeholder="Поиск: учебники, лампа, репетитор…" value="${esc(f.q)}">
      </div>
      <button class="filter-btn" id="btn-filters" title="Фильтры">
        ${icon("sliders", 20)}
        ${nFilters ? `<span class="badge">${nFilters}</span>` : ""}
      </button>
    </div>
    <div class="chips" id="feed-cats">
      ${cats.map((c) => `<button class="chip ${f.category === c.id ? "active" : ""}" data-cat="${c.id}">
        ${c.id ? icon(CATEGORY_ICON[c.id], 15) : ""}${c.name}</button>`).join("")}
    </div>
    ${subs.length ? `
      <div class="chips" id="feed-subcats">
        <button class="chip chip-sub ${!f.subcategory ? "active" : ""}" data-sub="">Все</button>
        ${subs.map((s) => `<button class="chip chip-sub ${f.subcategory === s.id ? "active" : ""}" data-sub="${s.id}">${s.name}</button>`).join("")}
      </div>` : ""}
    <div class="cards" id="feed-cards"><div class="empty">Загрузка…</div></div>`;

  $("#feed-q").addEventListener("input", debounce((e) => { f.q = e.target.value; loadFeed(); }, 400));
  $("#btn-filters").addEventListener("click", openFilterSheet);
  $("#feed-cats").querySelectorAll(".chip").forEach((ch) =>
    ch.addEventListener("click", () => {
      f.category = ch.dataset.cat;
      f.subcategory = "";
      renderFeed();
    }));
  const subRow = $("#feed-subcats");
  if (subRow) subRow.querySelectorAll(".chip").forEach((ch) =>
    ch.addEventListener("click", () => { f.subcategory = ch.dataset.sub; renderFeed(); }));

  await loadFeed();
}

async function loadFeed() {
  const box = $("#feed-cards");
  if (!box) return;
  try {
    const items = await API.listings({ kind: "offer", ...state.feed });
    box.innerHTML = items.length
      ? items.map(cardHTML).join("")
      : `<div class="empty"><div class="big">${icon("search", 40)}</div>Ничего не нашлось.<br>Попробуй изменить фильтры или создай запрос в разделе «Хочу».</div>`;
    bindCards(box);
  } catch (err) { box.innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* ---------- Фильтр-панель: категории с подкатегориями на одной странице ---------- */
function openFilterSheet() {
  const f = state.feed;
  const tmp = { ...f }; // черновик — применяется по кнопке «Показать»

  const catBlock = state.meta.categories.map((c) => {
    const subs = state.meta.subcategories[c.id] || [];
    return `
      <div class="fs-cat">
        <div class="fs-cat-name ${tmp.category === c.id && !tmp.subcategory ? "active" : ""}" data-fcat="${c.id}">
          ${icon(CATEGORY_ICON[c.id], 15)} ${c.name}
        </div>
        <div class="fs-chips">
          ${subs.map((s) => `<button class="chip chip-sub ${tmp.category === c.id && tmp.subcategory === s.id ? "active" : ""}"
            data-fcat="${c.id}" data-fsub="${s.id}">${s.name}</button>`).join("")}
        </div>
      </div>`;
  }).join("");

  const kmOptions = [["", "Любое"], ["1", "до 1 км"], ["3", "до 3 км"], ["5", "до 5 км"], ["10", "до 10 км"]];
  const sortOptions = [["new", "Сначала новые"], ["near", "Ближе ко мне"], ["popular", "Популярные"]];

  openModal(`
    <div class="fs-section">
      <div class="fs-title">${icon("sliders", 16)} Категории и подкатегории</div>
      ${catBlock}
    </div>
    <div class="fs-section">
      <div class="fs-title">${icon("tag", 16)} Тип сделки</div>
      <div class="fs-chips" id="fs-deals">
        <button class="chip ${!tmp.deal_type ? "active" : ""}" data-deal="">Любой</button>
        ${state.meta.deal_types.map((d) =>
          `<button class="chip ${tmp.deal_type === d.id ? "active" : ""}" data-deal="${d.id}">${d.name}</button>`).join("")}
      </div>
    </div>
    <div class="fs-section">
      <div class="fs-title">${icon("globe", 16)} Формат</div>
      <div class="fs-chips" id="fs-formats">
        <button class="chip ${!tmp.format ? "active" : ""}" data-format="">Любой</button>
        ${state.meta.formats.map((fm) =>
          `<button class="chip ${tmp.format === fm.id ? "active" : ""}" data-format="${fm.id}">${fm.name}</button>`).join("")}
      </div>
    </div>
    <div class="fs-section">
      <div class="fs-title">${icon("pin", 16)} Расстояние</div>
      <div class="fs-chips" id="fs-km">
        ${kmOptions.map(([v, n]) =>
          `<button class="chip ${tmp.max_km === v ? "active" : ""}" data-km="${v}">${n}</button>`).join("")}
      </div>
    </div>
    <div class="fs-section">
      <div class="fs-title">${icon("gradcap", 16)} Вуз или колледж</div>
      <div class="uni-search">
        <div class="search-wrap">
          ${icon("search", 15)}
          <input class="search-input" id="fs-uni-q" placeholder="Найти: ИТМО, Политех, Петровский…">
        </div>
      </div>
      <div class="uni-list" id="fs-uni-list"></div>
    </div>
    <div class="fs-section">
      <div class="fs-title">${icon("clock", 16)} Сортировка</div>
      <div class="fs-chips" id="fs-sort">
        ${sortOptions.map(([v, n]) =>
          `<button class="chip ${tmp.sort === v ? "active" : ""}" data-sort="${v}">${n}</button>`).join("")}
      </div>
    </div>
    <div class="fs-actions">
      <button class="btn btn-secondary" id="fs-reset">Сбросить</button>
      <button class="btn" id="fs-apply">Показать</button>
    </div>`);

  const sheet = $("#modal-content");

  // Категории и подкатегории
  const syncCats = () => {
    sheet.querySelectorAll(".fs-cat-name").forEach((el) =>
      el.classList.toggle("active", tmp.category === el.dataset.fcat && !tmp.subcategory));
    sheet.querySelectorAll("[data-fsub]").forEach((el) =>
      el.classList.toggle("active", tmp.category === el.dataset.fcat && tmp.subcategory === el.dataset.fsub));
  };
  sheet.querySelectorAll(".fs-cat-name").forEach((el) =>
    el.addEventListener("click", () => {
      if (tmp.category === el.dataset.fcat && !tmp.subcategory) tmp.category = "";
      else { tmp.category = el.dataset.fcat; tmp.subcategory = ""; }
      syncCats();
    }));
  sheet.querySelectorAll("[data-fsub]").forEach((el) =>
    el.addEventListener("click", () => {
      if (tmp.category === el.dataset.fcat && tmp.subcategory === el.dataset.fsub) {
        tmp.subcategory = "";
      } else {
        tmp.category = el.dataset.fcat;
        tmp.subcategory = el.dataset.fsub;
      }
      syncCats();
    }));

  // Одиночные группы чипов
  const bindChipGroup = (rootSel, dataKey, field) => {
    sheet.querySelectorAll(`${rootSel} .chip`).forEach((el) =>
      el.addEventListener("click", () => {
        tmp[field] = el.dataset[dataKey];
        sheet.querySelectorAll(`${rootSel} .chip`).forEach((x) =>
          x.classList.toggle("active", x === el));
      }));
  };
  bindChipGroup("#fs-deals", "deal", "deal_type");
  bindChipGroup("#fs-formats", "format", "format");
  bindChipGroup("#fs-km", "km", "max_km");
  bindChipGroup("#fs-sort", "sort", "sort");

  // Вузы и колледжи с поиском
  const renderUniList = (q = "") => {
    const list = $("#fs-uni-list");
    const needle = q.trim().toLowerCase();
    const match = (u) => !needle || u.name.toLowerCase().includes(needle)
      || u.short_name.toLowerCase().includes(needle);
    const unis = state.meta.universities.filter((u) => !u.is_college && match(u));
    const colleges = state.meta.universities.filter((u) => u.is_college && match(u));
    const item = (u) => `
      <div class="uni-item ${String(tmp.university_id) === String(u.id) ? "active" : ""}" data-uni="${u.id}">
        <span>${esc(u.short_name)}</span>
        ${String(tmp.university_id) === String(u.id) ? icon("check", 16) : ""}
      </div>`;
    list.innerHTML = `
      <div class="uni-item ${!tmp.university_id ? "active" : ""}" data-uni="">
        <span>Все учебные заведения</span>${!tmp.university_id ? icon("check", 16) : ""}
      </div>
      ${unis.length ? `<div class="uni-group">Вузы</div>${unis.map(item).join("")}` : ""}
      ${colleges.length ? `<div class="uni-group">Колледжи</div>${colleges.map(item).join("")}` : ""}
      ${!unis.length && !colleges.length ? `<div class="uni-item">Ничего не найдено</div>` : ""}`;
    list.querySelectorAll("[data-uni]").forEach((el) =>
      el.addEventListener("click", () => {
        tmp.university_id = el.dataset.uni;
        renderUniList($("#fs-uni-q").value);
      }));
  };
  renderUniList();
  $("#fs-uni-q").addEventListener("input", debounce((e) => renderUniList(e.target.value), 200));

  $("#fs-reset").addEventListener("click", () => {
    Object.assign(state.feed, {
      category: "", subcategory: "", deal_type: "", format: "",
      university_id: "", max_km: "", sort: "new",
    });
    closeModal();
    renderFeed();
  });
  $("#fs-apply").addEventListener("click", () => {
    Object.assign(state.feed, tmp);
    closeModal();
    haptic();
    renderFeed();
  });
}

/* ---------- Раздел «Хочу» ---------- */
async function renderWants() {
  view().innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <div>
        <b>${icon("sparkle", 16)} Хочу</b>
        <div style="font-size:12px;color:var(--hint)">Запросы студентов: кто что ищет</div>
      </div>
      <button class="btn btn-sm" id="btn-add-want">${icon("plus", 14)} Запрос</button>
    </div>
    <div class="cards" id="wants-cards"><div class="empty">Загрузка…</div></div>`;
  $("#btn-add-want").addEventListener("click", () => renderAdd("want"));
  try {
    const items = await API.listings({ kind: "want" });
    const box = $("#wants-cards");
    box.innerHTML = items.length
      ? items.map(cardHTML).join("")
      : `<div class="empty"><div class="big">${icon("sparkle", 40)}</div>Пока нет запросов. Создай первый!</div>`;
    bindCards(box);
  } catch (err) { $("#wants-cards").innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
}

/* ---------- Карта (Яндекс Карты) ---------- */
function loadYandexMaps() {
  return new Promise((resolve, reject) => {
    if (window.ymaps) return window.ymaps.ready(() => resolve(window.ymaps));
    const s = document.createElement("script");
    s.src = "https://api-maps.yandex.ru/2.1/?lang=ru_RU"
      + (YMAPS_API_KEY ? "&apikey=" + YMAPS_API_KEY : "");
    s.onload = () => window.ymaps.ready(() => resolve(window.ymaps));
    s.onerror = () => reject(new Error("Не удалось загрузить Яндекс Карты"));
    document.head.appendChild(s);
  });
}

async function renderMap() {
  view().innerHTML = `
    <div class="map-hint">${icon("pin", 14)} Кампусы и объявления рядом. Нажми на метку.</div>
    <div id="map-container"><div class="empty">Загрузка карты…</div></div>`;

  let ymaps;
  try {
    ymaps = await loadYandexMaps();
  } catch (err) {
    $("#map-container").innerHTML = `<div class="empty">Не удалось загрузить карту.<br>Проверьте подключение к интернету и попробуйте ещё раз.</div>`;
    return;
  }
  if (state.view !== "map" || !$("#map-container")) return;

  $("#map-container").innerHTML = "";
  const center = (state.me && state.me.lat)
    ? [state.me.lat, state.me.lon] : [59.9500, 30.3167]; // центр СПб
  const map = new ymaps.Map("map-container", {
    center, zoom: 12,
    controls: ["zoomControl", "geolocationControl"],
  }, { suppressMapOpenBlock: true });
  state.ymap = map;

  // Метки учебных заведений
  state.meta.universities.forEach((u) => {
    map.geoObjects.add(new ymaps.Placemark(
      [u.lat, u.lon],
      { hintContent: u.short_name, balloonContent: `<b>${esc(u.name)}</b>` },
      { preset: u.is_college ? "islands#darkOrangeEducationIcon" : "islands#brownEducationIcon" },
    ));
  });

  // Метки объявлений
  try {
    const items = await API.listings({ kind: "offer", limit: 100 });
    items.filter((l) => l.lat != null).forEach((l) => {
      map.geoObjects.add(new ymaps.Placemark(
        [l.lat, l.lon],
        {
          hintContent: esc(l.title),
          balloonContentHeader: esc(l.title),
          balloonContentBody: `<div class="map-balloon">${priceLabel(l)}<br>
            <a href="#" onclick="openListing(${l.id});return false">Открыть объявление →</a></div>`,
        },
        { preset: "islands#orangeDotIcon" },
      ));
    });
  } catch (err) { toast(err.message); }
}

/* ---------- Публикация ---------- */
function renderAdd(kind = "offer") {
  setActiveNav("add");
  const isWant = kind === "want";

  const subSelect = (cat) => {
    const subs = state.meta.subcategories[cat] || [];
    return subs.map((s) => `<option value="${s.id}">${s.name}</option>`).join("");
  };
  const firstCat = state.meta.categories[0].id;

  view().innerHTML = `
    <div class="section-title">${icon(isWant ? "sparkle" : "plus", 17)} ${isWant ? "Новый запрос" : "Новое объявление"}</div>
    <div class="segmented" style="margin-bottom:12px">
      <button id="seg-offer" class="${!isWant ? "active" : ""}">Предлагаю</button>
      <button id="seg-want" class="${isWant ? "active" : ""}">Ищу (Хочу)</button>
    </div>
    <form class="form" id="add-form">
      <label>Название *</label>
      <input name="title" required minlength="3" maxlength="200"
        placeholder="${isWant ? "Например: Ищу велосипед на лето" : "Например: Учебник по матанализу"}">
      <label>Категория *</label>
      <select name="category" id="cat-select" required>
        ${state.meta.categories.map((c) => `<option value="${c.id}">${c.name}</option>`).join("")}
      </select>
      <label>Подкатегория</label>
      <select name="subcategory" id="subcat-select">${subSelect(firstCat)}</select>
      <label>Тип сделки</label>
      <select name="deal_type" id="deal-select">
        ${state.meta.deal_types.map((d) => `<option value="${d.id}">${d.name}</option>`).join("")}
      </select>
      <label>Формат</label>
      <div class="segmented" id="format-seg">
        <button type="button" data-fmt="offline" class="active">Офлайн</button>
        <button type="button" data-fmt="online">Онлайн</button>
      </div>
      <div id="price-row" class="hidden">
        <label>Цена, ₽</label>
        <input name="price" type="number" min="0" placeholder="500">
      </div>
      <div id="exchange-row">
        <label>Что хочешь взамен?</label>
        <input name="exchange_for" maxlength="300" placeholder="Например: конспекты, шоколадка, помощь с кодом">
      </div>
      <label>Описание</label>
      <textarea name="description" maxlength="4000" placeholder="Состояние, условия встречи, детали…"></textarea>
      <label>Вуз / колледж</label>
      <select name="university_id">
        <option value="">Не указывать</option>
        <optgroup label="Вузы">
          ${state.meta.universities.filter((u) => !u.is_college).map((u) =>
            `<option value="${u.id}" ${state.me && state.me.university && state.me.university.id === u.id ? "selected" : ""}>${esc(u.short_name)}</option>`).join("")}
        </optgroup>
        <optgroup label="Колледжи">
          ${state.meta.universities.filter((u) => u.is_college).map((u) =>
            `<option value="${u.id}" ${state.me && state.me.university && state.me.university.id === u.id ? "selected" : ""}>${esc(u.short_name)}</option>`).join("")}
        </optgroup>
      </select>
      <button class="btn" type="submit">${icon("check", 17)} Опубликовать</button>
    </form>`;

  $("#seg-offer").addEventListener("click", () => renderAdd("offer"));
  $("#seg-want").addEventListener("click", () => renderAdd("want"));

  $("#cat-select").addEventListener("change", (e) => {
    $("#subcat-select").innerHTML = subSelect(e.target.value);
  });

  let format = "offline";
  $("#format-seg").querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => {
      format = b.dataset.fmt;
      $("#format-seg").querySelectorAll("button").forEach((x) =>
        x.classList.toggle("active", x === b));
    }));

  const dealSelect = $("#deal-select");
  const syncDeal = () => {
    $("#price-row").classList.toggle("hidden", !["sell", "service"].includes(dealSelect.value));
    $("#exchange-row").classList.toggle("hidden", dealSelect.value !== "exchange");
  };
  dealSelect.addEventListener("change", syncDeal);
  syncDeal();

  $("#add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const uniId = fd.get("university_id");
    const uni = state.meta.universities.find((u) => String(u.id) === String(uniId));
    const data = {
      kind,
      title: fd.get("title").trim(),
      description: fd.get("description").trim(),
      category: fd.get("category"),
      subcategory: fd.get("subcategory") || null,
      deal_type: fd.get("deal_type"),
      format,
      price: fd.get("price") ? Number(fd.get("price")) : null,
      exchange_for: fd.get("exchange_for") ? fd.get("exchange_for").trim() : null,
      university_id: uniId ? Number(uniId) : null,
      lat: uni ? uni.lat : null,
      lon: uni ? uni.lon : null,
    };
    try {
      const listing = await API.createListing(data);
      haptic();
      if (kind === "offer") {
        openPhotoUpload(listing);
      } else {
        toast("Запрос опубликован! Сообщим, когда появится подходящее");
        switchView("wants");
      }
    } catch (err) {
      if (String(err.message).includes("одно объявление")) openVerifyRequired(err.message);
      else toast(err.message);
    }
  });
}

/* Лимит для неподтверждённых: одно объявление -> принуждаем к верификации */
function openVerifyRequired(message) {
  openModal(`
    <div class="section-title">${icon("checkbadge", 17)} Нужно подтверждение</div>
    <div style="line-height:1.5;margin-bottom:14px">${esc(message)}</div>
    <div class="detail-actions">
      <button class="btn" id="vr-go">${icon("mail", 16)} Подтвердить почту вуза</button>
      <button class="btn btn-secondary" id="vr-later">Позже</button>
    </div>`);
  $("#vr-go").addEventListener("click", openVerification);
  $("#vr-later").addEventListener("click", closeModal);
}

function openPhotoUpload(listing, isNew = true) {
  const existing = (listing.photo_urls || [])
    .map((url) => `<img src="${url}">`).join("");
  openModal(`
    <div class="section-title">${icon("camera", 17)} ${isNew ? "Добавь фото (до 10)" : "Фото объявления (до 10)"}</div>
    <div class="photo-grid" id="photo-grid">
      ${existing}
      <button class="photo-add" id="photo-add-btn">${icon("plus", 22)}</button>
    </div>
    <input type="file" id="photo-input" accept="image/jpeg,image/png,image/webp" multiple class="hidden">
    <div style="height:14px"></div>
    <button class="btn" id="photo-done">${icon("check", 17)} Готово</button>`);

  $("#photo-add-btn").addEventListener("click", () => $("#photo-input").click());
  $("#photo-input").addEventListener("change", async (e) => {
    for (const file of e.target.files) {
      try {
        const updated = await API.uploadPhoto(listing.id, file);
        const grid = $("#photo-grid");
        grid.querySelectorAll("img").forEach((i) => i.remove());
        updated.photo_urls.forEach((url) => {
          const img = document.createElement("img");
          img.src = url;
          grid.insertBefore(img, $("#photo-add-btn"));
        });
      } catch (err) { toast(err.message); }
    }
  });
  $("#photo-done").addEventListener("click", () => {
    closeModal();
    toast(isNew ? "Объявление опубликовано!" : "Фото обновлены");
    switchView(isNew ? "feed" : state.view);
  });
}

/* ---------- Детали объявления ---------- */
async function openListing(id) {
  haptic();
  let l;
  try { l = await API.listing(id); } catch (err) { return toast(err.message); }
  const isMine = state.me && l.owner.id === state.me.id;
  const contactUrl = l.owner.username ? `https://t.me/${l.owner.username}` : null;
  const sub = subcatName(l);
  const fmt = (state.meta.formats.find((x) => x.id === l.format) || {}).name || "";

  openModal(`
    ${l.photo_urls.length ? `<div class="detail-photos">${l.photo_urls.map((u) => `<img src="${u}">`).join("")}</div>` : ""}
    <div class="detail-title">${esc(l.title)}</div>
    <div style="margin-bottom:8px">
      <span class="tag">${icon(CATEGORY_ICON[l.category], 13)} ${(state.meta.categories.find((c) => c.id === l.category) || {}).name || ""}${sub ? " · " + esc(sub) : ""}</span>
      ${fmt ? `<span class="tag">${icon(l.format === "online" ? "globe" : "pin", 13)} ${fmt}</span>` : ""}
    </div>
    <div class="detail-price">${priceLabel(l)}</div>
    ${l.description ? `<div class="detail-desc">${esc(l.description)}</div>` : ""}
    <div class="detail-meta">
      ${l.university ? `<span>${icon("gradcap", 14)} ${esc(l.university.name)}</span>` : ""}
      ${l.distance_km != null ? `<span>${icon("pin", 14)} ${l.distance_km < 1 ? Math.round(l.distance_km * 1000) + " м" : l.distance_km + " км"} от вашего учебного заведения</span>` : ""}
      <span>${icon("eye", 14)} ${l.views} просмотров · ${timeAgo(l.created_at)}</span>
      ${l.status === "closed" ? `<span>${icon("check", 14)} Сделка завершена</span>` : ""}
    </div>
    <div class="detail-owner">
      <div class="avatar">${esc((l.owner.first_name || "?")[0])}</div>
      <div style="flex:1">
        <div><b>${esc(l.owner.first_name)}</b>
          ${l.owner.is_verified ? `<span class="verified">${icon("checkbadge", 14)} Студент подтверждён</span>` : ""}</div>
        <div style="font-size:13px;color:var(--hint)">
          ${starsInline(Math.round(l.owner.rating) || 1)} ${l.owner.rating || "—"}
          (${l.owner.rating_count} отзывов) · ${l.owner.points} баллов
        </div>
      </div>
    </div>
    <div class="detail-actions">
      ${!isMine && contactUrl ? `<button class="btn" id="btn-contact">${icon("send", 17)} Написать в Telegram</button>` : ""}
      ${!isMine && !contactUrl ? `<div class="empty" style="padding:8px">У автора скрыт username — свяжись через отзывы</div>` : ""}
      ${!isMine ? `<button class="btn btn-secondary" id="btn-review">${icon("star", 16)} Сделка состоялась — оставить отзыв</button>` : ""}
      ${isMine && l.status === "active" ? `<button class="btn btn-secondary" id="btn-add-photos">${icon("camera", 16)} Добавить фото</button>` : ""}
      ${isMine && l.status === "active" ? `<button class="btn btn-secondary" id="btn-close-listing">${icon("check", 16)} Завершить (закрыть объявление)</button>` : ""}
      ${isMine ? `<button class="btn btn-danger" id="btn-delete-listing">${icon("trash", 16)} Удалить</button>` : ""}
      ${!isMine && adminToken() ? `<button class="btn btn-danger" id="btn-admin-delete">${icon("shield", 16)} Удалить как администратор</button>` : ""}
    </div>`);

  const adminDelBtn = $("#btn-admin-delete");
  if (adminDelBtn) adminDelBtn.addEventListener("click", async () => {
    const doDelete = async () => {
      try {
        await API.adminDeleteListing(l.id);
        closeModal();
        toast("Объявление удалено администратором");
        switchView(state.view);
      } catch (err) { toast(err.message); }
    };
    if (IS_TELEGRAM && tg.showConfirm) tg.showConfirm("Удалить чужое объявление?", (ok) => ok && doDelete());
    else if (confirm("Удалить чужое объявление?")) doDelete();
  });

  const contactBtn = $("#btn-contact");
  if (contactBtn) contactBtn.addEventListener("click", () => {
    if (IS_TELEGRAM) tg.openTelegramLink(contactUrl);
    else window.open(contactUrl, "_blank");
  });

  const reviewBtn = $("#btn-review");
  if (reviewBtn) reviewBtn.addEventListener("click", () => openReviewForm(l));

  const addPhotosBtn = $("#btn-add-photos");
  if (addPhotosBtn) addPhotosBtn.addEventListener("click", () => openPhotoUpload(l, false));

  const closeBtn = $("#btn-close-listing");
  if (closeBtn) closeBtn.addEventListener("click", async () => {
    try { await API.closeListing(l.id); closeModal(); toast("Объявление закрыто"); switchView(state.view); }
    catch (err) { toast(err.message); }
  });

  const delBtn = $("#btn-delete-listing");
  if (delBtn) delBtn.addEventListener("click", async () => {
    const doDelete = async () => {
      try { await API.deleteListing(l.id); closeModal(); toast("Удалено"); switchView(state.view); }
      catch (err) { toast(err.message); }
    };
    if (IS_TELEGRAM && tg.showConfirm) tg.showConfirm("Удалить объявление?", (ok) => ok && doDelete());
    else if (confirm("Удалить объявление?")) doDelete();
  });
}

/* ---------- Отзыв ---------- */
function openReviewForm(listing) {
  let rating = 5;
  openModal(`
    <div class="section-title">${icon("star", 17)} Отзыв о сделке</div>
    <div style="font-size:14px;color:var(--hint)">«${esc(listing.title)}» — ${esc(listing.owner.first_name)}</div>
    <div class="stars" id="stars">
      ${[1, 2, 3, 4, 5].map((i) => `<button type="button" data-star="${i}" class="on">${icon("star", 28)}</button>`).join("")}
    </div>
    <form class="form" id="review-form">
      <textarea name="text" maxlength="1000" placeholder="Как прошла сделка? Это увидят другие студенты."></textarea>
      <button class="btn" type="submit">${icon("send", 16)} Отправить отзыв</button>
    </form>`);

  $("#stars").querySelectorAll("button").forEach((s) => {
    s.addEventListener("click", () => {
      rating = Number(s.dataset.star);
      $("#stars").querySelectorAll("button").forEach((x) =>
        x.classList.toggle("on", Number(x.dataset.star) <= rating));
    });
  });

  $("#review-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await API.createReview({ listing_id: listing.id, rating, text: new FormData(e.target).get("text").trim() });
      closeModal();
      haptic();
      toast("Спасибо! Рейтинг обновлён, вам начислены баллы");
    } catch (err) { toast(err.message); }
  });
}

/* ---------- Профиль ---------- */
async function renderProfile() {
  let me;
  try { me = state.me = await API.me(); } catch (err) { return view().innerHTML = `<div class="empty">${esc(err.message)}</div>`; }

  const [mine, favs, reviews] = await Promise.all([
    API.myListings().catch(() => []),
    API.favorites().catch(() => []),
    API.userReviews(me.id).catch(() => []),
  ]);

  const avatar = me.photo_url
    ? `<img class="avatar" src="${me.photo_url}">`
    : `<div class="avatar">${esc((me.first_name || "?")[0])}</div>`;

  view().innerHTML = `
    <div class="profile-head">
      ${avatar}
      <div style="flex:1">
        <div class="profile-name">${esc(me.first_name)}
          ${me.is_verified ? `<span class="verified">${icon("checkbadge", 15)}</span>` : ""}</div>
        <div class="profile-sub">
          ${me.university ? esc(me.university.short_name) : "Учебное заведение не указано"}
          ${me.username ? " · @" + esc(me.username) : ""}
        </div>
        <div class="profile-sub" id="verify-line" style="cursor:pointer">${me.is_verified
          ? `<span class="verified">Студент подтверждён</span>`
          : "Почта вуза не подтверждена"}</div>
      </div>
    </div>
    <div class="stat-row">
      <div class="stat"><div class="num">${icon("star", 15)} ${me.rating || "—"}</div><div class="lbl">${me.rating_count} отзывов</div></div>
      <div class="stat"><div class="num">${me.points}</div><div class="lbl">баллов доверия</div></div>
      <div class="stat"><div class="num">${mine.filter((l) => l.status === "active").length}</div><div class="lbl">активных</div></div>
    </div>
    ${!me.is_verified ? `<button class="btn" id="btn-verify" style="width:100%;margin-bottom:10px">${icon("checkbadge", 17)} Подтвердить статус студента</button>` : ""}
    <button class="btn btn-secondary" id="btn-edit-uni" style="width:100%">${icon("gradcap", 17)} ${me.university ? "Сменить учебное заведение" : "Указать учебное заведение"}</button>
    <button class="btn btn-secondary" id="btn-donate" style="width:100%;margin-top:8px">${icon("heart", 17)} Поддержать разработчика</button>

    <div class="section-title">${icon("edit", 16)} Мои объявления (${mine.length})</div>
    <div class="cards" id="my-cards">${mine.length ? mine.map(cardHTML).join("") : '<div class="empty">Пока нет объявлений</div>'}</div>

    <div class="section-title">${icon("heart", 16)} Избранное (${favs.length})</div>
    <div class="cards" id="fav-cards">${favs.length ? favs.map(cardHTML).join("") : '<div class="empty">Отмечай сердечком понравившиеся объявления</div>'}</div>

    <div class="section-title">${icon("message", 16)} Отзывы обо мне (${reviews.length})</div>
    ${reviews.length ? reviews.map((r) => `
      <div class="review-item">
        <div class="review-head">
          <b>${esc(r.author.first_name)}</b>
          <span>${starsInline(r.rating)} · ${timeAgo(r.created_at)}</span>
        </div>
        <div>${esc(r.text) || "<i>Без комментария</i>"}</div>
      </div>`).join("") : '<div class="empty">Отзывов пока нет — соверши первую сделку!</div>'}

    ${adminToken() ? `
    <div style="margin-top:24px">
      <button class="btn btn-secondary" id="btn-admin-panel" style="width:100%">${icon("shield", 16)} Админ-панель</button>
      <button class="btn btn-secondary" id="btn-admin-logout" style="width:100%;margin-top:8px">Выйти из админ-режима</button>
    </div>` : ""}

    <div class="legal-links">
      <a href="#" id="link-terms">Пользовательское соглашение</a>
      <span>·</span>
      <a href="#" id="link-privacy">Политика конфиденциальности</a>
    </div>`;

  bindCards($("#my-cards"));
  bindCards($("#fav-cards"));

  const verifyBtn = $("#btn-verify");
  if (verifyBtn) verifyBtn.addEventListener("click", openVerification);
  $("#btn-edit-uni").addEventListener("click", openUniversityPicker);
  $("#btn-donate").addEventListener("click", () => {
    // Донаты через Tribute: в Telegram открываем мини-апп, в браузере — веб-версию
    if (IS_TELEGRAM) tg.openTelegramLink("https://t.me/tribute/app?startapp=dNb8");
    else window.open("https://web.tribute.tg/d/Nb8", "_blank");
  });

  $("#verify-line").addEventListener("click", openVerification);
  $("#link-terms").addEventListener("click", (e) => {
    e.preventDefault();
    openLegalDoc("Пользовательское соглашение", "legal/terms.txt");
  });
  $("#link-privacy").addEventListener("click", (e) => {
    e.preventDefault();
    openLegalDoc("Политика конфиденциальности", "legal/privacy.txt");
  });
  const adminPanelBtn = $("#btn-admin-panel");
  if (adminPanelBtn) adminPanelBtn.addEventListener("click", openAdminPanel);
  const adminLogoutBtn = $("#btn-admin-logout");
  if (adminLogoutBtn) adminLogoutBtn.addEventListener("click", () => {
    localStorage.removeItem("adminToken");
    toast("Вы вышли из админ-режима");
    renderProfile();
  });
}

/* ---------- Юридические документы ---------- */
async function openLegalDoc(title, path, onBack) {
  openModal(`
    ${onBack ? `<button class="btn btn-secondary btn-sm" id="legal-back" style="margin-bottom:12px">← Назад</button>` : ""}
    <div class="section-title">${icon("book", 17)} ${esc(title)}</div>
    <div class="legal-text" id="legal-text">Загрузка…</div>`);
  if (onBack) $("#legal-back").addEventListener("click", onBack);
  try {
    const resp = await fetch(path, { cache: "no-cache" });
    const text = await resp.text();
    $("#legal-text").textContent = text;
  } catch (e) {
    $("#legal-text").textContent = "Не удалось загрузить документ. Попробуйте позже.";
  }
}

/* ---------- Админ ---------- */
/* Отдельной кнопки входа нет: администратор вводит свой email в форме
   «Подтвердить статус студента», и она переключается на запрос пароля. */
function openAdminPasswordForm(email) {
  openModal(`
    <div class="section-title">${icon("shield", 17)} Режим администратора</div>
    <div style="font-size:14px;color:var(--hint);margin-bottom:12px">${esc(email)}</div>
    <form class="form" id="admin-login-form">
      <input name="password" type="password" required placeholder="Пароль администратора" autofocus>
      <button class="btn" type="submit">${icon("check", 16)} Войти</button>
    </form>`);
  $("#admin-login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const r = await API.adminLogin(email, new FormData(e.target).get("password"));
      localStorage.setItem("adminToken", r.token);
      closeModal();
      haptic();
      toast("Вы вошли как администратор");
      renderProfile();
    } catch (err) { toast(err.message); }
  });
}

async function openAdminPanel() {
  openModal(`
    <div class="section-title">${icon("shield", 17)} Пользователи</div>
    <div class="uni-search">
      <div class="search-wrap">
        ${icon("search", 15)}
        <input class="search-input" id="admin-q" placeholder="Поиск по имени или @username">
      </div>
    </div>
    <div id="admin-users"><div class="empty">Загрузка…</div></div>
    <div style="font-size:12px;color:var(--hint);margin-top:10px">
      Удаление объявлений: открой любое объявление — внизу появится кнопка
      «Удалить как администратор».
    </div>`);

  const load = async (q = "") => {
    const box = $("#admin-users");
    if (!box) return;
    let users;
    try {
      users = await API.adminUsers(q);
    } catch (err) {
      if (String(err.message).includes("администратора")) {
        localStorage.removeItem("adminToken");
        closeModal();
        toast("Сессия администратора истекла — введите свой email в форме верификации");
        return openVerification();
      }
      box.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
      return;
    }
    box.innerHTML = users.length ? users.map((u) => `
      <div class="uni-item" style="cursor:default">
        <div style="flex:1;min-width:0">
          <div><b>${esc(u.first_name)}</b>
            ${u.username ? `<span style="color:var(--hint)">@${esc(u.username)}</span>` : ""}
            ${u.is_verified ? `<span class="verified">${icon("checkbadge", 12)}</span>` : ""}
            ${u.is_banned ? `<span style="color:var(--danger);font-weight:600">заблокирован</span>` : ""}
          </div>
          <div style="font-size:12px;color:var(--hint)">
            id ${u.id} · tg ${u.tg_id} · объявлений: ${u.listings_count} · баллов: ${u.points}
          </div>
        </div>
        <button class="btn btn-sm ${u.is_banned ? "btn-secondary" : "btn-danger"}" data-ban="${u.id}" data-banned="${u.is_banned ? 1 : 0}">
          ${u.is_banned ? "Разбанить" : `${icon("ban", 13)} Бан`}
        </button>
      </div>`).join("") : '<div class="empty">Никого не найдено</div>';

    box.querySelectorAll("[data-ban]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const id = Number(btn.dataset.ban);
        const banned = btn.dataset.banned === "1";
        try {
          if (banned) await API.adminUnban(id);
          else await API.adminBan(id);
          haptic();
          toast(banned ? "Пользователь разбанен" : "Пользователь заблокирован");
          load($("#admin-q") ? $("#admin-q").value : "");
        } catch (err) { toast(err.message); }
      }));
  };
  load();
  $("#admin-q").addEventListener("input", debounce((e) => load(e.target.value), 300));
}

function openUniversityPicker() {
  openModal(`
    <div class="section-title">${icon("gradcap", 17)} Твоё учебное заведение</div>
    <div class="uni-search">
      <div class="search-wrap">
        ${icon("search", 15)}
        <input class="search-input" id="up-q" placeholder="Найти: ИТМО, Политех, Петровский…">
      </div>
    </div>
    <div class="uni-list" id="up-list" style="max-height:300px"></div>
    <form class="form" id="uni-form" style="margin-top:12px">
      <label>Факультет (необязательно)</label>
      <input name="faculty" maxlength="128" value="${esc(state.me.faculty || "")}" placeholder="Например: ФИТиП">
      <button class="btn" type="submit">${icon("check", 16)} Сохранить</button>
    </form>`);

  let selected = state.me.university ? state.me.university.id : "";

  const renderList = (q = "") => {
    const list = $("#up-list");
    const needle = q.trim().toLowerCase();
    const match = (u) => !needle || u.name.toLowerCase().includes(needle)
      || u.short_name.toLowerCase().includes(needle);
    const unis = state.meta.universities.filter((u) => !u.is_college && match(u));
    const colleges = state.meta.universities.filter((u) => u.is_college && match(u));
    const item = (u) => `
      <div class="uni-item ${String(selected) === String(u.id) ? "active" : ""}" data-uni="${u.id}">
        <span>${esc(u.name)}</span>
        ${String(selected) === String(u.id) ? icon("check", 16) : ""}
      </div>`;
    list.innerHTML = `
      <div class="uni-item ${!selected ? "active" : ""}" data-uni="">
        <span>Не указывать</span>${!selected ? icon("check", 16) : ""}
      </div>
      ${unis.length ? `<div class="uni-group">Вузы</div>${unis.map(item).join("")}` : ""}
      ${colleges.length ? `<div class="uni-group">Колледжи</div>${colleges.map(item).join("")}` : ""}`;
    list.querySelectorAll("[data-uni]").forEach((el) =>
      el.addEventListener("click", () => {
        selected = el.dataset.uni;
        renderList($("#up-q").value);
      }));
  };
  renderList();
  $("#up-q").addEventListener("input", debounce((e) => renderList(e.target.value), 200));

  $("#uni-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const uni = state.meta.universities.find((u) => String(u.id) === String(selected));
    try {
      state.me = await API.updateMe({
        university_id: selected ? Number(selected) : null,
        faculty: new FormData(e.target).get("faculty").trim() || null,
        lat: uni ? uni.lat : null,
        lon: uni ? uni.lon : null,
      });
      closeModal();
      toast("Сохранено");
      renderProfile();
    } catch (err) { toast(err.message); }
  });
}

function openVerification() {
  openModal(`
    <div class="section-title">${icon("checkbadge", 17)} Верификация студента</div>
    <div style="font-size:14px;color:var(--hint);margin-bottom:12px">
      Укажи почту своего вуза — пришлём код. После подтверждения получишь значок
      «Студент подтверждён», и тебе будут больше доверять.
    </div>
    <form class="form" id="verify-form">
      <input name="email" type="email" required placeholder="ivanov@itmo.ru">
      <button class="btn" type="submit">${icon("mail", 16)} Получить код</button>
    </form>
    <form class="form hidden" id="confirm-form" style="margin-top:12px">
      <input name="code" required maxlength="6" inputmode="numeric" placeholder="Код из письма">
      <button class="btn" type="submit">${icon("check", 16)} Подтвердить</button>
    </form>`);

  $("#verify-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = new FormData(e.target).get("email").trim();
    try {
      const r = await API.verifyRequest(email);
      if (r.admin) return openAdminPasswordForm(email); // скрытый вход администратора
      toast(r.message);
      $("#confirm-form").classList.remove("hidden");
    } catch (err) { toast(err.message); }
  });
  $("#confirm-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      state.me = await API.verifyConfirm(new FormData(e.target).get("code").trim());
      closeModal();
      haptic();
      toast("Готово! Ты подтверждённый студент");
      renderProfile();
    } catch (err) { toast(err.message); }
  });
}

/* ---------- Уведомления ---------- */
async function openNotifications() {
  let items = [];
  try { items = await API.notifications(); } catch (err) { return toast(err.message); }
  openModal(`
    <div class="section-title">${icon("bell", 17)} Уведомления</div>
    ${items.length ? items.map((n) => `
      <div class="notif-item ${n.is_read ? "" : "unread"}" ${n.listing_id ? `data-listing="${n.listing_id}"` : ""}>
        <div style="flex:1">
          <div>${esc(n.text)}</div>
          <div class="notif-time">${timeAgo(n.created_at)}</div>
        </div>
      </div>`).join("") : `<div class="empty"><div class="big">${icon("bell", 38)}</div>Уведомлений пока нет</div>`}`);

  document.querySelectorAll(".notif-item[data-listing]").forEach((el) =>
    el.addEventListener("click", () => openListing(Number(el.dataset.listing))));

  if (items.some((n) => !n.is_read)) {
    await API.markNotificationsRead().catch(() => {});
    updateNotifBadge(0);
  }
}

let lastUnreadCount = 0;

function updateNotifBadge(count) {
  const badge = $("#notif-badge");
  const btn = $("#btn-notifications");
  badge.textContent = count;
  badge.classList.toggle("hidden", !count);
  btn.classList.toggle("has-unread", count > 0);
  // Иконка меняется: колокольчик с красной точкой при непрочитанных
  $("#bell-icon").innerHTML = icon(count > 0 ? "belldot" : "bell", 22);
  if (count > lastUnreadCount) {
    // Пришло новое — колокольчик «звенит»
    btn.classList.remove("ring");
    void btn.offsetWidth; // перезапуск CSS-анимации
    btn.classList.add("ring");
    haptic();
  }
  lastUnreadCount = count;
}

/* Фоновая проверка новых уведомлений */
function startNotifPolling() {
  setInterval(async () => {
    if (document.hidden) return;
    try {
      const r = await API.notifCount();
      updateNotifBadge(r.unread);
    } catch (e) { /* сеть моргнула — попробуем в следующий раз */ }
  }, 30000);
}

/* ---------- Навигация ---------- */
function setActiveNav(name) {
  document.querySelectorAll(".nav-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === name));
}

function switchView(name) {
  if (state.ymap) {
    try { state.ymap.destroy(); } catch (e) { /* карта уже уничтожена */ }
    state.ymap = null;
  }
  state.view = name;
  setActiveNav(name);
  closeModal();
  if (name === "feed") renderFeed();
  else if (name === "map") renderMap();
  else if (name === "add") renderAdd("offer");
  else if (name === "wants") renderWants();
  else if (name === "profile") renderProfile();
}

document.querySelectorAll(".nav-btn").forEach((btn) =>
  btn.addEventListener("click", () => { haptic(); switchView(btn.dataset.view); }));

$("#btn-notifications").addEventListener("click", openNotifications);

/* ---------- Согласие при первом входе ---------- */
function showConsentGate() {
  return new Promise((resolve) => {
    modalLocked = true; // экран нельзя закрыть, пока не принято
    const render = () => {
      openModal(`
        <div class="section-title">${icon("shield", 17)} Добро пожаловать в StudentSwap</div>
        <div style="line-height:1.55;margin-bottom:16px">
          Чтобы пользоваться сервисом, подтверди, что тебе есть 18 лет (или есть согласие
          законного представителя) и что ты принимаешь наши документы. Мы обрабатываем
          минимум данных: профиль Telegram, учебное заведение, почту при верификации,
          геоточку и содержимое объявлений.
        </div>
        <div class="legal-links" style="margin-top:0;border:none;padding-top:0;margin-bottom:16px">
          <a href="#" id="consent-terms">Пользовательское соглашение</a>
          <span>·</span>
          <a href="#" id="consent-privacy">Политика конфиденциальности</a>
        </div>
        <button class="btn" id="consent-accept" style="width:100%">
          ${icon("check", 16)} Принимаю и продолжаю
        </button>
        <div style="font-size:12px;color:var(--hint);text-align:center;margin-top:10px">
          Нажимая «Принимаю», ты соглашаешься с обоими документами.
        </div>`);

      $("#consent-terms").addEventListener("click", (e) => {
        e.preventDefault();
        openLegalDoc("Пользовательское соглашение", "legal/terms.txt", render);
      });
      $("#consent-privacy").addEventListener("click", (e) => {
        e.preventDefault();
        openLegalDoc("Политика конфиденциальности", "legal/privacy.txt", render);
      });
      $("#consent-accept").addEventListener("click", async () => {
        try {
          state.me = await API.acceptConsent();
          haptic();
          modalLocked = false;
          closeModal();
          resolve();
        } catch (err) { toast(err.message); }
      });
    };
    render();
  });
}

/* ---------- Тема ---------- */
function applyTheme() {
  let dark;
  if (IS_TELEGRAM && tg.colorScheme) dark = tg.colorScheme === "dark";
  else dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.body.dataset.theme = dark ? "dark" : "light";
}

/* ---------- Запуск ---------- */
async function init() {
  applyTheme();
  mountIcons();
  if (IS_TELEGRAM) {
    tg.ready();
    tg.expand();
    tg.onEvent && tg.onEvent("themeChanged", applyTheme);
    if (tg.setHeaderColor) tg.setHeaderColor("secondary_bg_color");
  }
  try {
    const [me, meta] = await Promise.all([API.me(), API.meta()]);
    state.me = me;
    state.meta = meta;
    updateNotifBadge(me.unread_notifications);
    startNotifPolling();
  } catch (err) {
    view().innerHTML = `<div class="empty"><div class="big">${icon("x", 38)}</div>${esc(err.message)}</div>`;
    return;
  }
  if (!state.me.consent_accepted) {
    await showConsentGate();
  }
  switchView("feed");
}

init();
