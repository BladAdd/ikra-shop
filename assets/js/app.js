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
    return Object.keys(cart).map(function (id) {
      var it = findItem(id);
      if (!it) return null;
      return { item: it, qty: cart[id] };
    }).filter(Boolean);
  }

  function cartCount() {
    return Object.keys(cart).reduce(function (s, k) { return s + cart[k]; }, 0);
  }

  function cartSum() {
    var lines = cartLines();
    var hasPrice = lines.some(function (l) { return l.item.price != null; });
    if (!hasPrice) return null;
    return lines.reduce(function (s, l) {
      return s + (l.item.price == null ? 0 : l.item.price * l.qty);
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

  function priceHtml(it) {
    if (it.price == null) {
      return '<div class="price">По запросу<small>уточним при заказе</small></div>';
    }
    var old = it.oldPrice ? '<span class="old">' + money(it.oldPrice) + "</span>" : "";
    var unitStr = "";
    if (it.weight) {
      unitStr = "за " + esc(it.weight);
    } else if (it.unit) {
      unitStr = "за 1 " + esc(it.unit);
    }
    return '<div class="price">' + money(it.price) + old + (unitStr ? "<small>" + unitStr + "</small>" : "") + "</div>";
  }

  function cardHtml(it) {
    var inCart = cart[it.id] || 0;
    var actionBtnHtml = inCart > 0
      ? '<div class="card-stepper">' +
          '<button type="button" data-act="dec" data-id="' + esc(it.id) + '" aria-label="Меньше">−</button>' +
          '<span class="count">' + inCart + "</span>" +
          '<button type="button" data-act="inc" data-id="' + esc(it.id) + '" aria-label="Больше">+</button>' +
        "</div>"
      : '<button class="btn btn-gold btn-sm add-btn" data-id="' + esc(it.id) + '">' +
          '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>' +
          "<span>В корзину</span>" +
        "</button>";

    return '' +
      '<article class="card" data-id="' + esc(it.id) + '">' +
        '<div class="card-img">' +
          badgeHtml(it.badge, it) +
          '<img src="' + esc(it.img) + '" alt="' + esc(it.name) + '" loading="lazy" onerror="this.src=\'assets/img/hero-caviar.jpg\'">' +
        '</div>' +
        '<div class="card-body">' +
          "<h4>" + esc(it.name) + "</h4>" +
          '<div class="card-meta">' +
            (it.weight ? '<span class="card-weight-tag">' + esc(it.weight) + "</span>" : "") +
          "</div>" +
          '<p class="card-desc">' + esc(it.desc || "Свежий деликатес высшего сорта с натуральным вкусом.") + "</p>" +
          '<div class="card-foot">' +
            priceHtml(it) +
            actionBtnHtml +
          "</div>" +
        "</div>" +
      "</article>";
  }

  function matches(it) {
    if (activeCat !== "all" && it.catId !== activeCat) return false;
    if (!query) return true;
    var hay = (it.name + " " + (it.desc || "") + " " + (it.tags || "") + " " + (it.weight || "")).toLowerCase();
    return hay.indexOf(query) !== -1;
  }

  function matchScore(it, q) {
    if (!q) return 0;
    var name = (it.name || "").toLowerCase();
    var tags = (it.tags || "").toLowerCase();
    var desc = (it.desc || "").toLowerCase();
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
      var sum = it.price == null ? "—" : money(it.price * l.qty);
      return '' +
        '<div class="cart-line">' +
          '<img src="' + esc(it.img) + '" alt="' + esc(it.name) + '" onerror="this.src=\'assets/img/hero-caviar.jpg\'">' +
          "<div>" +
            '<div class="nm">' + esc(it.name) + (it.weight ? "<small>" + esc(it.weight) + "</small>" : "") + "</div>" +
            '<div class="qty">' +
              '<button type="button" data-act="dec" data-id="' + esc(it.id) + '" aria-label="Меньше">−</button>' +
              "<span>" + l.qty + "</span>" +
              '<button type="button" data-act="inc" data-id="' + esc(it.id) + '" aria-label="Больше">+</button>' +
            "</div>" +
          "</div>" +
          '<div style="text-align:right">' +
            '<div class="ln-sum">' + sum + "</div>" +
            '<button type="button" class="rm" data-act="rm" data-id="' + esc(it.id) + '">удалить</button>' +
          "</div>" +
        "</div>";
    }).join("");
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
      return;
    }

    var linesContent = '<div class="cart-lines">' + linesHtml(lines) + "</div>";
    if (cartBody) cartBody.innerHTML = linesContent;
    if (drawerBody) drawerBody.innerHTML = linesContent;

    if (cartTotal) cartTotal.style.display = "grid";
    if (drawerFooter) drawerFooter.style.display = "block";

    if (cartSubtotalVal) cartSubtotalVal.textContent = sumStr;
    if (cartSumEl) cartSumEl.textContent = sumStr;
    if (drawerSumEl) drawerSumEl.textContent = sumStr;
  }

  function addToCart(id) {
    cart[id] = (cart[id] || 0) + 1;
    saveCart();
    renderCart();
    renderCatalog();
    var it = findItem(id);
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
        var sum = it.price == null ? "цена по запросу" : money(it.price * l.qty);
        out.push("• " + it.name + (it.weight ? " (" + it.weight + ")" : "") + " × " + l.qty + " = " + sum);
      });
      var s = cartSum();
      out.push("--------------------------------------");
      out.push("ИТОГО ЗА ТОВАРЫ: " + (s == null ? "уточняется" : money(s)));
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
    var phone = SHOP.whatsapp || "79619200292";
    return "https://wa.me/" + phone + "?text=" + encodeURIComponent(text);
  }

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
    var canUseApi = typeof API !== "undefined" && API.base !== undefined;
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
          items: cartLines().map(function (l) { return { id: l.item.id, qty: l.qty }; }),
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
        items: cartLines().map(function (l) { return { id: l.item.id, qty: l.qty }; }),
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
            return { id: l.item.id, name: l.item.name, weight: l.item.weight, qty: l.qty, price: l.item.price };
          }),
          total: cartSum()
        }))
      }).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return { ok: true, channel: "server" };
      });
    }

    return Promise.resolve({ ok: true, channel: "whatsapp", link: waLink(text) });
  }

  var modal = document.getElementById("modal");
  function openModal(link) {
    if (!modal) return;
    var wa = document.getElementById("modal-wa");
    if (wa) {
      wa.href = link || waLink(orderText(null));
      wa.style.display = "inline-flex";
    }
    modal.classList.add("on");
  }
  function closeModal() { if (modal) modal.classList.remove("on"); }

  /* ---------- Инициализация ---------- */
  function init() {
    var set = function (id, val) { var e = document.getElementById(id); if (e && val) e.textContent = val; };
    set("tb-delivery", SHOP.delivery || "Доставка курьером по Москве и МО от 2 часов");
    set("tb-hours", SHOP.workHours || "Ежедневно 9:00 — 21:00");
    set("foot-hours", SHOP.workHours || "Ежедневно 9:00 — 21:00");
    
    var yr = document.getElementById("year");
    if (yr) yr.textContent = new Date().getFullYear();

    var legal = [];
    if (SHOP.legalName) legal.push(SHOP.legalName);
    if (SHOP.inn) legal.push("ИНН " + SHOP.inn);
    if (SHOP.ogrnip) legal.push("ОГРНИП " + SHOP.ogrnip);
    var legalStr = legal.join(" · ");
    set("foot-requisites", legalStr);

    var fw = document.getElementById("float-wa");
    if (fw) fw.href = waLink("Здравствуйте! Хочу уточнить ассортимент и оформить заказ на деликатесы.");

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
      query = val.trim().toLowerCase();
      if (searchCatalogEl && searchCatalogEl.value !== val) searchCatalogEl.value = val;
      if (searchHeaderEl && searchHeaderEl.value !== val) searchHeaderEl.value = val;
      if (searchClearBtn) searchClearBtn.style.display = val ? "block" : "none";
      renderCatalog();
    }

    if (searchCatalogEl) {
      searchCatalogEl.addEventListener("input", function () {
        syncSearch(searchCatalogEl.value);
      });
    }

    if (searchHeaderEl) {
      searchHeaderEl.addEventListener("input", function () {
        syncSearch(searchHeaderEl.value);
        var catSec = document.getElementById("catalog");
        if (catSec && query && window.scrollY < 300) {
          catSec.scrollIntoView({ behavior: "smooth", block: "start" });
        }
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
        window.open(waLink(orderText(null)), "_blank");
      });
    }

    // Глобальные клики: инкремент, декремент, удаление
    document.addEventListener("click", function (e) {
      var add = e.target.closest(".add-btn");
      if (add) {
        addToCart(add.dataset.id);
        return;
      }

      var act = e.target.closest("[data-act]");
      if (act) {
        var id = act.dataset.id;
        var a = act.dataset.act;
        if (a === "inc") cart[id] = (cart[id] || 0) + 1;
        if (a === "dec") {
          cart[id] = (cart[id] || 0) - 1;
          if (cart[id] <= 0) delete cart[id];
        }
        if (a === "rm") delete cart[id];
        saveCart();
        renderCart();
        renderCatalog();
        return;
      }

      // Модалка
      if (e.target.closest("#modal-close")) { closeModal(); return; }
      if (e.target === modal) { closeModal(); return; }

      // Бургер меню
      if (e.target.closest("#burger")) {
        var nav = document.getElementById("nav");
        if (nav) nav.classList.toggle("open");
      }
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
          cart = {};
          saveCart();
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
          toast(err && err.message ? err.message : "Не удалось отправить заказ");
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
      waBtn.addEventListener("click", function () {
        if (!cartCount()) { toast("Корзина пуста — выберите товары"); return; }
        window.open(waLink(orderText(null)), "_blank");
      });
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
})();
