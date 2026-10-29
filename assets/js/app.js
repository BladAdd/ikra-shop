/* ==========================================================================
   Икра — логика сайта: каталог, корзина, заказ, оплата.
   Настройки магазина и товары лежат в products.js
   ========================================================================== */

(function () {
  "use strict";

  /* ---------- ОПЛАТА -------------------------------------------------------
     Провайдер задаётся в products.js (PAYMENTS). Пока ключей нет, работает
     режим "по ссылке": заказ уходит менеджеру, он присылает ссылку на оплату.
     Когда появятся shopId/ключи — включается онлайн-оплата.
  ------------------------------------------------------------------------- */
  var PAY = (typeof PAYMENTS !== "undefined") ? PAYMENTS : { provider: "link" };

  var money = function (n) {
    return new Intl.NumberFormat("ru-RU").format(n) + " ₽";
  };

  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  /* ---------- состояние корзины ---------- */
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
    CATALOG.forEach(function (cat) {
      cat.items.forEach(function (it) {
        out.push(Object.assign({ catId: cat.id, catTitle: cat.title }, it));
      });
    });
    return out;
  }

  function findItem(id) {
    return allItems().filter(function (i) { return i.id === id; })[0] || null;
  }

  function priceOf(it) {
    if (it.price == null) return null;
    return it.unit === "кг" ? it.price : it.price;
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

  /* ---------- тост ---------- */
  var toastEl = document.getElementById("toast");
  var toastT = null;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add("on");
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.remove("on"); }, 2200);
  }

  /* ---------- отрисовка каталога ---------- */
  var root = document.getElementById("catalog-root");
  var emptyEl = document.getElementById("catalog-empty");
  var filtersEl = document.getElementById("filters");
  var searchEl = document.getElementById("search");
  var activeCat = "all";
  var query = "";

  function badgeHtml(b) {
    if (!b) return "";
    var hot = /хит|осталось/i.test(b);
    return '<span class="badge' + (hot ? " hot" : "") + '">' + esc(b) + "</span>";
  }

  function priceHtml(it) {
    if (it.price == null) {
      return '<div class="price">По запросу<small>цену уточним при заказе</small></div>';
    }
    var old = it.oldPrice ? '<span class="old">' + money(it.oldPrice) + "</span>" : "";
    var unit = it.unit === "кг" ? " за кг" : "";
    return '<div class="price">' + money(it.price) + old + "<small>за " + esc(it.weight) + unit + "</small></div>";
  }

  function cardHtml(it) {
    var inCart = cart[it.id] || 0;
    return '' +
      '<article class="card" data-id="' + esc(it.id) + '">' +
        '<div class="card-img">' + badgeHtml(it.badge) +
          '<img src="' + esc(it.img) + '" alt="' + esc(it.name) + '" loading="lazy">' +
        '</div>' +
        '<div class="card-body">' +
          "<h4>" + esc(it.name) + "</h4>" +
          '<div class="card-weight">' + esc(it.weight) + "</div>" +
          '<p class="card-desc">' + esc(it.desc) + "</p>" +
          '<div class="card-foot">' +
            priceHtml(it) +
            '<button class="btn btn-gold btn-sm add-btn" data-id="' + esc(it.id) + '">' +
              (inCart ? "В корзине " + inCart : "В корзину") +
            "</button>" +
          "</div>" +
        "</div>" +
      "</article>";
  }

  function matches(it) {
    if (activeCat !== "all" && it.catId !== activeCat) return false;
    if (!query) return true;
    var hay = (it.name + " " + it.desc + " " + (it.tags || "") + " " + it.weight).toLowerCase();
    return hay.indexOf(query) !== -1;
  }

  function renderCatalog() {
    if (!root) return;
    var html = "";
    var total = 0;

    CATALOG.forEach(function (cat) {
      var items = cat.items
        .map(function (i) { return Object.assign({ catId: cat.id }, i); })
        .filter(matches);
      if (!items.length) return;
      total += items.length;
      html += '<div class="cat-head"><h3>' + esc(cat.title) + "</h3><span>" + esc(cat.subtitle) + "</span></div>";
      html += '<div class="grid">' + items.map(cardHtml).join("") + "</div>";
    });

    root.innerHTML = html;
    if (emptyEl) emptyEl.style.display = total ? "none" : "block";
  }

  function renderFilters() {
    if (!filtersEl) return;
    var chips = ['<button class="chip active" data-cat="all">Всё</button>'];
    CATALOG.forEach(function (c) {
      chips.push('<button class="chip" data-cat="' + esc(c.id) + '">' + esc(c.title) + "</button>");
    });
    filtersEl.insertAdjacentHTML("afterbegin", chips.join(""));
  }

  /* ---------- корзина: отрисовка ---------- */
  var cartBody = document.getElementById("cart-body");
  var cartTotal = document.getElementById("cart-total");
  var cartSumEl = document.getElementById("cart-sum");
  var cartCountEl = document.getElementById("cart-count");
  var cartQtyLabel = document.getElementById("cart-qty-label");

  function renderCart() {
    var lines = cartLines();
    var n = cartCount();

    if (cartCountEl) {
      cartCountEl.textContent = n;
      cartCountEl.classList.toggle("on", n > 0);
    }
    if (cartQtyLabel) cartQtyLabel.textContent = n ? "(" + n + " поз.)" : "";

    if (!cartBody) return;

    if (!lines.length) {
      cartBody.innerHTML = '<div class="cart-empty">Корзина пуста.<br>Добавьте позиции из каталога.</div>';
      if (cartTotal) cartTotal.style.display = "none";
      return;
    }

    cartBody.innerHTML = '<div class="cart-lines">' + lines.map(function (l) {
      var it = l.item;
      var sum = it.price == null ? "—" : money(it.price * l.qty);
      return '' +
        '<div class="cart-line">' +
          '<img src="' + esc(it.img) + '" alt="' + esc(it.name) + '">' +
          "<div>" +
            '<div class="nm">' + esc(it.name) + "<small>" + esc(it.weight) + "</small></div>" +
            '<div class="qty">' +
              '<button data-act="dec" data-id="' + esc(it.id) + '" aria-label="Меньше">−</button>' +
              "<span>" + l.qty + "</span>" +
              '<button data-act="inc" data-id="' + esc(it.id) + '" aria-label="Больше">+</button>' +
            "</div>" +
          "</div>" +
          '<div style="text-align:right">' +
            '<div class="ln-sum">' + sum + "</div>" +
            '<button class="rm" data-act="rm" data-id="' + esc(it.id) + '">удалить</button>' +
          "</div>" +
        "</div>";
    }).join("") + "</div>";

    var sum = cartSum();
    if (cartTotal) cartTotal.style.display = "flex";
    if (cartSumEl) {
      cartSumEl.textContent = sum == null ? "по запросу" : money(sum);
    }
  }

  function addToCart(id) {
    cart[id] = (cart[id] || 0) + 1;
    saveCart();
    renderCart();
    renderCatalog();
    var it = findItem(id);
    toast("Добавлено: " + (it ? it.name : "товар"));
  }

  /* ---------- состав заказа текстом ---------- */
  function orderText(form) {
    var lines = cartLines();
    var out = [];
    out.push("ЗАКАЗ — " + SHOP.name);
    out.push("");
    if (lines.length) {
      lines.forEach(function (l) {
        var it = l.item;
        var sum = it.price == null ? "цена по запросу" : money(it.price * l.qty);
        out.push("• " + it.name + " (" + it.weight + ") × " + l.qty + " = " + sum);
      });
      var s = cartSum();
      out.push("");
      out.push("Итого: " + (s == null ? "уточняется" : money(s)));
    } else {
      out.push("(корзина пуста — клиент уточнит состав)");
    }
    out.push("");
    if (form) {
      out.push("Имя: " + (form.name || "—"));
      out.push("Телефон: " + (form.phone || "—"));
      out.push("Город/адрес: " + (form.city || "—"));
      out.push("Получение: " + (form.delivery || "—"));
      out.push("Оплата: " + (form.payment || "—"));
      if (form.comment) out.push("Комментарий: " + form.comment);
    }
    return out.join("\n");
  }

  function waLink(text) {
    return "https://wa.me/" + SHOP.whatsapp + "?text=" + encodeURIComponent(text);
  }

  /* ---------- оплата ---------- */
  function payNote(payment) {
    var note = document.getElementById("pay-note");
    if (!note) return;
    if (payment === "Оплата при получении") {
      note.textContent = "Оплата курьеру при получении: наличными или картой. Менеджер подтвердит сумму заранее.";
    } else if (payment === "Перевод по реквизитам") {
      note.textContent = "Реквизиты для перевода (СБП или на счёт ИП) пришлём после подтверждения заказа.";
    } else if (PAY.provider === "link") {
      note.textContent = "После подтверждения заказа пришлём персональную ссылку на оплату — картой или через СБП.";
    } else {
      note.textContent = "Оплата проходит на защищённой странице платёжного сервиса. Ссылку пришлём после подтверждения.";
    }
  }

  /* ---------- отправка заказа ---------- */
  function submitOrder(formData) {
    var text = orderText(formData);

    // 1) если настроен приём заказов на сервер (Formspree / свой endpoint)
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

    // 2) иначе — заказ уходит в WhatsApp менеджеру
    return Promise.resolve({ ok: true, channel: "whatsapp", link: waLink(text) });
  }

  /* ---------- модалка ---------- */
  var modal = document.getElementById("modal");
  function openModal(link) {
    if (!modal) return;
    var wa = document.getElementById("modal-wa");
    if (wa) {
      wa.href = link;
      wa.style.display = link ? "inline-flex" : "none";
    }
    modal.classList.add("on");
  }
  function closeModal() { if (modal) modal.classList.remove("on"); }

  /* ---------- инициализация ---------- */
  function init() {
    // подстановка настроек магазина
    var set = function (id, val) { var e = document.getElementById(id); if (e && val) e.textContent = val; };
    set("tb-delivery", SHOP.delivery);
    set("tb-hours", SHOP.workHours);
    set("foot-hours", SHOP.workHours);
    var yr = document.getElementById("year");
    if (yr) yr.textContent = new Date().getFullYear();

    var legal = [];
    if (SHOP.legalName) legal.push(SHOP.legalName);
    if (SHOP.inn) legal.push("ИНН " + SHOP.inn);
    if (SHOP.ogrnip) legal.push("ОГРНИП " + SHOP.ogrnip);
    set("foot-legal", legal.join(" · "));
    set("foot-requisites", legal.join(" · "));

    var fw = document.getElementById("float-wa");
    if (fw) fw.href = waLink("Здравствуйте! Хочу заказать икру.");

    var stat = document.getElementById("stat-count");
    if (stat) stat.textContent = allItems().length;

    if (!SHOP.newYear) {
      var s = document.getElementById("snow");
      if (s) s.style.display = "none";
    }

    renderFilters();
    renderCatalog();
    renderCart();
    payNote("Онлайн по ссылке");

    // фильтры
    if (filtersEl) {
      filtersEl.addEventListener("click", function (e) {
        var chip = e.target.closest(".chip");
        if (!chip) return;
        activeCat = chip.dataset.cat;
        filtersEl.querySelectorAll(".chip").forEach(function (c) { c.classList.remove("active"); });
        chip.classList.add("active");
        renderCatalog();
      });
    }

    // поиск
    if (searchEl) {
      searchEl.addEventListener("input", function () {
        query = searchEl.value.trim().toLowerCase();
        renderCatalog();
      });
    }

    // добавление в корзину
    document.addEventListener("click", function (e) {
      var add = e.target.closest(".add-btn");
      if (add) { addToCart(add.dataset.id); return; }

      var act = e.target.closest("[data-act]");
      if (act) {
        var id = act.dataset.id;
        var a = act.dataset.act;
        if (a === "inc") cart[id] = (cart[id] || 0) + 1;
        if (a === "dec") { cart[id] = (cart[id] || 0) - 1; if (cart[id] <= 0) delete cart[id]; }
        if (a === "rm") delete cart[id];
        saveCart(); renderCart(); renderCatalog();
        return;
      }

      // открыть корзину
      if (e.target.closest("#cart-open")) {
        var p = document.getElementById("cart-panel");
        if (p) p.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }

      // модалка
      if (e.target.closest("#modal-close")) { closeModal(); return; }
      if (e.target === modal) { closeModal(); return; }

      // бургер
      if (e.target.closest("#burger")) {
        var nav = document.getElementById("nav");
        if (nav) nav.classList.toggle("open");
      }
    });

    // выбор радио
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

    // отправка формы
    var form = document.getElementById("order-form");
    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var name = form.querySelector("#f-name").value.trim();
        var phone = form.querySelector("#f-phone").value.trim();

        if (!name || !phone) {
          toast("Заполните имя и телефон");
          (!name ? form.querySelector("#f-name") : form.querySelector("#f-phone")).focus();
          return;
        }

        var data = {
          name: name,
          phone: phone,
          city: form.querySelector("#f-city").value.trim(),
          delivery: (form.querySelector('input[name="delivery"]:checked') || {}).value || "",
          payment: (form.querySelector('input[name="payment"]:checked') || {}).value || "",
          comment: form.querySelector("#f-comment").value.trim()
        };

        var btn = document.getElementById("submit-btn");
        if (btn) { btn.disabled = true; btn.textContent = "Отправляем…"; }

        submitOrder(data).then(function (res) {
          if (res.channel === "whatsapp") {
            window.open(res.link, "_blank");
          }
          openModal(res.channel === "whatsapp" ? waLink(orderText(data)) : null);
          cart = {};
          saveCart(); renderCart(); renderCatalog();
          form.reset();
          document.querySelectorAll(".radio-opt").forEach(function (o, i) {
            o.classList.toggle("sel", o.querySelector("input").checked);
          });
        }).catch(function (err) {
          toast("Не удалось отправить. Напишите в WhatsApp.");
          window.open(waLink(orderText(data)), "_blank");
        }).then(function () {
          if (btn) { btn.disabled = false; btn.textContent = "Отправить заказ"; }
        });
      });
    }

    // заказ в WhatsApp из корзины
    var waBtn = document.getElementById("wa-order");
    if (waBtn) {
      waBtn.addEventListener("click", function () {
        if (!cartCount()) { toast("Корзина пуста"); return; }
        window.open(waLink(orderText(null)), "_blank");
      });
    }

    // снег
    if (SHOP.newYear) snow();
  }

  /* ---------- снег ---------- */
  function snow() {
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

    for (var i = 0; i < 60; i++) {
      flakes.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: Math.random() * 2.2 + 0.6,
        s: Math.random() * 0.5 + 0.25,
        d: Math.random() * Math.PI * 2
      });
    }

    (function loop() {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      flakes.forEach(function (f) {
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fill();
        f.y += f.s;
        f.x += Math.sin(f.d) * 0.4;
        f.d += 0.01;
        if (f.y > H) { f.y = -6; f.x = Math.random() * W; }
      });
      requestAnimationFrame(loop);
    })();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
