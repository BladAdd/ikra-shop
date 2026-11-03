/* ==========================================================================
   Икра & Рыба — Страница товара (product.html?id=<itemId>).
   Загрузка каталога, рендер карточки товара, фасовки, корзина, избранное,
   похожие товары и SEO-разметка (JSON-LD).
   Стиль — как в assets/js/app.js: ES5-подобный, без стрелочных функций.
   ========================================================================== */

(function () {
  "use strict";

  /* ---------- Константы ---------- */
  var SITE_URL = "https://bladadd.github.io/ikra-shop/";
  var STORE_KEY = "caviar_cart_v1";
  var FAV_KEY = "caviar_fav_v1";
  var PACK_SEP = "::";
  var NEED_PHOTO = "__NEED_PHOTO__.jpg";
  var DEFAULT_WA = "79619200292";

  /* ---------- Утилиты ---------- */
  var money = function (n) {
    if (n == null) return "по запросу";
    return new Intl.NumberFormat("ru-RU").format(n) + " ₽";
  };

  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  /* ---------- Корзина (тот же контракт, что у витрины) ---------- */
  var cart = {};
  try {
    cart = JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {};
  } catch (e) { cart = {}; }

  function saveCart() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(cart)); } catch (e) {}
  }

  /* ---------- Избранное: JSON-массив id в localStorage ---------- */
  var favs = [];
  try {
    favs = JSON.parse(localStorage.getItem(FAV_KEY) || "[]");
  } catch (e) { favs = []; }
  if (!Array.isArray(favs)) favs = [];

  function saveFavs() {
    try { localStorage.setItem(FAV_KEY, JSON.stringify(favs)); } catch (e) {}
  }

  function isFav(id) {
    return favs.indexOf(id) !== -1;
  }

  function toggleFav(id) {
    var i = favs.indexOf(id);
    if (i === -1) favs.push(id);
    else favs.splice(i, 1);
    saveFavs();
    return isFav(id);
  }

  /* ---------- Фасовки: разбор цен (как в app.js) ---------- */
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

  /* Цена за килограмм фасовки (как в app.js): у весовых pack.price уже за кг,
     делим только у порционных (pack.price — цена упаковки). */
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

  /* Стоимость одной фасовки: по контракту — pack.total, иначе округлённая цена × кг */
  function packUnitPrice(it, pack) {
    if (pack.total != null) return pack.total;
    return Math.round(pack.price * kgOf(pack.weight));
  }

  /* ---------- Состояние страницы ---------- */
  var state = { item: null, cat: null, packWeight: null };

  function catalog() {
    if (Array.isArray(window.CATALOG) && window.CATALOG.length) return window.CATALOG;
    if (window.FALLBACK_DATA && Array.isArray(window.FALLBACK_DATA.catalog)) {
      return window.FALLBACK_DATA.catalog;
    }
    return [];
  }

  function shop() {
    if (window.SHOP && window.SHOP.name) return window.SHOP;
    if (window.FALLBACK_DATA && window.FALLBACK_DATA.shop) return window.FALLBACK_DATA.shop;
    return {};
  }

  function findProduct(id) {
    var cats = catalog();
    for (var i = 0; i < cats.length; i++) {
      var items = cats[i].items || [];
      for (var j = 0; j < items.length; j++) {
        if (items[j].id === id) return { item: items[j], cat: cats[i] };
      }
    }
    return null;
  }

  function getIdFromUrl() {
    try {
      var v = new URLSearchParams(location.search).get("id");
      if (v) return v;
    } catch (e) { /* старые браузеры — разберём вручную */ }
    var m = /[?&]id=([^&]+)/.exec(location.search || "");
    return m ? decodeURIComponent(m[1]) : "";
  }

  function needsPhoto(it) {
    return !!it && String(it.img || "").indexOf(NEED_PHOTO) !== -1;
  }

  /* Подпись цены: у весовых — за килограмм, у порционных — за фасовку */
  function priceCaption(it) {
    if (!it) return "";
    if (it.unit === "кг" && it.piece) return it.weight ? "за " + it.weight : "за упаковку";
    if (it.unit === "кг") return "за 1 кг";
    if (it.unit === "шт" && it.weight && /^\d+\s*шт$/.test(it.weight)) return "за упаковку " + it.weight;
    if (it.weight) return "за " + it.weight;
    return it.unit ? "за 1 " + it.unit : "";
  }

  /* Ключ корзины: выбранная фасовка или сам товар */
  function cartKey() {
    var it = state.item;
    if (!it) return "";
    return state.packWeight ? it.id + PACK_SEP + state.packWeight : it.id;
  }

  /* Ссылка на WhatsApp с текстом про конкретный товар */
  function waHref() {
    var it = state.item;
    if (!it) return "https://wa.me/" + DEFAULT_WA;
    var w = state.packWeight || it.weight || "";
    var text = "Здравствуйте! Интересует " + it.name + (w ? " (" + w + ")" : "") +
      " — подскажите наличие и доставку";
    return "https://wa.me/" + (shop().whatsapp || DEFAULT_WA) + "?text=" + encodeURIComponent(text);
  }

  /* ---------- SEO: title, description, JSON-LD ---------- */
  function setMetaDescription(text) {
    var md = document.querySelector('meta[name="description"]');
    if (md) md.setAttribute("content", text);
  }

  /* Open Graph под конкретный товар — превью в WhatsApp/Telegram (находка W3-P2) */
  function setOg(attr, key, content) {
    var el = document.querySelector('meta[' + attr + '="' + key + '"]');
    if (!el) {
      el = document.createElement("meta");
      el.setAttribute(attr, key);
      document.head.appendChild(el);
    }
    el.setAttribute("content", content);
  }

  /* canonical под товар (находка R6v2) */
  function setCanonical(url) {
    var el = document.querySelector('link[rel="canonical"]');
    if (!el) {
      el = document.createElement("link");
      el.setAttribute("rel", "canonical");
      document.head.appendChild(el);
    }
    el.setAttribute("href", url);
  }

  function putLd(id, obj) {
    var old = document.getElementById(id);
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var s = document.createElement("script");
    s.type = "application/ld+json";
    s.id = id;
    s.textContent = JSON.stringify(obj);
    document.head.appendChild(s);
  }

  function productUrl(it) {
    return SITE_URL + "product.html?id=" + encodeURIComponent(it.id);
  }

  function updateSeo(it, cat) {
    document.title = it.name + " — Икра & Рыба";
    setMetaDescription(it.desc || "Деликатес от «Икра & Рыба» с доставкой по Москве и России.");

    // Картинка для JSON-LD и OG: у заглушки — фирменный герой (находка W3-P1)
    var ldImg = needsPhoto(it) ? SITE_URL + "assets/img/hero-caviar.jpg" : SITE_URL + it.img;

    // OG-превью под товар (шаринг в WhatsApp — главный канал магазина)
    setOg("property", "og:title", it.name + " — Икра & Рыба");
    setOg("property", "og:description", it.desc || "Деликатес с доставкой по Москве и России.");
    setOg("property", "og:image", ldImg);
    setOg("property", "og:url", productUrl(it));

    // JSON-LD: товар (offers — только если есть цена)
    var pd = {
      "@context": "https://schema.org",
      "@type": "Product",
      "name": it.name,
      "image": ldImg,
      "description": it.desc || "",
      "category": cat.title,
      "url": productUrl(it)
    };
    if (it.price != null) {
      pd.offers = {
        "@type": "Offer",
        "price": String(it.price),
        "priceCurrency": "RUB",
        "availability": "https://schema.org/InStock",
        "url": productUrl(it)
      };
    }
    putLd("ld-product", pd);

    // JSON-LD: хлебные крошки
    putLd("ld-breadcrumbs", {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Главная", "item": SITE_URL },
        { "@type": "ListItem", "position": 2, "name": cat.title, "item": SITE_URL + "index.html#catalog" },
        { "@type": "ListItem", "position": 3, "name": it.name, "item": productUrl(it) }
      ]
    });
  }

  /* ---------- SVG-иконки ---------- */
  var HEART_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';

  var WA_SVG = '<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/></svg>';

  var CAMERA_SVG = '<svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>';

  var CART_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>';

  /* ---------- Блоки разметки ---------- */
  function badgesHtml(it) {
    var out = "";
    if (it.badge) {
      var hot = /хит|осталось|свеж/i.test(it.badge);
      out += '<span class="badge' + (hot ? " hot" : "") + '">' + esc(it.badge) + "</span>";
    }
    if (it.oldPrice && it.price && it.oldPrice > it.price) {
      var pct = Math.round((1 - it.price / it.oldPrice) * 100);
      out += '<span class="badge-discount">−' + pct + "%</span>";
    }
    return out;
  }

  /* Цена + сердечко + подпись фасовки + чипы фасовок.
     До клика по чипу визуально активна дефолтная фасовка (как на витрине),
     но ключ корзины остаётся "<id>", пока пользователь не выбрал чип. */
  function priceAreaHtml(it) {
    var packs = Array.isArray(it.packs) ? it.packs : [];
    var hasChips = packs.length >= 2;
    // Дефолтный чип — фасовка, совпадающая с весом товара
    var defaultWeight = hasChips && findPack(it, it.weight) ? it.weight : null;
    var activeWeight = state.packWeight || defaultWeight;
    // Фасовка для отображения цены — только когда чипы показаны
    var displayPack = hasChips ? findPack(it, activeWeight) : null;

    var html = '<div class="product-price-row">';

    if (it.price == null) {
      html += '<div class="product-price">Цена по запросу</div>';
    } else if (displayPack) {
      // Выбрана фасовка: у весовых показываем цену за кг, у порционных — за фасовку
      if (it.unit === "кг" && !it.piece) {
        html += '<div class="product-price">' + money(Math.round(packPricePerKg(it, displayPack))) +
          '<span class="per">/ за 1 кг</span>' +
          (it.oldPrice ? '<span class="old">' + money(it.oldPrice) + "</span>" : "") +
          "</div>";
      } else {
        html += '<div class="product-price">' + money(packUnitPrice(it, displayPack)) +
          '<span class="per">/ за ' + esc(displayPack.weight) + "</span>" +
          (it.oldPrice ? '<span class="old">' + money(it.oldPrice) + "</span>" : "") +
          "</div>";
      }
    } else {
      html += '<div class="product-price">' + money(it.price) +
        (priceCaption(it) ? '<span class="per">/ ' + esc(priceCaption(it)) + "</span>" : "") +
        (it.oldPrice ? '<span class="old">' + money(it.oldPrice) + "</span>" : "") +
        "</div>";
    }

    // Сердечко избранного — рядом с ценой
    html += '<button type="button" id="p-fav" class="fav-btn' + (isFav(it.id) ? " active" : "") +
      '" aria-label="В избранное">' + HEART_SVG + "</button>";

    html += "</div>"; // конец .product-price-row

    // Цена по запросу: акцент с быстрым контактом
    if (it.price == null) {
      html += '<div class="price-null-note"><span>Уточним в WhatsApp за минуту — ' +
        '<a href="' + esc(waHref()) + '" target="_blank" rel="noopener">напишите нам</a></span></div>';
    }

    // Подпись активной фасовки: «за фасовку X — Y ₽»
    if (displayPack && it.price != null) {
      html += '<div class="pack-chip-note">за фасовку ' + esc(displayPack.weight) + " — " +
        money(packUnitPrice(it, displayPack)) + "</div>";
    }

    // Чипы фасовок — при двух и более фасовках
    if (hasChips) {
      // Самая выгодная фасовка — с минимальной ценой за килограмм
      var best = null;
      packs.forEach(function (p) {
        var per = packPricePerKg(it, p);
        if (!best || per < packPricePerKg(it, best)) best = p;
      });

      html += '<div class="pack-chips">';
      packs.forEach(function (p) {
        html += '<button type="button" class="pack-chip' +
          (activeWeight === p.weight ? " active" : "") +
          (best && p.weight === best.weight ? " best" : "") +
          '" data-pack="' + esc(p.weight) + '">' + esc(p.weight) + "</button>";
      });
      html += "</div>";
    }

    return html;
  }

  function productHtml(it, cat) {
    var imgHtml;
    if (needsPhoto(it)) {
      // Стильная заглушка вместо изображения — табличку «фото нужно» не показываем
      imgHtml = '<div class="product-imgbox is-need">' +
        '<div class="product-need-plate">' + CAMERA_SVG +
        "<b>Фото скоро появится</b>" +
        "<small>Покажем товар в WhatsApp по запросу</small>" +
        "</div></div>";
    } else {
      imgHtml = '<div class="product-imgbox">' +
        '<img src="' + esc(it.img) + '" alt="' + esc(it.name) + '" ' +
        'onerror="this.onerror=null;this.src=\'assets/img/hero-caviar.jpg\'">' +
        (it.weight ? '<span class="card-photo-weight">' + esc(it.weight) + "</span>" : "") +
        "</div>";
    }

    return '' +
      '<nav class="crumbs" aria-label="Хлебные крошки">' +
        '<a href="index.html">Главная</a><span class="sep">/</span>' +
        '<a href="index.html#catalog">' + esc(cat.title) + "</a><span class=\"sep\">/</span>" +
        "<span>" + esc(it.name) + "</span>" +
      "</nav>" +
      '<div class="product-grid">' +
        imgHtml +
        '<div class="product-info">' +
          (badgesHtml(it) ? '<div class="product-badges">' + badgesHtml(it) + "</div>" : "") +
          "<h1>" + esc(it.name) + "</h1>" +
          '<div id="p-price-area">' + priceAreaHtml(it) + "</div>" +
          '<div class="product-actions" id="p-actions">' +
            '<button type="button" id="p-add" class="btn btn-gold btn-lg">' + CART_SVG + "<span>В корзину</span></button>" +
            '<a id="p-wa" class="btn btn-green btn-lg" href="' + esc(waHref()) + '" target="_blank" rel="noopener">' +
              WA_SVG + "<span>Спросить в WhatsApp</span></a>" +
          "</div>" +
          '<p class="product-desc">' + esc(it.desc || "") + "</p>" +
          '<div class="product-delivery">' +
            '<div class="pd-row"><span class="pd-ico">🚚</span><span><b>Москва и МО</b> — доставка от 2 часов, бесплатно от ' +
              money((shop() && shop().freeFrom) || 5000) + "</span></div>" +
            '<div class="pd-row"><span class="pd-ico">❄️</span><span><b>Россия</b> — отправка в термобоксе курьером СДЭК</span></div>' +
            '<div class="pd-row"><span class="pd-ico">💳</span><span><b>Оплата</b> — при получении или по ссылке</span></div>' +
          "</div>" +
        "</div>" +
      "</div>";
  }

  function notFoundHtml() {
    return '' +
      '<div class="product-notfound">' +
        '<div style="font-size:2.6rem;margin-bottom:14px">🐟</div>' +
        "<h1>Товар не найден</h1>" +
        '<p style="color:var(--muted);margin:12px 0 26px">Возможно, позиция распродана или ссылка устарела — ' +
        "загляните в каталог, там много вкусного.</p>" +
        '<a class="btn btn-gold btn-lg" href="index.html#catalog">Весь каталог</a>' +
      "</div>";
  }

  /* ---------- Похожие товары ---------- */
  function relatedCardHtml(it) {
    var priceStr = it.price == null
      ? "По запросу"
      : money(it.price) + (priceCaption(it) ? "<small>" + esc(priceCaption(it)) + "</small>" : "");

    var imgHtml = needsPhoto(it)
      ? '<div class="related-need"><span class="rn-ico">🐟</span><span>Фото скоро появится</span></div>'
      : '<img src="' + esc(it.img) + '" alt="' + esc(it.name) + '" loading="lazy" ' +
        'onerror="this.onerror=null;this.src=\'assets/img/hero-caviar.jpg\'">';

    return '' +
      '<a class="related-card" href="product.html?id=' + encodeURIComponent(it.id) + '">' +
        '<div class="related-card-img">' + imgHtml + "</div>" +
        '<div class="related-card-body">' +
          "<h4>" + esc(it.name) + "</h4>" +
          '<div class="rc-price">' + priceStr + "</div>" +
        "</div>" +
      "</a>";
  }

  function renderRelated(it, cat) {
    var box = document.getElementById("related-root");
    if (!box) return;
    var items = (cat.items || []).filter(function (x) { return x.id !== it.id; }).slice(0, 8);
    if (!items.length) { box.hidden = true; return; }
    box.innerHTML =
      '<h3 class="related-title">Похожие деликатесы</h3>' +
      '<div class="related-grid">' + items.map(relatedCardHtml).join("") + "</div>";
    box.hidden = false;
  }

  /* ---------- Перерисовка ценовой зоны при смене фасовки ---------- */
  function refreshPriceArea() {
    var it = state.item;
    if (!it) return;
    var area = document.getElementById("p-price-area");
    if (area) area.innerHTML = priceAreaHtml(it);
    var wa = document.getElementById("p-wa");
    if (wa) wa.href = waHref();
  }

  /* ---------- Обработчики ---------- */
  function bindEvents() {
    var area = document.getElementById("p-price-area");
    if (area) {
      area.addEventListener("click", function (e) {
        // Смена фасовки
        var chip = e.target.closest(".pack-chip");
        if (chip) {
          state.packWeight = chip.getAttribute("data-pack") || null;
          refreshPriceArea();
          return;
        }
        // Избранное
        var fav = e.target.closest("#p-fav");
        if (fav && state.item) {
          var on = toggleFav(state.item.id);
          fav.classList.toggle("active", on);
        }
      });
    }

    // Добавление в корзину
    var addBtn = document.getElementById("p-add");
    if (addBtn) {
      addBtn.addEventListener("click", function () {
        if (!state.item) return;
        var key = cartKey();
        if (!key) return;
        cart[key] = (cart[key] || 0) + 1;
        saveCart();

        // Кнопка превращается в «Добавлено ✓» + ссылка «Перейти в корзину»
        if (!addBtn.classList.contains("add-done")) {
          addBtn.classList.add("add-done");
          addBtn.innerHTML = "<span>Добавлено ✓</span>";
          var link = document.createElement("a");
          link.className = "go-cart-link";
          link.href = "index.html#order";
          link.innerHTML = "Перейти в корзину →";
          addBtn.parentNode.insertBefore(link, addBtn.nextSibling);
        } else {
          // повторный клик — просто ещё одна единица
          addBtn.innerHTML = "<span>Добавлено ✓ (" + cart[key] + ")</span>";
        }
      });
    }
  }

  /* ---------- Товар не найден ---------- */
  function renderNotFound(id) {
    var root = document.getElementById("product-root");
    if (root) root.innerHTML = notFoundHtml();
    var rel = document.getElementById("related-root");
    if (rel) rel.hidden = true;
    document.title = "Товар не найден — Икра & Рыба";
    setMetaDescription("Такого товара нет в магазине «Икра & Рыба». Посмотрите весь каталог деликатесов.");
    // Убираем возможные старые JSON-LD
    putLd("ld-breadcrumbs", {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Главная", "item": SITE_URL },
        { "@type": "ListItem", "position": 2, "name": "Каталог", "item": SITE_URL + "index.html#catalog" }
      ]
    });
    if (id) console.warn("Товар не найден в каталоге:", id);
  }

  /* ---------- Отрисовка страницы ---------- */
  function renderPage() {
    var id = getIdFromUrl();
    var found = id ? findProduct(id) : null;

    if (!found) {
      renderNotFound(id);
      return;
    }

    state.item = found.item;
    state.cat = found.cat;
    state.packWeight = null; // до клика по чипу корзина живёт ключом товара (как на витрине)

    var root = document.getElementById("product-root");
    if (root) root.innerHTML = productHtml(found.item, found.cat);

    renderRelated(found.item, found.cat);
    updateSeo(found.item, found.cat);
    bindEvents();
  }

  /* ---------- Загрузка данных ---------- */
  function loadCatalog() {
    // data.js умеет сам: fetch("data/catalog.json?v=…") → при ошибке FALLBACK_DATA,
    // на file:// сразу встроенный каталог.
    if (typeof loadShopData === "function") {
      return loadShopData().then(function () { return true; });
    }
    // Резервный путь, если data.js не подключён
    return fetch("data/catalog.json?v=" + Date.now(), { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (d) {
        window.CATALOG = Array.isArray(d.catalog) ? d.catalog : [];
        window.SHOP = d.shop || {};
        return true;
      })
      .catch(function () {
        if (window.FALLBACK_DATA) {
          window.CATALOG = window.FALLBACK_DATA.catalog || [];
          window.SHOP = window.FALLBACK_DATA.shop || {};
        }
        return false;
      });
  }

  /* ---------- Инициализация ---------- */
  function init() {
    var yr = document.getElementById("foot-year");
    if (yr) yr.textContent = new Date().getFullYear();

    loadCatalog().then(function () {
      renderPage();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
