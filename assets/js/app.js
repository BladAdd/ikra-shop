/* ==========================================================================
   Икра & Рыба — Логика интернет-магазина.
   Каталог, поиск, сортировка, интерактивные карточки, боковая корзина.
   ========================================================================== */

(function () {
  "use strict";

  var money = function (n) {
    if (n == null) return "по запросу";
    return new Intl.NumberFormat("ru-RU").format(n) + " ₽";
  };

  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  /* ---------- Состояние корзины ---------- */
  var STORE_KEY = "caviar_cart_v1";
  var cart = {};

  try {
    cart = JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {};
  } catch (e) { cart = {}; }

  function saveCart() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(cart)); } catch (e) {}
  }

  /* ---------- Избранное ---------- */
  var FAV_KEY = "caviar_fav_v1";
  var favs = {};
  try {
    JSON.parse(localStorage.getItem(FAV_KEY) || "[]").forEach(function (id) { favs[id] = 1; });
  } catch (e) { favs = {}; }

  function saveFavs() {
    try { localStorage.setItem(FAV_KEY, JSON.stringify(Object.keys(favs))); } catch (e) {}
  }

  /* Обновить счётчик на чипе «Избранное» в панели категорий */
  function updateFavChip() {
    var chip = document.querySelector(".cat-chip.fav-chip .cat-chip-count");
    if (chip) chip.textContent = Object.keys(favs).length;
  }

  /* ---------- Фасовки: выбор на карточке и отдельные строки корзины ----------
     Ключ корзины: "<id товара>" для основной фасовки или "<id>::<weight фасовки>".
     Так одна рыба в разных фасовках лежит в корзине разными строками. */
  var PACK_SEP = "::";
  var chosenPack = {}; // itemId -> weight фасовки (выбор на карточке, живёт в сессии)

  function parseCartKey(key) {
    var sep = key.indexOf(PACK_SEP);
    if (sep === -1) return { id: key, packWeight: null };
    return { id: key.slice(0, sep), packWeight: key.slice(sep + PACK_SEP.length) };
  }

  function findPack(it, weight) {
    if (!it || !weight || !Array.isArray(it.packs)) return null;
    for (var i = 0; i < it.packs.length; i++) {
      if (it.packs[i].weight === weight) return it.packs[i];
    }
    return null;
  }

  function kgOf(weightStr) {
    var m = /([\d.,]+)\s*кг/i.exec(weightStr || "");
    if (m) return parseFloat(m[1].replace(",", "."));
    var g = /(\d+)\s*г/i.exec(weightStr || "");
    if (g) return parseInt(g[1], 10) / 1000;
    return 1;
  }

  /* Стоимость одной штуки строки корзины: у фасовки — цена за фасовку, иначе цена товара. */
  function lineUnitPrice(it, packWeight) {
    var pack = findPack(it, packWeight);
    if (pack) {
      if (pack.total != null) return pack.total;
      return Math.round(packPricePerKg(it, pack) * kgOf(pack.weight));
    }
    return it.price;
  }

  /* ---------- Промокоды ---------- */
  var promoState = { code: "", discount: 0, valid: false };

  function applyPromo(codeRaw, sum) {
    var code = String(codeRaw || "").trim().toUpperCase();
    if (!code) return { err: "Введите промокод" };
    var promos = (typeof SHOP !== "undefined" && SHOP && Array.isArray(SHOP.promos)) ? SHOP.promos : [];
    for (var i = 0; i < promos.length; i++) {
      var p = promos[i];
      if (String(p.code || "").toUpperCase() !== code) continue;
      if (p.active === false) break;
      if (p.minSum && sum < p.minSum) return { err: "Промокод действует при заказе от " + money(p.minSum) };
      var d = p.type === "percent" ? Math.round(sum * Number(p.value) / 100) : Math.round(Number(p.value));
      if (!(d > 0)) break;
      return { ok: true, code: code, discount: Math.min(d, sum) };
    }
    return { err: "Такого промокода нет или он неактивен" };
  }

  function allItems() {
    var out = [];
    if (!Array.isArray(CATALOG)) return out;
    CATALOG.forEach(function (cat) {
      (cat.items || []).forEach(function (it) {
        out.push(Object.assign({ catId: cat.id, catTitle: cat.title }, it));
      });
    });
    return out;
  }

  function findItem(id) {
    var items = allItems();
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === id) return items[i];
    }
    return null;
  }

  function cartLines() {
    // Строка корзины = товар + выбранная фасовка. Ключ "<id>" или "<id>::<weight>".
    // Товар, удалённый из каталога, отбрасываем — держать его в корзине нечем.
    return Object.keys(cart).map(function (key) {
      var p = parseCartKey(key);
      var it = findItem(p.id);
      if (!it || !(cart[key] > 0)) return null; // мёртвые id и нулевые qty — мимо (W1-P2)
      return {
        item: it,
        qty: cart[key],
        key: key,
        pack: findPack(it, p.packWeight),
        packWeight: p.packWeight
      };
    }).filter(Boolean);
  }

  function cartCount() {
    // Только живые позиции: мёртвые ключи (товар удалён из каталога)
    // не должны надувать бейдж и уезжать в заказ (находка W1-P1)
    return cartLines().reduce(function (s, l) { return s + l.qty; }, 0);
  }

  function cartSum() {
    var lines = cartLines();
    var hasPrice = lines.some(function (l) { return l.item.price != null; });
    if (!hasPrice) return null;
    return lines.reduce(function (s, l) {
      // Строка без цены не даёт вклада в сумму
      var unit = lineUnitPrice(l.item, l.packWeight);
      return s + (unit == null ? 0 : unit * l.qty);
    }, 0);
  }

  /* ---------- Тост-уведомление ---------- */
  var toastEl = document.getElementById("toast");
  var toastT = null;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.innerHTML = "<span>✓</span> " + esc(msg);
    toastEl.classList.add("on");
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.remove("on"); }, 2400);
  }

  /* ---------- Отрисовка каталога ---------- */
  var root = document.getElementById("catalog-root");
  var emptyEl = document.getElementById("catalog-empty");
  var chipsRail = document.getElementById("cat-chips-rail");
  var searchCatalogEl = document.getElementById("search");
  var searchHeaderEl = document.getElementById("header-search-input");
  var searchClearBtn = document.getElementById("header-search-clear");
  var sortSelect = document.getElementById("sort-select");

  var activeCat = "all";
  var currentSort = "default";
  var query = "";

  var CAT_ICONS = {
    "hot-smoked": "🔥",
    "cold-smoked": "❄️",
    "salted": "🐟",
    "dried": "🌊",
    "caviar": "🔴",
    "delicacies": "🥩",
    "pickles": "🥗"
  };

  /* ---------- Высота липкой шапки (для панели категорий и якорей) ---------- */
  function syncHeaderHeight() {
    var header = document.getElementById("site-header");
    if (!header) return;
    var h = Math.round(header.getBoundingClientRect().height);
    if (h > 0) {
      document.documentElement.style.setProperty("--header-sticky-h", h + "px");
      document.documentElement.style.setProperty("scroll-padding-top", (h + 24) + "px");
    }
  }

  function badgeHtml(b, it) {
    var out = "";
    if (b) {
      var hot = /хит|осталось|свеж/i.test(b);
      out += '<span class="badge' + (hot ? " hot" : "") + '">' + esc(b) + "</span>";
    }
    if (it && it.oldPrice && it.price && it.oldPrice > it.price) {
      var pct = Math.round((1 - it.price / it.oldPrice) * 100);
      out += '<span class="badge-discount">−' + pct + "%</span>";
    }
    return out;
  }

  /* Подпись под ценой строится по прайсу: у весовых товаров цена за килограмм,
     у порционных (яйца, стекло, упаковка 200 г) — за единицу. */
  var NEED_PHOTO = "__NEED_PHOTO__.jpg";

  function needsPhoto(it) {
    return !!it && String(it.img || "").indexOf(NEED_PHOTO) !== -1;
  }

  function priceCaption(it) {
    if (!it) return "";
    if (it.unit === "кг" && it.piece) return it.weight ? "за " + it.weight : "за упаковку";
    if (it.unit === "кг") return "за 1 кг";
    if (it.unit === "шт" && it.weight && /^\d+\s*шт$/.test(it.weight)) return "за упаковку " + it.weight;
    if (it.weight) return "за " + it.weight;
    return it.unit ? "за 1 " + it.unit : "";
  }

  /* Цена за килограмм фасовки. Контракт каталога: у весовых товаров
     pack.price — уже цена за кг (сумма фасовки = pack.total); делить нельзя
     (находка W2-P0: чип «3 кг» показывал 290 ₽/кг вместо 870). Делим только
     у порционных товаров, где pack.price — цена упаковки. */
  function packPricePerKg(it, pack) {
    if (it.unit !== "кг") return pack.price;
    if (!it.piece) return pack.price;
    if (pack.total != null && pack.total > 0) {
      var kg0 = kgOf(pack.weight);
      if (kg0 > 0) return pack.total / kg0;
    }
    var m = /([\d.,]+)\s*кг/.exec(pack.weight);
    if (m) return pack.price / parseFloat(m[1].replace(",", "."));
    var g = /(\d+)\s*г/.exec(pack.weight);
    if (g) return pack.price / (parseInt(g[1], 10) / 1000);
    return pack.price;
  }

  function packSavingText(it) {
    var packs = it && Array.isArray(it.packs) ? it.packs : [];
    if (it.unit !== "кг" || packs.length < 2) return "";
    var base = packPricePerKg(it, { weight: it.weight, price: it.price });
    var best = null;
    packs.forEach(function (p) {
      var per = packPricePerKg(it, p);
      if (per < base - 1 && (!best || per < packPricePerKg(it, best))) best = p;
    });
    if (!best) return "";
    return "Выгоднее: " + best.weight + " — " + money(Math.round(packPricePerKg(it, best))) + " за 1 кг";
  }

  /* Чипы выбора фасовки на карточке: показываем только у весовых товаров
     без штучной продажи и при наличии двух и более фасовок. */
  function packChipsHtml(it) {
    if (it.unit !== "кг" || it.piece || !Array.isArray(it.packs) || it.packs.length < 2) return "";
    var chosen = chosenPack[it.id] || it.weight; // выбор пользователя или фасовка по умолчанию

    // Самая выгодная фасовка — с минимальной ценой за килограмм
    var best = null;
    it.packs.forEach(function (p) {
      if (!best || packPricePerKg(it, p) < packPricePerKg(it, best)) best = p;
    });

    var out = '<div class="pack-chips">';
    it.packs.forEach(function (p) {
      out += '<button type="button" class="pack-chip' +
        (chosen === p.weight ? " active" : "") +
        (best && p.weight === best.weight ? " best" : "") +
        '" data-pack="' + esc(p.weight) + '" data-id="' + esc(it.id) + '">' +
        esc(p.weight) + "</button>";
    });
    out += "</div>";

    // Подпись под чипами: цена выбранной фасовки за килограмм и за всю фасовку
    var sel = findPack(it, chosen);
    if (sel) {
      var per = Math.round(packPricePerKg(it, sel));
      var total = sel.total != null ? sel.total : Math.round(per * kgOf(sel.weight));
      out += '<div class="pack-chip-note">' + esc(sel.weight) + " — " + money(total) + " за фасовку</div>";
    }
    return out;
  }

  function priceHtml(it, packWeight) {
    if (it.price == null) {
      return '<div class="price">По запросу<small>уточним при заказе</small></div>';
    }
    var old = it.oldPrice ? '<span class="old">' + money(it.oldPrice) + "</span>" : "";
    var pack = findPack(it, packWeight);
    if (pack) {
      // Выбрана фасовка: показываем её цену за килограмм + итог за фасовку
      var per = Math.round(packPricePerKg(it, pack));
      var total = pack.total != null ? pack.total : Math.round(per * kgOf(pack.weight));
      return '<div class="price">' + money(per) + old +
        "<small>за 1 кг · " + esc(pack.weight) + " — " + money(total) + " за фасовку</small>" +
        "</div>";
    }
    var caption = priceCaption(it);
    var hint = packSavingText(it);
    return '<div class="price">' + money(it.price) + old +
      (caption ? "<small>" + caption + "</small>" : "") +
      (hint ? '<span class="price-hint">' + esc(hint) + "</span>" : "") +
      "</div>";
  }

  function cardHtml(it) {
    // Ключ корзины учитывает выбранную на карточке фасовку
    var packWeight = chosenPack[it.id] || null;
    var key = it.id + (packWeight ? PACK_SEP + packWeight : "");
    var inCart = cart[key] || 0;
    var actionBtnHtml = inCart > 0
      ? '<div class="card-stepper">' +
          '<button type="button" data-act="dec" data-key="' + esc(key) + '" aria-label="Меньше">−</button>' +
          '<span class="count">' + inCart + "</span>" +
          '<button type="button" data-act="inc" data-key="' + esc(key) + '" aria-label="Больше">+</button>' +
        "</div>"
      : '<button class="btn btn-gold btn-sm add-btn" data-key="' + esc(key) + '">' +
          '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>' +
          "<span>В корзину</span>" +
        "</button>";

    return '' +
      '<article class="card" data-id="' + esc(it.id) + '">' +
        '<div class="card-img">' +
          '<button type="button" class="fav-btn' + (favs[it.id] ? " active" : "") + '" data-fav="' + esc(it.id) + '" aria-label="В избранное"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></button>' +
          (needsPhoto(it) ? '<span class="badge badge-need">Фото нужно</span>' : badgeHtml(it.badge, it)) +
          '<img src="' + esc(it.img) + '" alt="' + esc(it.name) + '" loading="lazy" data-zoom="' + esc(it.id) + '" onerror="this.src=\'assets/img/hero-caviar.jpg\'">' +
          (it.weight ? '<span class="card-photo-weight">' + esc(it.weight) + "</span>" : "") +
        '</div>' +
        '<div class="card-body">' +
          '<h4><a class="card-title-link" href="product.html?id=' + encodeURIComponent(it.id) + '">' + esc(it.name) + "</a></h4>" +
          '<p class="card-desc">' + esc(it.desc || "Свежий деликатес высшего сорта с натуральным вкусом.") + "</p>" +
          packChipsHtml(it) +
          '<div class="card-foot">' +
            priceHtml(it, chosenPack[it.id]) +
            actionBtnHtml +
          "</div>" +
        "</div>" +
      "</article>";
  }

  /* Нормализация строк для поиска: нижний регистр + «ё» → «е» */
  function normTxt(s) {
    return String(s || "").toLowerCase().replace(/ё/g, "е");
  }

  /* Нормализация поискового запроса: + схлопывание пробелов */
  function normQuery(s) {
    // дефисы/тире → пробел: «вяленая-рыба» ищется как два слова (находка W6-P2)
    return normTxt(s).replace(/[-\u2010-\u2015]/g, " ").replace(/\s+/g, " ").trim();
  }

  /* Все слова запроса q должны встретиться в нормализованной строке карточки hay */
  function queryFits(hay, q) {
    var tokens = q.split(/\s+/).filter(Boolean);
    for (var j = 0; j < tokens.length; j++) {
      if (hay.indexOf(tokens[j]) === -1) return false;
    }
    return true;
  }

  function matches(it) {
    if (activeCat === "fav") {
      // Показываем только отмеченные сердечком товары
      if (!favs[it.id]) return false;
    } else if (activeCat !== "all" && it.catId !== activeCat) {
      return false;
    }
    if (!query) return true;
    // Все слова запроса должны встретиться в карточке
    var hay = normTxt(it.name + " " + (it.desc || "") + " " + (it.tags || "") + " " + (it.weight || ""));
    if (queryFits(hay, query)) return true;
    // Словоформы (подбор по окончаниям): если по полному запросу совпадений нет —
    // пробуем запрос без последней буквы, затем без двух. Только для запросов длиннее
    // 4 символов; сам запрос не искажаем — усечённая копия используется лишь здесь,
    // в месте сравнения.
    if (query.length > 4) {
      if (queryFits(hay, query.slice(0, -1))) return true;
      if (queryFits(hay, query.slice(0, -2))) return true;
    }
    return false;
  }

  function matchScore(it, q) {
    if (!q) return 0;
    var name = normTxt(it.name);
    var tags = normTxt(it.tags);
    var desc = normTxt(it.desc);
    if (name === q) return 100;
    if (name.indexOf(q) === 0) return 90;
    // Слово в названии целиком (например «Икра» в «Икра кеты»)
    var words = name.split(/[\s,(«»\/\-]+/).filter(Boolean);
    if (words.indexOf(q) !== -1) return 85;
    if (name.indexOf(q) !== -1) return 70;
    if (tags.indexOf(q) !== -1) return 40;
    if (desc.indexOf(q) !== -1) return 10;
    return 0;
  }

  function sortItems(list) {
    var arr = list.slice();
    if (query && currentSort === "default") {
      // При поиске без явной сортировки — по релевантности
      arr.sort(function (a, b) {
        return matchScore(b, query) - matchScore(a, query);
      });
      return arr;
    }
    if (currentSort === "price-asc") {
      arr.sort(function (a, b) {
        return (a.price || 999999) - (b.price || 999999);
      });
    } else if (currentSort === "price-desc") {
      arr.sort(function (a, b) {
        return (b.price || 0) - (a.price || 0);
      });
    } else if (currentSort === "name") {
      arr.sort(function (a, b) {
        return (a.name || "").localeCompare(b.name || "", "ru");
      });
    }
    return arr;
  }

  function renderCatalog() {
    if (!root) return;
    var html = "";
    var totalVisible = 0;

    // Во время поиска товары показываются единым списком по релевантности,
    // иначе первая по порядку категория вытесняет самые точные совпадения.
    if (query) {
      var found = [];
      CATALOG.forEach(function (cat) {
        (cat.items || []).forEach(function (i) {
          var item = Object.assign({ catId: cat.id, catTitle: cat.title }, i);
          if (matches(item)) found.push(item);
        });
      });
      totalVisible = found.length;
      if (totalVisible) {
        var ranked = sortItems(found);
        if (currentSort === "default") {
          ranked.sort(function (a, b) { return matchScore(b, query) - matchScore(a, query); });
        }
        html += '<div class="cat-head">';
        html += '  <h3>🔍 Результаты поиска</h3>';
        html += '  <span>по запросу «' + esc(query) + '» — ' + totalVisible + " шт.</span>";
        html += "</div>";
        html += '<div class="grid">' + ranked.map(cardHtml).join("") + "</div>";
      }
    } else {
      CATALOG.forEach(function (cat) {
        var items = (cat.items || [])
          .map(function (i) { return Object.assign({ catId: cat.id }, i); })
          .filter(matches);

        if (!items.length) return;
        totalVisible += items.length;

        var sorted = sortItems(items);
        html += '<div class="cat-head" id="cat-group-' + esc(cat.id) + '">';
        html += '  <h3>' + (CAT_ICONS[cat.id] || "🐟") + " " + esc(cat.title) + "</h3>";
        html += '  <span>' + esc(cat.subtitle || "") + " (" + items.length + ")</span>";
        html += "</div>";
        html += '<div class="grid">' + sorted.map(cardHtml).join("") + "</div>";
      });
    }

    root.innerHTML = html;
    if (emptyEl) emptyEl.style.display = totalVisible ? "none" : "block";

    // обновить счетчик "Все товары"
    var countAllEl = document.getElementById("count-all");
    if (countAllEl) countAllEl.textContent = allItems().length;
  }

  function renderCategoryChips() {
    if (!chipsRail) return;
    var all = allItems();
    var chips = [
      '<button class="cat-chip' + (activeCat === "all" ? " active" : "") + '" data-cat="all">' +
        '<span class="cat-chip-icon">✨</span>' +
        '<span class="cat-chip-title">Все товары</span>' +
        '<span class="cat-chip-count" id="count-all">' + all.length + "</span>" +
      "</button>",
      // Чип избранного — сразу после «Все товары»
      '<button class="cat-chip fav-chip' + (activeCat === "fav" ? " active" : "") + '" data-cat="fav" title="Товары, отмеченные сердечком">' +
        '<span class="cat-chip-icon">❤</span>' +
        '<span class="cat-chip-title">Избранное</span>' +
        '<span class="cat-chip-count">' + Object.keys(favs).length + "</span>" +
      "</button>"
    ];

    CATALOG.forEach(function (c) {
      var cnt = (c.items || []).length;
      var ico = CAT_ICONS[c.id] || "🐟";
      var isAct = activeCat === c.id;
      chips.push(
        '<button class="cat-chip' + (isAct ? " active" : "") + '" data-cat="' + esc(c.id) + '">' +
          '<span class="cat-chip-icon">' + ico + "</span>" +
          '<span class="cat-chip-title">' + esc(c.title) + "</span>" +
          '<span class="cat-chip-count">' + cnt + "</span>" +
        "</button>"
      );
    });

    chipsRail.innerHTML = chips.join("");
  }

  /* ---------- Корзина: отрисовка и расчеты ---------- */
  var cartBody = document.getElementById("cart-body");
  var drawerBody = document.getElementById("drawer-body");
  var cartTotal = document.getElementById("cart-total");
  var drawerFooter = document.getElementById("drawer-footer");
  var cartSumEl = document.getElementById("cart-sum");
  var drawerSumEl = document.getElementById("drawer-sum");
  var headerCartSumEl = document.getElementById("header-cart-sum");
  var cartSubtotalVal = document.getElementById("cart-subtotal-val");
  var cartDeliveryStatus = document.getElementById("cart-delivery-status");
  var cartCountEl = document.getElementById("cart-count");
  var drawerCountEl = document.getElementById("drawer-count");
  var cartQtyLabel = document.getElementById("cart-qty-label");
  var cartClearBtn = document.getElementById("cart-clear-btn");

  var mcbEl = document.getElementById("mobile-cart-bar");
  var mcbCountEl = document.getElementById("mcb-count");
  var mcbSumEl = document.getElementById("mcb-sum");

  var FREE_SHIPPING_THRESHOLD = (SHOP && SHOP.freeFrom) || 5000;

  function updateFreeShippingProgress(sum) {
    var s = sum || 0;
    var pct = Math.min(100, Math.round((s / FREE_SHIPPING_THRESHOLD) * 100));
    var rem = FREE_SHIPPING_THRESHOLD - s;

    var text = rem <= 0
      ? "🎉 Поздравляем! Доставка по Москве БЕСПЛАТНО!"
      : "До бесплатной доставки по Москве осталось " + money(rem);

    // на странице
    var fsText = document.getElementById("fs-text");
    var fsProg = document.getElementById("fs-progress");
    if (fsText) fsText.textContent = text;
    if (fsProg) fsProg.style.width = pct + "%";

    // в боковой корзине
    var dfsText = document.getElementById("drawer-fs-text");
    var dfsProg = document.getElementById("drawer-fs-progress");
    if (dfsText) dfsText.textContent = text;
    if (dfsProg) dfsProg.style.width = pct + "%";

    if (cartDeliveryStatus) {
      if (s === 0) {
        cartDeliveryStatus.textContent = "Рассчитывается";
        cartDeliveryStatus.style.color = "var(--gold-400)";
      } else if (rem <= 0) {
        cartDeliveryStatus.textContent = "Бесплатно!";
        cartDeliveryStatus.style.color = "#38e87d";
      } else {
        cartDeliveryStatus.textContent = "от 350 ₽";
        cartDeliveryStatus.style.color = "var(--cream-dim)";
      }
    }
  }

  function linesHtml(lines) {
    return lines.map(function (l) {
      var it = l.item;
      // Вес строки — вес выбранной фасовки или базовый вес товара
      var lineWeight = l.packWeight || it.weight;
      // Стоимость единицы: у фасовки — цена за фасовку, у обычного товара — it.price
      var unit = lineUnitPrice(it, l.packWeight);
      var sum = unit == null ? "—" : money(unit * l.qty);
      return '' +
        '<div class="cart-line">' +
          '<img src="' + esc(it.img) + '" alt="' + esc(it.name) + '" onerror="this.src=\'assets/img/hero-caviar.jpg\'">' +
          "<div>" +
            '<div class="nm">' + esc(it.name) + (lineWeight ? "<small>" + esc(lineWeight) + " · " + esc(priceCaption(it)) + "</small>" : "") + "</div>" +
            '<div class="qty">' +
              '<button type="button" data-act="dec" data-key="' + esc(l.key) + '" aria-label="Меньше">−</button>' +
              "<span>" + l.qty + "</span>" +
              '<button type="button" data-act="inc" data-key="' + esc(l.key) + '" aria-label="Больше">+</button>' +
            "</div>" +
          "</div>" +
          '<div style="text-align:right">' +
            '<div class="ln-sum">' + sum + "</div>" +
            '<button type="button" class="rm" data-act="rm" data-key="' + esc(l.key) + '">удалить</button>' +
          "</div>" +
        "</div>";
    }).join("");
  }

  /* ---------- UI промокода: строка скидки в сводке и в drawer ---------- */
  function updatePromoUi() {
    var subtotal = cartSum() || 0;
    // Скидка пересчитывается от ТЕКУЩЕЙ суммы корзины — не замирает после
    // изменения состава заказа и не превышает его (находка W1-P1)
    var discount = 0;
    if (promoState.valid && promoState.code) {
      var ps = applyPromo(promoState.code, subtotal);
      if (ps && ps.ok) {
        promoState.discount = ps.discount;
        discount = ps.discount;
      } else {
        promoState.valid = false;
        promoState.discount = 0;
      }
    }
    var lineText = "−" + money(discount) + (promoState.valid && promoState.code ? " (" + promoState.code + ")" : "");
    var linePage = document.getElementById("cart-promo-line");
    var lineDrawer = document.getElementById("drawer-promo-line");

    /* Доставка в «Итого»: зеркало серверной логики (orders.ts):
       курьер 350 ₽ при subtotal < freeFrom; регионы — СДЭК посчитает менеджер;
       самовывоз — 0. (находка W8-P1: итог не включал доставку) */
    var DELIVERY_FEE = 350; // = config.deliveryFee на сервере
    var fee = 0;
    var delEl = document.querySelector('#order-form input[name="delivery"]:checked');
    var delVal = delEl ? delEl.value : "";
    var delStatus = document.getElementById("cart-delivery-status");
    if (delVal === "Курьер по Москве и МО") {
      fee = (subtotal != null && subtotal < FREE_SHIPPING_THRESHOLD) ? DELIVERY_FEE : 0;
      if (delStatus) delStatus.textContent = fee ? money(DELIVERY_FEE) : "Бесплатно";
    } else if (delVal === "Отправка в другой город") {
      if (delStatus) delStatus.textContent = "СДЭК — рассчитает менеджер";
    } else if (delVal === "Самовывоз") {
      if (delStatus) delStatus.textContent = "Бесплатно";
    }

    if (linePage) {
      linePage.style.display = discount > 0 ? "" : "none";
      var v1 = document.getElementById("cart-promo-val");
      if (v1) v1.textContent = lineText;
    }
    if (lineDrawer) {
      lineDrawer.style.display = discount > 0 ? "" : "none";
      var v2 = document.getElementById("drawer-promo-val");
      if (v2) v2.textContent = lineText;
    }
    var finalPage = document.getElementById("cart-sum");
    var finalDrawer = document.getElementById("drawer-sum");
    // На странице итог с доставкой (как на сервере), в drawer — товары со скидкой
    if (finalPage) finalPage.textContent = money(Math.max(0, subtotal - discount) + fee);
    if (finalDrawer) finalDrawer.textContent = money(Math.max(0, subtotal - discount));
  }

  function renderCart() {
    var lines = cartLines();
    var n = cartCount();
    var sum = cartSum();
    var sumStr = sum == null ? "по запросу" : money(sum);

    // счетчики
    if (cartCountEl) {
      cartCountEl.textContent = n;
      cartCountEl.classList.toggle("on", n > 0);
    }
    if (drawerCountEl) drawerCountEl.textContent = n;
    if (headerCartSumEl) headerCartSumEl.textContent = sum ? sumStr : "0 ₽";
    if (cartQtyLabel) cartQtyLabel.textContent = n ? "(" + n + " поз.)" : "";
    if (cartClearBtn) cartClearBtn.style.display = n ? "inline-block" : "none";

    // мобильный бар
    if (mcbEl) {
      if (n > 0) {
        mcbEl.classList.add("on");
        if (mcbCountEl) mcbCountEl.textContent = n + " поз.";
        if (mcbSumEl) mcbSumEl.textContent = sumStr;
      } else {
        mcbEl.classList.remove("on");
      }
    }

    // прогресс бесплатной доставки
    updateFreeShippingProgress(sum || 0);

    var emptyMarkup = '<div class="cart-empty"><div class="cart-empty-icon">🛒</div><b>Корзина пока пуста</b><span>Выберите деликатесы в каталоге выше</span></div>';

    if (!lines.length) {
      if (cartBody) cartBody.innerHTML = emptyMarkup;
      if (drawerBody) drawerBody.innerHTML = emptyMarkup;
      if (cartTotal) cartTotal.style.display = "none";
      if (drawerFooter) drawerFooter.style.display = "none";
      updatePromoUi(); // сброс #cart-sum/#drawer-sum в «0 ₽» — иначе протухают (GUI-1)
      return;
    }

    var linesContent = '<div class="cart-lines">' + linesHtml(lines) + "</div>";
    if (cartBody) cartBody.innerHTML = linesContent;
    if (drawerBody) drawerBody.innerHTML = linesContent;

    if (cartTotal) cartTotal.style.display = "grid";
    if (drawerFooter) drawerFooter.style.display = "block";

    if (cartSubtotalVal) cartSubtotalVal.textContent = sumStr;
    // Итог к оплате и строка скидки считаются в updatePromoUi (с учётом промокода)
    updatePromoUi();
  }

  /* addToCart принимает КЛЮЧ корзины: "<id>" или "<id>::<weight фасовки>" */
  function addToCart(key) {
    cart[key] = (cart[key] || 0) + 1;
    saveCart();
    renderCart();
    renderCatalog();
    var it = findItem(parseCartKey(key).id);
    toast("Добавлено: " + (it ? it.name : "товар"));
  }

  /* ---------- Slide-over боковая корзина ---------- */
  var drawer = document.getElementById("cart-drawer");
  var backdrop = document.getElementById("drawer-backdrop");

  function openDrawer() {
    if (drawer) drawer.classList.add("open");
    if (backdrop) backdrop.classList.add("open");
    document.body.style.overflow = "hidden";
  }

  function closeDrawer() {
    if (drawer) drawer.classList.remove("open");
    if (backdrop) backdrop.classList.remove("open");
    document.body.style.overflow = "";
  }

  /* ---------- Текст заказа для WhatsApp / формы ---------- */
  function orderText(form) {
    var lines = cartLines();
    var out = [];
    out.push("🛒 ЗАКАЗ В МАГАЗИНЕ «" + (SHOP.name || "Икра & Рыба") + "»");
    out.push("--------------------------------------");
    if (lines.length) {
      lines.forEach(function (l) {
        var it = l.item;
        var w = l.packWeight || it.weight;
        var unit = lineUnitPrice(it, l.packWeight);
        var sum = unit == null ? "цена по запросу" : money(unit * l.qty);
        out.push("• " + it.name + (w ? " (" + w + ")" : "") + " × " + l.qty + " = " + sum);
      });
      var s = cartSum();
      out.push("--------------------------------------");
      out.push("ИТОГО ЗА ТОВАРЫ: " + (s == null ? "уточняется" : money(s)));
      // Активный промокод — добавляем строки скидки и итога со скидкой
      if (promoState.valid && promoState.discount > 0) {
        out.push("ПРОМОКОД: " + promoState.code + " (скидка −" + money(promoState.discount) + ")");
        out.push("ИТОГО СО СКИДКОЙ: " + money(Math.max(0, (s || 0) - promoState.discount)));
      }
      if (s >= FREE_SHIPPING_THRESHOLD) {
        out.push("🚚 Доставка по Москве: БЕСПЛАТНО (акция от 5 000 ₽)");
      }
    } else {
      out.push("(состав товаров будет уточнён с менеджером)");
    }
    out.push("");
    if (form) {
      out.push("ДАННЫЕ ПОЛУЧАТЕЛЯ:");
      out.push("Имя: " + (form.name || "—"));
      out.push("Телефон: " + (form.phone || "—"));
      out.push("Адрес доставки: " + (form.city || "—"));
      out.push("Способ получения: " + (form.delivery || "—"));
      out.push("Способ оплаты: " + (form.payment || "—"));
      if (form.comment) out.push("Комментарий: " + form.comment);
    }
    return out.join("\n");
  }

  function waLink(text) {
    // Номер задаётся владельцем в конфиге магазина (shop.whatsapp). Пока он
    // не заполнен — ссылка пустая: все WhatsApp-кнопки прячутся (см. waAvailable).
    var phone = String(SHOP.whatsapp || "").replace(/\D/g, "");
    if (!phone) return "";
    return "https://wa.me/" + phone + "?text=" + encodeURIComponent(text);
  }

  var waAvailable = function () {
    return !!String(SHOP.whatsapp || "").replace(/\D/g, "");
  };

  function payNote(payment) {
    var note = document.getElementById("pay-note");
    if (!note) return;
    if (payment === "Оплата при получении") {
      note.textContent = "Оплата курьеру при вручении заказа: наличными или банковской картой через мобильный терминал.";
    } else if (payment === "Перевод по реквизитам") {
      note.textContent = "Выставим официальный счёт на ИП или пришлём платёжные реквизиты СБП после проверки наличия.";
    } else {
      note.textContent = "После подтверждения точного веса партии менеджер пришлёт официальную платёжную ссылку (СБП / МИР / Visa / Mastercard).";
    }
  }

  /* ---------- Отправка заказа ---------- */
  function submitOrder(formData) {
    var text = orderText(formData);

    // Приоритет: серверный API (заказ в БД + онлайн-оплата).
    // WhatsApp остаётся резервным каналом, если сервер недоступен
    // или выбран способ «Оплата при получении».
    // ВАЖНО: API используется только когда база реально задана (сервер поднят).
    // На GitHub Pages API.base === "" — иначе fetch уходит в корень Pages и
    // заказ теряется (находка багханта B6): поэтому идём в WhatsApp напрямую.
    var canUseApi = typeof API !== "undefined" && !!API.base;
    var isOnlinePay = !/при получении|перевод/i.test(formData.payment || "");

    if (canUseApi) {
      if (!isOnlinePay) {
        return API.createOrder({
          name: formData.name,
          phone: formData.phone,
          address: formData.city,
          delivery: formData.delivery,
          payment: formData.payment,
          comment: formData.comment,
          // Промокод уезжает на сервер — менеджер видит его в заказе (находка W8-P0)
          promo: (promoState.valid && promoState.code) ? promoState.code : undefined,
          // pack — вес выбранной фасовки; сервер посчитает цену фасовки сам
          items: cartLines().map(function (l) { return { id: l.item.id, qty: l.qty, pack: l.packWeight || "" }; }),
        }).then(function (res) {
          return { ok: true, channel: "whatsapp", link: waLink(text), order: res.order };
        });
      }

      return API.createOrder({
        name: formData.name,
        phone: formData.phone,
        address: formData.city,
        delivery: formData.delivery,
        payment: formData.payment,
        comment: formData.comment,
        promo: (promoState.valid && promoState.code) ? promoState.code : undefined,
        items: cartLines().map(function (l) { return { id: l.item.id, qty: l.qty, pack: l.packWeight || "" }; }),
      }).then(function (res) {
        return API.createPayment(res.order.id).then(function (pay) {
          return { ok: true, channel: "online", order: res.order, payUrl: pay.payUrl, testMode: pay.testMode };
        }).catch(function (payErr) {
          // Платёжный шлюз не настроен — заказ уже в базе, менеджер свяжется
          return { ok: true, channel: "whatsapp", link: waLink(text), order: res.order, paymentUnavailable: true, payError: payErr.message };
        });
      });
    }

    if (typeof ORDER_ENDPOINT !== "undefined" && ORDER_ENDPOINT) {
      return fetch(ORDER_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(Object.assign({}, formData, {
          order: text,
          items: cartLines().map(function (l) {
            return { id: l.item.id, name: l.item.name, weight: l.packWeight || l.item.weight, qty: l.qty, price: l.item.price };
          }),
          total: cartSum()
        }))
      }).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return { ok: true, channel: "server" };
      });
    }

    // Нет ни сервера, ни WhatsApp-номера: канал недоступен, заказ не уйдёт «в никуда»
    if (!waAvailable()) {
      return Promise.resolve({ ok: false, noChannel: true });
    }
    return Promise.resolve({ ok: true, channel: "whatsapp", link: waLink(text) });
  }

  var modal = document.getElementById("modal");
  function openModal(link) {
    if (!modal) return;
    var wa = document.getElementById("modal-wa");
    if (wa) {
      var fallback = link || (waAvailable() ? waLink(orderText(null)) : "");
      if (fallback) {
        wa.href = fallback;
        wa.style.display = "inline-flex";
      } else {
        wa.style.display = "none";
      }
    }
    modal.classList.add("on");
  }
  function closeModal() { if (modal) modal.classList.remove("on"); }

  /* ---------- Промокоды: привязка инпут + кнопка + сообщение ----------
     В подвале drawer и в форме заказа два независимых инпута, но состояние
     промокода одно: применённый код синхронизируется в оба. */
  function promoPartnerInputId(inputId) {
    return inputId === "drawer-promo-input" ? "form-promo-input" : "drawer-promo-input";
  }

  function bindPromo(inputId, btnId, msgId) {
    var input = document.getElementById(inputId);
    var btn = document.getElementById(btnId);
    var msg = document.getElementById(msgId);
    if (!input || !btn || !msg) return;

    function apply() {
      var r = applyPromo(input.value, cartSum() || 0);
      msg.textContent = r.err || ("Промокод применён: −" + money(r.discount));
      msg.className = "promo-msg " + (r.ok ? "ok" : "err");
      msg.style.display = "block";
      if (r.ok) {
        promoState = { code: r.code, discount: r.discount, valid: true };
        // Прописываем код и в парный инпут, чтобы оба места показывали одно
        var partner = document.getElementById(promoPartnerInputId(inputId));
        if (partner) partner.value = input.value;
        updatePromoUi();
        toast("Промокод применён");
      } else {
        promoState.valid = false;
        updatePromoUi();
      }
    }

    btn.addEventListener("click", apply);
    // Enter в поле ввода работает как кнопка «Применить»
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); apply(); }
    });
  }

  /* Полный сброс промокода: состояние, оба инпута, оба сообщения */
  function resetPromo() {
    promoState = { code: "", discount: 0, valid: false };
    ["drawer-promo-input", "form-promo-input"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = "";
    });
    ["drawer-promo-msg", "form-promo-msg"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.style.display = "none";
    });
    updatePromoUi();
  }

  /* ---------- Автосохранение полей формы заказа ----------
     Черновик (имя, телефон, адрес, комментарий) живёт в localStorage,
     чтобы случайно закрытая страница не потеряла введённые данные. */
  var CHECKOUT_DRAFT_KEY = "caviar_checkout_v1";
  var DRAFT_FIELDS = ["f-name", "f-phone", "f-city", "f-comment"];

  function saveCheckoutDraft() {
    var data = {};
    DRAFT_FIELDS.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) data[id] = el.value;
    });
    try { localStorage.setItem(CHECKOUT_DRAFT_KEY, JSON.stringify(data)); } catch (e) {}
  }

  function restoreCheckoutDraft() {
    var raw = null;
    try { raw = localStorage.getItem(CHECKOUT_DRAFT_KEY); } catch (e) {}
    if (!raw) return;
    var data = null;
    try { data = JSON.parse(raw); } catch (e) { return; }
    if (!data) return;
    DRAFT_FIELDS.forEach(function (id) {
      var el = document.getElementById(id);
      if (el && typeof data[id] === "string") el.value = data[id];
    });
  }

  function clearCheckoutDraft() {
    try { localStorage.removeItem(CHECKOUT_DRAFT_KEY); } catch (e) {}
  }

  /* ---------- Просмотр фото ---------- */
  var lightbox = document.getElementById("lightbox");
  function openLightbox(id) {
    var it = findItem(id);
    if (!it || !lightbox) return;
    var img = lightbox.querySelector(".lightbox-img");
    var title = lightbox.querySelector(".lightbox-title");
    var price = lightbox.querySelector(".lightbox-price");
    if (img) { img.src = it.img; img.alt = it.name; }
    if (title) title.textContent = it.name;
    if (price) price.textContent = money(it.price) + (priceCaption(it) ? " " + priceCaption(it) : "");
    // Ссылка «Страница товара» ведёт на карточку в product.html
    var pageLink = document.getElementById("lightbox-open-page");
    if (pageLink) {
      pageLink.href = "product.html?id=" + encodeURIComponent(id);
      // У товара без фото ссылка не нужна — вместо фото будет заглушка
      pageLink.style.display = needsPhoto(it) ? "none" : "";
    }
    lightbox.classList.add("on");
    document.body.style.overflow = "hidden";
  }
  function closeLightbox() {
    if (!lightbox) return;
    lightbox.classList.remove("on");
    document.body.style.overflow = "";
  }

  /* ---------- Инициализация ---------- */
  function init() {
    var set = function (id, val) { var e = document.getElementById(id); if (e && val) e.textContent = val; };
    set("foot-hours", SHOP.workHours || "Ежедневно 9:00 — 21:00");
    set("price-date", SHOP.priceListDate || "");
    set("price-note", SHOP.priceNote || "");
    
    var yr = document.getElementById("year");
    if (yr) yr.textContent = new Date().getFullYear();

    var legal = [];
    if (SHOP.legalName) legal.push(SHOP.legalName);
    if (SHOP.inn) legal.push("ИНН " + SHOP.inn);
    if (SHOP.ogrnip) legal.push("ОГРНИП " + SHOP.ogrnip);
    var legalStr = legal.join(" · ");
    set("foot-requisites", legalStr);

    var fw = document.getElementById("float-wa");
    if (fw) {
      if (waAvailable()) {
        fw.href = waLink("Здравствуйте! Хочу уточнить ассортимент и оформить заказ на деликатесы.");
      } else {
        fw.style.display = "none";
      }
    }
    var drawerWa = document.getElementById("drawer-wa-order");
    if (drawerWa && !waAvailable()) drawerWa.style.display = "none";

    var stat = document.getElementById("stat-count");
    if (stat) stat.textContent = allItems().length;

    if (!SHOP.newYear) {
      var s = document.getElementById("snow");
      if (s) s.style.display = "none";
    }

    renderCategoryChips();
    renderCatalog();
    renderCart();
    payNote("Онлайн по ссылке");

    // Промокоды: привязываем оба места ввода (drawer и форма заказа)
    bindPromo("drawer-promo-input", "drawer-promo-apply", "drawer-promo-msg");
    bindPromo("form-promo-input", "form-promo-apply", "form-promo-msg");

    // Черновик формы заказа: восстановить и включить автосохранение
    restoreCheckoutDraft();
    DRAFT_FIELDS.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener("input", saveCheckoutDraft);
    });

    // Маска телефона: +7 (XXX) XXX-XX-XX, максимум 11 цифр
    var phoneEl = document.getElementById("f-phone");
    if (phoneEl) {
      phoneEl.addEventListener("input", function () {
        var digits = phoneEl.value.replace(/\D/g, "");
        // 8 в начале — это тот же российский код 7
        if (digits.charAt(0) === "8") digits = "7" + digits.slice(1);
        if (digits.charAt(0) !== "7") digits = "7" + digits;
        digits = digits.slice(0, 11);
        // Собираем маску только из имеющихся цифр — стирание не ломается
        var out = "";
        if (digits.length > 0) out = "+7";
        if (digits.length > 1) out += " (" + digits.slice(1, 4);
        if (digits.length >= 4) out += ")";
        if (digits.length > 4) out += " " + digits.slice(4, 7);
        if (digits.length > 7) out += "-" + digits.slice(7, 9);
        if (digits.length > 9) out += "-" + digits.slice(9, 11);
        phoneEl.value = out;
      });
    }

    syncHeaderHeight();
    window.addEventListener("resize", syncHeaderHeight);
    window.addEventListener("orientationchange", syncHeaderHeight);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(syncHeaderHeight);
    if (window.ResizeObserver) {
      var hdrEl = document.getElementById("site-header");
      if (hdrEl) new ResizeObserver(syncHeaderHeight).observe(hdrEl);
    }

    // Ссылка на админку видна только по ?admin=1 (или сохранённому флагу)
    var params = new URLSearchParams(location.search);
    if (params.get("admin") === "1") {
      try { localStorage.setItem("ikra_admin_visible", "1"); } catch (e) {}
    }
    var adminVisible = false;
    try { adminVisible = localStorage.getItem("ikra_admin_visible") === "1"; } catch (e) {}
    if (adminVisible) {
      document.querySelectorAll(".js-admin-link").forEach(function (a) { a.style.display = ""; });
    }

    // Переход к категории по ссылке из подвала
    document.querySelectorAll(".foot-link[data-fcat]").forEach(function (a) {
      a.addEventListener("click", function () {
        setActiveCat(a.dataset.fcat, true);
      });
    });

    function setActiveCat(catId, scroll) {
      activeCat = catId;
      if (chipsRail) {
        chipsRail.querySelectorAll(".cat-chip").forEach(function (c) {
          c.classList.toggle("active", c.dataset.cat === catId);
        });
      }
      renderCatalog();
      if (scroll) {
        var catSec = document.getElementById("catalog");
        if (catSec) catSec.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }

    // Обработчик фильтров категорий
    if (chipsRail) {
      chipsRail.addEventListener("click", function (e) {
        var chip = e.target.closest(".cat-chip");
        if (!chip) return;
        activeCat = chip.dataset.cat;
        chipsRail.querySelectorAll(".cat-chip").forEach(function (c) { c.classList.remove("active"); });
        chip.classList.add("active");
        renderCatalog();
        
        // Плавный скролл к каталогу
        var catSec = document.getElementById("catalog");
        if (catSec && window.scrollY > 400) {
          catSec.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    }

    // Сортировка
    if (sortSelect) {
      sortSelect.addEventListener("change", function () {
        currentSort = sortSelect.value;
        renderCatalog();
      });
    }

    // Поиск в каталоге
    function syncSearch(val) {
      query = normQuery(val);
      if (searchCatalogEl && searchCatalogEl.value !== val) searchCatalogEl.value = val;
      if (searchHeaderEl && searchHeaderEl.value !== val) searchHeaderEl.value = val;
      if (searchClearBtn) searchClearBtn.style.display = val ? "block" : "none";
      renderCatalog();
    }

    // Debounce перерисовки при вводе: каталог пересчитывается через 220 мс после
    // паузы в наборе (ES5, без зависимостей). Очистка по крестику/кнопке сброса
    // идёт через syncSearch напрямую и срабатывает мгновенно.
    var searchDebounceTimer = null;
    function scheduleSearch(inputEl, scrollIfNeeded) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(function () {
        syncSearch(inputEl.value);
        if (scrollIfNeeded) {
          var catSec = document.getElementById("catalog");
          if (catSec && query && window.scrollY < 300) {
            catSec.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }
      }, 220);
    }

    if (searchCatalogEl) {
      searchCatalogEl.addEventListener("input", function () {
        scheduleSearch(searchCatalogEl, false);
      });
    }

    if (searchHeaderEl) {
      searchHeaderEl.addEventListener("input", function () {
        scheduleSearch(searchHeaderEl, true);
      });
    }

    if (searchClearBtn) {
      searchClearBtn.addEventListener("click", function () {
        syncSearch("");
        if (searchHeaderEl) searchHeaderEl.focus();
      });
    }

    var resetBtn = document.getElementById("btn-reset-filters");
    if (resetBtn) {
      resetBtn.addEventListener("click", function () {
        activeCat = "all";
        syncSearch("");
        renderCategoryChips();
        renderCatalog();
      });
    }

    // Очистить корзину
    if (cartClearBtn) {
      cartClearBtn.addEventListener("click", function () {
        cart = {};
        saveCart();
        resetPromo(); // с корзиной уходит и скидка по промокоду
        renderCart();
        renderCatalog();
        toast("Корзина очищена");
      });
    }

    // Клик по корзине в шапке / мобильном баре
    var cartOpenBtn = document.getElementById("cart-open");
    if (cartOpenBtn) {
      cartOpenBtn.addEventListener("click", function (e) {
        e.preventDefault();
        openDrawer();
      });
    }
    var mcbBtn = document.getElementById("mcb-open-drawer");
    if (mcbBtn) {
      mcbBtn.addEventListener("click", function (e) {
        e.preventDefault();
        openDrawer();
      });
    }

    // Закрытие drawer
    var drawerCloseBtn = document.getElementById("drawer-close");
    if (drawerCloseBtn) drawerCloseBtn.addEventListener("click", closeDrawer);
    if (backdrop) backdrop.addEventListener("click", closeDrawer);

    // Кнопка из корзины "Перейти к оформлению"
    var drawerCheckoutBtn = document.getElementById("drawer-checkout-btn");
    if (drawerCheckoutBtn) {
      drawerCheckoutBtn.addEventListener("click", function () {
        closeDrawer();
        var orderSec = document.getElementById("order");
        if (orderSec) {
          orderSec.scrollIntoView({ behavior: "smooth", block: "start" });
          setTimeout(function () {
            var fName = document.getElementById("f-name");
            if (fName) fName.focus();
          }, 600);
        }
      });
    }

    // Заказ в WhatsApp из боковой корзины
    var drawerWaBtn = document.getElementById("drawer-wa-order");
    if (drawerWaBtn) {
      drawerWaBtn.addEventListener("click", function () {
        if (!cartCount()) { toast("Корзина пуста"); return; }
        var link = waLink(orderText(null));
        if (!link) { toast("WhatsApp-заказ временно недоступен — оформите через форму ниже"); return; }
        window.open(link, "_blank");
      });
    }

    // Глобальные клики: фасовки, избранное, инкремент, декремент, удаление
    document.addEventListener("click", function (e) {
      // Выбор фасовки на карточке: перерисовываем эту карточку с новым ключом
      var chip = e.target.closest(".pack-chip");
      if (chip) {
        chosenPack[chip.dataset.id] = chip.dataset.pack;
        var chipItem = findItem(chip.dataset.id);
        // Перерисовываем только конкретную карточку, а не весь каталог
        document.querySelectorAll(".card").forEach(function (c) {
          if (c.dataset.id === chip.dataset.id && chipItem) c.outerHTML = cardHtml(chipItem);
        });
        return;
      }

      // Сердечко «В избранное»: тогглим, показываем тост и анимацию
      var favBtn = e.target.closest("[data-fav]");
      if (favBtn) {
        var favId = favBtn.dataset.fav;
        if (favs[favId]) {
          delete favs[favId];
          toast("Убрано из избранного");
        } else {
          favs[favId] = 1;
          toast("Добавлено в избранное");
          favBtn.classList.add("fav-pop");
          setTimeout(function () { favBtn.classList.remove("fav-pop"); }, 400);
        }
        saveFavs();
        favBtn.classList.toggle("active", !!favs[favId]);
        updateFavChip();
        if (activeCat === "fav") renderCatalog(); // открыт фильтр «Избранное»
        return;
      }

      var add = e.target.closest(".add-btn");
      if (add) {
        addToCart(add.dataset.key);
        return;
      }

      var act = e.target.closest("[data-act]");
      if (act) {
        var key = act.dataset.key;
        var a = act.dataset.act;
        if (a === "inc") cart[key] = (cart[key] || 0) + 1;
        if (a === "dec") {
          cart[key] = (cart[key] || 0) - 1;
          if (cart[key] <= 0) delete cart[key];
        }
        if (a === "rm") delete cart[key];
        saveCart();
        renderCart();
        renderCatalog();
        return;
      }

      // Фото товара на весь экран
      var zoomImg = e.target.closest("[data-zoom]");
      if (zoomImg) {
        var zi = findItem(zoomImg.dataset.zoom);
        if (zi && needsPhoto(zi)) { toast("Фото этой позиции скоро заменим"); return; }
        openLightbox(zoomImg.dataset.zoom);
        return;
      }
      if (e.target.closest("#lightbox") && !e.target.closest(".lightbox-card")) { closeLightbox(); return; }

      // Модалка
      if (e.target.closest("#lightbox-close")) { closeLightbox(); return; }
      if (e.target.closest("#modal-close")) { closeModal(); return; }
      if (e.target === modal) { closeModal(); return; }

      // Бургер меню
      if (e.target.closest("#burger")) {
        var nav = document.getElementById("nav");
        if (nav) nav.classList.toggle("open");
      }
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { closeLightbox(); closeModal(); closeDrawer(); }
    });

    // Закрытие мобильного меню при клике по ссылке
    document.querySelectorAll(".nav-link").forEach(function (lnk) {
      lnk.addEventListener("click", function () {
        var nav = document.getElementById("nav");
        if (nav) nav.classList.remove("open");
      });
    });

    // Способ оплаты / доставки
    document.querySelectorAll(".radio-row").forEach(function (row) {
      row.addEventListener("change", function () {
        row.querySelectorAll(".radio-opt").forEach(function (o) {
          o.classList.toggle("sel", o.querySelector("input").checked);
        });
        if (row.id === "pay-opts") {
          var checked = row.querySelector("input:checked");
          payNote(checked ? checked.value : "");
        }
      });
    });

    // Отправка формы заказа
    var form = document.getElementById("order-form");
    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var name = form.querySelector("#f-name").value.trim();
        var phone = form.querySelector("#f-phone").value.trim();

        if (!name || !phone) {
          toast("Пожалуйста, заполните имя и телефон для связи");
          (!name ? form.querySelector("#f-name") : form.querySelector("#f-phone")).focus();
          return;
        }

        // Телефон должен содержать полный номер: +7 и 10 цифр = 11 цифр
        var phoneDigits = phone.replace(/\D/g, "");
        if (phoneDigits.length !== 11) {
          toast("Введите телефон полностью");
          form.querySelector("#f-phone").focus();
          return;
        }

        // Согласие на обработку персональных данных обязательно
        var consent = document.getElementById("f-consent");
        if (consent && !consent.checked) {
          toast("Отметьте согласие на обработку данных");
          return;
        }

        if (!cartCount()) {
          toast("Корзина пуста — сначала добавьте деликатесы в каталоге");
          var catSec = document.getElementById("catalog");
          if (catSec) catSec.scrollIntoView({ behavior: "smooth", block: "start" });
          return;
        }

        var data = {
          name: name,
          phone: phone,
          city: (form.querySelector("#f-city") || {}).value || "",
          delivery: (form.querySelector('input[name="delivery"]:checked') || {}).value || "",
          payment: (form.querySelector('input[name="payment"]:checked') || {}).value || "",
          comment: (form.querySelector("#f-comment") || {}).value || ""
        };

        var btn = document.getElementById("submit-btn");
        if (btn) { btn.disabled = true; btn.innerHTML = "<span>Оформляем заказ…</span>"; }

        submitOrder(data).then(function (res) {
          if (res && res.noChannel) {
            // Приём заказов сейчас недоступен (нет ни сервера, ни WhatsApp):
            // корзину и форму НЕ трогаем — покупатель не потеряет состав
            toast("Приём заказов временно недоступен — попробуйте позже");
            return;
          }
          cart = {};
          saveCart();
          resetPromo();          // скидка применена к заказу — сбрасываем
          clearCheckoutDraft();  // черновик формы больше не нужен
          renderCart();
          renderCatalog();
          form.reset();
          document.querySelectorAll(".radio-opt").forEach(function (o) {
            o.classList.toggle("sel", o.querySelector("input").checked);
          });

          // Онлайн-оплата: уводим покупателя на платёжную форму RollyPay
          if (res.channel === "online" && res.payUrl) {
            if (res.testMode) toast("Тестовый режим оплаты — деньги не списываются");
            window.location.href = res.payUrl;
            return;
          }

          if (res.paymentUnavailable) {
            toast("Заказ принят! Менеджер свяжется для оплаты.");
          }
          if (res.channel === "whatsapp" && res.link) {
            window.open(res.link, "_blank");
          }
          openModal(res.channel === "whatsapp" ? waLink(orderText(data)) : null);
        }).catch(function (err) {
          // Не теряем заказ: при любой ошибке сервера уводим покупателя в
          // WhatsApp с полным составом заказа (находка GUI-3).
          var waFallback = waLink(orderText(data));
          if (waFallback) {
            toast("Не удалось отправить через сайт — открываем WhatsApp");
            try { window.open(waFallback, "_blank"); } catch (e) { /* блокировщик попапов — остаётся модалка */ }
            openModal(waFallback);
          } else {
            toast("Не удалось отправить заказ — попробуйте ещё раз позже");
            openModal(null);
          }
        }).then(function () {
          if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<span>Подтвердить и отправить заказ</span><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg>';
          }
        });
      });
    }

    // Заказ в WhatsApp из блока на странице
    var waBtn = document.getElementById("wa-order");
    if (waBtn) {
      if (!waAvailable()) {
        // Номер магазина не задан: канал недоступен — прячем кнопку,
        // оформление остаётся через форму ниже
        waBtn.style.display = "none";
      } else {
        waBtn.addEventListener("click", function () {
          if (!cartCount()) { toast("Корзина пуста — выберите товары"); return; }
          window.open(waLink(orderText(null)), "_blank");
        });
      }
    }

    // Анимация снега
    if (SHOP.newYear) initSnow();
  }

  /* ---------- Снег ---------- */
  function initSnow() {
    var c = document.getElementById("snow");
    if (!c || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var ctx = c.getContext("2d");
    var flakes = [];
    var W, H;

    function resize() {
      W = c.width = window.innerWidth;
      H = c.height = window.innerHeight;
    }
    resize();
    window.addEventListener("resize", resize);

    for (var i = 0; i < 50; i++) {
      flakes.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: Math.random() * 2 + 0.6,
        s: Math.random() * 0.45 + 0.2,
        d: Math.random() * Math.PI * 2
      });
    }

    (function loop() {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "rgba(255,255,255,0.65)";
      flakes.forEach(function (f) {
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fill();
        f.y += f.s;
        f.x += Math.sin(f.d) * 0.35;
        f.d += 0.01;
        if (f.y > H) { f.y = -6; f.x = Math.random() * W; }
      });
      requestAnimationFrame(loop);
    })();
  }

  function boot() {
    var start = function () { init(); };
    if (typeof loadShopData === "function") {
      loadShopData().then(start).catch(start);
    } else {
      start();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  // Возврат на витрину из bfcache (кнопка «Назад» со страницы товара):
  // product.js пишет те же ключи localStorage — перечитываем и перерисовываем
  window.addEventListener("pageshow", function (e) {
    if (!e.persisted) return;
    try {
      cart = JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {};
      favs = {};
      JSON.parse(localStorage.getItem(FAV_KEY) || "[]").forEach(function (id) { favs[id] = 1; });
    } catch (err) {}
    try { renderCart(); } catch (err2) {}
    try { renderCatalog(); } catch (err3) {}
  });
})();
