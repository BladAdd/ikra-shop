/* ==========================================================================
   Админ-панель магазина «Икра».
   Сохраняет данные прямо в репозиторий GitHub через API.
   Токен хранится только в localStorage этого браузера.
   ========================================================================== */

(function () {
  "use strict";

  var LS = {
    repo: "ikra_admin_repo",
    token: "ikra_admin_token",
    branch: "ikra_admin_branch"
  };

  var DATA_PATH = "data/catalog.json";
  var API = "https://api.github.com";

  var state = {
    repo: "",
    token: "",
    branch: "main",
    isLocal: false,
    data: null,          // { version, updatedAt, shop, payments, orderEndpoint, catalog }
    sha: null,           // текущий blob sha файла в репозитории
    dirty: false,
    changes: 0,          // счётчик несохранённых изменений
    fieldDirt: {},       // какие текстовые поля уже посчитаны изменёнными (1 раз на поле, не на символ)
    formChanged: false,  // форма в модалке товара/категории менялась (для защиты от закрытия)
    editingItem: null,   // { catId, itemId } или null для нового
    editingCat: null,
    imgTarget: null,     // колбэк для выбора фото из галереи
    // фильтры списка товаров
    itemsQuery: "",
    itemsCat: "",
    itemsChip: "all",
    // выбор товаров (ключ — id товара)
    selected: {},
    // фильтр галереи фото
    photoQuery: "",
    // ассистент «фото → товар»
    queue: [],
    // колбэк привязки фото к товару (модалка поиска товара)
    bindCb: null
  };

  /* ---------------- утилиты ---------------- */
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function money(n) {
    if (n == null || n === "") return null;
    return new Intl.NumberFormat("ru-RU").format(Number(n)) + " ₽";
  }

  /* ---------------- уведомления (с кнопкой-действием) ---------------- */
  var toastT = null;
  function toast(msg, kind, actionLabel, actionCb, ms) {
    var el = $("#toast"), t = $("#toast-text"), b = $("#toast-act");
    if (!el || !t) return;
    t.textContent = msg;
    el.className = "toast on" + (kind ? " " + kind : "");
    if (b) {
      if (actionLabel && actionCb) {
        b.style.display = "";
        b.textContent = actionLabel;
        b.onclick = function () {
          el.className = "toast";
          actionCb();
        };
      } else {
        b.style.display = "none";
        b.onclick = null;
      }
    }
    clearTimeout(toastT);
    // ошибки держим дольше, чтобы владелец успел прочитать текст
    var hold = ms || (kind === "err" ? 7000 : 3200);
    toastT = setTimeout(function () { el.className = "toast"; }, hold);
  }

  function slug(s) {
    var map = {
      а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
      и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
      с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch",
      ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya"
    };
    return String(s || "").toLowerCase().split("").map(function (ch) {
      return map[ch] !== undefined ? map[ch] : ch;
    }).join("").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  /* Вес строки «1 кг» / «400 г» / «2,5 кг» в килограммах (для расчёта «всего»). */
  function kgOf(weightStr) {
    var m = /([\d.,]+)\s*кг/i.exec(weightStr || "");
    if (m) return parseFloat(m[1].replace(",", ".")) || 1;
    var g = /(\d+)\s*г/i.exec(weightStr || "");
    if (g) return parseInt(g[1], 10) / 1000;
    return 1;
  }

  /* Нормализация текста для нечёткого сравнения имён файлов и товаров. */
  function normName(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[^a-zа-я0-9]+/gi, " ")
      .replace(/\s+/g, " ")
      .replace(/^\s+|\s+$/g, "");
  }

  function nameWords(s) {
    return normName(s).split(" ").filter(function (w) { return w.length > 0; });
  }

  /* Нечёткое совпадение имени файла с названием товара: сумма весов совпавших слов. */
  function fuzzyScore(fileNorm, itemName) {
    var fw = nameWords(fileNorm).filter(function (w) { return w.length >= 3; });
    if (!fw.length) return 0;
    var iw = nameWords(itemName);
    if (!iw.length) return 0;
    var score = 0;
    fw.forEach(function (w) {
      var best = 0;
      iw.forEach(function (tw) {
        var s = 0;
        if (tw === w) s = w.length + 3;
        else if (tw.indexOf(w) === 0) s = w.length + 1;
        else if (tw.indexOf(w) > -1) s = w.length * 0.7;
        if (s > best) best = s;
      });
      score += best;
    });
    // бонус за фразу целиком
    if (fileNorm.length > 3 && normName(itemName).indexOf(fileNorm) > -1) score += 8;
    return score;
  }

  /* ---------------- счётчик изменений ---------------- */
  function updateCounts() {
    var d = state.data;
    if (!d) return;
    var n = allItemsCount();
    if ($("#st-items")) $("#st-items").textContent = n;
    if ($("#st-cats")) $("#st-cats").textContent = d.catalog.length;
  }

  function allItemsCount() {
    var d = state.data;
    if (!d) return 0;
    return d.catalog.reduce(function (a, c) { return a + (c.items ? c.items.length : 0); }, 0);
  }

  function updateDirtyUI() {
    var el = $("#dirty");
    if (el) el.classList.toggle("on", state.dirty);
    var c = $("#dirty-count");
    if (c) c.textContent = state.changes;
  }

  function setDirty(v) {
    state.dirty = v;
    if (!v) { state.changes = 0; state.fieldDirt = {}; }
    updateDirtyUI();
  }

  /* Отметить изменение: n — сколько позиций затронуто (для счётчика). */
  function bump(n) {
    state.dirty = true;
    state.changes += (n || 1);
    updateDirtyUI();
  }

  /* Текстовое поле изменено: считаем один раз на поле, а не на каждый символ. */
  function markFieldDirty(key) {
    if (state.fieldDirt[key]) return;
    state.fieldDirt[key] = true;
    bump(1);
  }

  /* Высота липкой панели вкладок на мобиле → в CSS-переменную,
     чтобы строка «Сохранить на сайт» не уезжала под панель. */
  function syncMobileBarH() {
    var aside = document.getElementById("sidebar");
    var root = document.documentElement;
    if (!aside || window.innerWidth > 900) {
      root.style.setProperty("--mobilebar-h", "0px");
      return;
    }
    root.style.setProperty("--mobilebar-h", aside.offsetHeight + "px");
  }

  /* ---------------- GitHub API ---------------- */
  /* Ошибка с HTTP-статусом: вызывающий код различает 422 (sha) от прочих. */
  function ghErr(status, msg) {
    var e = new Error(msg);
    e.status = status;
    return e;
  }

  function gh(path, opts) {
    opts = opts || {};
    var url = path.indexOf("http") === 0 ? path : API + path;
    return fetch(url, {
      method: opts.method || "GET",
      headers: {
        Authorization: "Bearer " + state.token,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json"
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: "no-store"
    }).catch(function () {
      // fetch реджектится только при сетевом сбое (нет связи, DNS, обрыв)
      throw new Error("Нет интернета или GitHub недоступен. Проверьте связь и попробуйте снова.");
    }).then(function (r) {
      if (r.status === 401) throw ghErr(401, "Токен не подошёл. Проверьте, что он действует и с доступом Contents: Read and write.");
      if (r.status === 403) throw ghErr(403, "Нет прав. Нужно разрешение Contents: Read and write на этот репозиторий.");
      if (r.status === 404) throw ghErr(404, "Не найдено. Проверьте название репозитория и ветку.");
      if (r.status === 422) throw ghErr(422, "GitHub не принял сохранение: файл изменён другим окном — обнови страницу и повтори.");
      if (!r.ok) {
        return r.text().then(function (t) {
          var m = t;
          try { m = JSON.parse(t).message || t; } catch (e) {}
          throw ghErr(r.status, "GitHub: " + m);
        });
      }
      return r.status === 204 ? {} : r.json();
    });
  }

  // base64 для UTF-8
  function b64encode(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function b64decode(b64) {
    var bin = atob(String(b64).replace(/\s/g, ""));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function loadFromRepo() {
    if (state.isLocal) {
      return fetch(DATA_PATH + "?v=" + Date.now())
        .then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status + " при загрузке каталога");
          return r.json();
        })
        .then(function (d) {
          state.data = d;
          normalize();
          return state.data;
        });
    }
    return gh("/repos/" + state.repo + "/contents/" + DATA_PATH + "?ref=" + encodeURIComponent(state.branch))
      .then(function (file) {
        state.sha = file.sha;
        var text = b64decode(file.content);
        state.data = JSON.parse(text);
        normalize();
        return state.data;
      });
  }

  var DATA_JS_PATH = "assets/js/data.js";

  /**
   * Обновляет встроенную резервную копию каталога в data.js.
   * Без этого сайт, открытый без сервера, показывал бы старые цены.
   */
  function updateFallbackInRepo() {
    var filePath = DATA_JS_PATH;
    return gh("/repos/" + state.repo + "/contents/" + filePath + "?ref=" + encodeURIComponent(state.branch))
      .then(function (file) {
        var text = b64decode(file.content);
        var lineRe = /^var FALLBACK_DATA = .*;$/m;
        if (!lineRe.test(text)) return null; // файл в нестандартном виде — не трогаем
        var json = JSON.stringify(state.data);
        var next = text.replace(lineRe, "var FALLBACK_DATA = " + json + ";");
        return gh("/repos/" + state.repo + "/contents/" + filePath, {
          method: "PUT",
          body: {
            message: "Админка: обновление встроенной копии каталога",
            content: b64encode(next),
            branch: state.branch,
            sha: file.sha
          }
        });
      })
      .catch(function (e) {
        console.warn("Не удалось обновить встроенную копию:", e.message);
        return null;
      });
  }

  function saveToRepo(message, onStage) {
    // дата последнего обновления каталога — в сами данные
    if (state.data) state.data.updatedAt = new Date().toISOString();

    if (state.isLocal) {
      // штатный путь express — PUT /api/admin/catalog; если он недоступен
      // (например, работает только dev-прокси vite) — fallback на POST /api/catalog
      var bodyStr = JSON.stringify(state.data, null, 2) + "\n";
      var localPut = function () {
        return fetch("/api/admin/catalog", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: bodyStr
        });
      };
      return localPut().then(function (r) {
        if (r.ok) return r.json();
        if (r.status === 409) {
          // Одновременное сохранение из другого окна: одна автоматическая
          // попытка поверх — правки текущего окна главнее, владелец видит предупреждение
          return localPut().then(function (r2) {
            if (r2.ok) {
              toast("Каталог сохранён поверх чужой одновременной правки", "err", null, null, 6000);
              return r2.json();
            }
            throw new Error("Каталог одновременно правят в другом окне — обнови страницу и повтори сохранение");
          });
        }
        throw new Error("Ошибка сервера при сохранении (HTTP " + r.status + ")");
      }).catch(function (e1) {
        // 409-гонку на POST-фолбэк не уводим: там ту же проблему не решить
        if (String(e1 && e1.message || "").indexOf("одновременно") !== -1) throw e1;
        return fetch("/api/catalog", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: bodyStr
        }).then(function (r2) {
          if (!r2.ok) throw e1;
          return r2.json();
        });
      });
    }
    var body = JSON.stringify(state.data, null, 2) + "\n";
    var payload = {
      message: message || "Админка: обновление каталога",
      content: b64encode(body),
      branch: state.branch
    };
    if (state.sha) payload.sha = state.sha;

    return gh("/repos/" + state.repo + "/contents/" + DATA_PATH, {
      method: "PUT",
      body: payload
    }).then(function (res) {
      if (res.content && res.content.sha) state.sha = res.content.sha;
      // Резервная копия обновляется следом; ошибка здесь не отменяет сохранение каталога
      if (onStage) onStage();
      return updateFallbackInRepo().then(function () { return res; });
    }).catch(function (e) {
      // 422: файл в репозитории изменился с момента загрузки (другое окно или
      // ручная правка). Одна автоматическая попытка: свежий sha и сохранение
      // поверх — правки текущего окна главнее, владелец получает предупреждение.
      if (!e || e.status !== 422 || !payload.sha) throw e;
      return gh("/repos/" + state.repo + "/contents/" + DATA_PATH + "?ref=" + encodeURIComponent(state.branch))
        .then(function (file) {
          state.sha = file.sha;
          payload.sha = file.sha;
          return gh("/repos/" + state.repo + "/contents/" + DATA_PATH, { method: "PUT", body: payload });
        })
        .then(function (res2) {
          if (res2.content && res2.content.sha) state.sha = res2.content.sha;
          if (onStage) onStage();
          toast("Каталог сохранён поверх свежей версии — в репозитории была параллельная правка", "err", null, null, 6000);
          return updateFallbackInRepo().then(function () { return res2; });
        });
    });
  }

  function normalize() {
    var d = state.data;
    if (!d) return;
    if (!Array.isArray(d.catalog)) d.catalog = [];
    if (!d.shop) d.shop = {};
    if (!d.payments) d.payments = { provider: "link", currency: "RUB" };
    if (typeof d.orderEndpoint !== "string") d.orderEndpoint = "";
    d.catalog.forEach(function (c) {
      if (!Array.isArray(c.items)) c.items = [];
      if (!c.id) c.id = slug(c.title) || "cat";
    });
    if (!Array.isArray(d.shop.promos)) d.shop.promos = [];
  }

  /* ---------------- статус ---------------- */
  function updateStatus(ok, text) {
    var dot = $("#st-dot"), t = $("#st-text");
    if (dot) dot.className = "dot " + (ok === true ? "ok" : ok === false ? "err" : "warn");
    if (t) t.textContent = text;
    updateCounts();
  }

  /* ---------------- вкладки ---------------- */
  function switchTab(name) {
    $$(".tab-btn[data-tab]").forEach(function (x) { x.classList.remove("active"); });
    var btn = $('.tab-btn[data-tab="' + name + '"]');
    if (btn) btn.classList.add("active");
    $$(".panel").forEach(function (p) { p.classList.remove("on"); });
    var p = $("#panel-" + name);
    if (p) p.classList.add("on");
    if (name === "orders") loadOrders();
    if (name === "dash") renderDash();
    if (window.innerWidth <= 900) $("#sidebar").classList.remove("open");
    // высота мобильной панели вкладок могла измениться — пересчитать отступ .bar
    setTimeout(syncMobileBarH, 0);
  }

  /* ---------------- поиск товара по id ---------------- */
  function catById(id) {
    return state.data.catalog.filter(function (c) { return c.id === id; })[0] || null;
  }

  function itemById(id) {
    var found = null;
    state.data.catalog.forEach(function (c) {
      (c.items || []).forEach(function (it) {
        if (it.id === id && !found) found = { cat: c, item: it };
      });
    });
    return found;
  }

  /* ---------------- дашборд ---------------- */
  function countNoPhoto() {
    var n = 0;
    state.data.catalog.forEach(function (c) {
      (c.items || []).forEach(function (it) {
        if (!it.img || /__NEED_PHOTO__/.test(it.img)) n++;
      });
    });
    return n;
  }

  function countOnReq() {
    var n = 0;
    state.data.catalog.forEach(function (c) {
      (c.items || []).forEach(function (it) {
        if (it.price == null || it.price === "") n++;
      });
    });
    return n;
  }

  function countPromos() {
    var promos = (state.data.shop && state.data.shop.promos) || [];
    return promos.filter(function (p) { return p.active !== false; }).length;
  }

  function renderDash() {
    if (!state.data) return;
    var el;
    el = $("#dash-total"); if (el) el.textContent = allItemsCount();
    el = $("#dash-nophoto"); if (el) el.textContent = countNoPhoto();
    el = $("#dash-cats"); if (el) el.textContent = state.data.catalog.length;
    el = $("#dash-onreq"); if (el) el.textContent = countOnReq();
    el = $("#dash-promos"); if (el) el.textContent = countPromos();
    el = $("#dash-updated");
    if (el) {
      var u = state.data.updatedAt;
      if (u) {
        var dt = new Date(u);
        el.textContent = isNaN(dt.getTime()) ? "—" :
          dt.toLocaleDateString("ru-RU", { day: "numeric", month: "long" }) + ", " +
          dt.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
      } else {
        el.textContent = "—";
      }
    }
  }

  /* Переход по карточкам-статистикам и быстрым действиям */
  function dashJump(target) {
    if (target === "items") { switchTab("items"); }
    else if (target === "cats") { switchTab("cats"); }
    else if (target === "promos") { switchTab("shop"); }
    else if (target === "nophoto" || target === "onreq") {
      state.itemsChip = target;
      syncChipsUI();
      switchTab("items");
      renderItems();
    }
  }

  /* ---------------- фильтры списка товаров ---------------- */
  function syncChipsUI() {
    $$(".chip").forEach(function (ch) {
      ch.classList.toggle("on", ch.dataset.chip === state.itemsChip);
    });
  }

  function itemMatchesFilters(it, catId) {
    var q = normName(state.itemsQuery);
    if (q && normName(it.name + " " + (it.tags || "")).indexOf(q) === -1) return false;
    if (state.itemsCat && catId && it && catId !== state.itemsCat) return false;
    if (state.itemsChip === "nophoto" && it.img && !/__NEED_PHOTO__/.test(it.img)) return false;
    if (state.itemsChip === "onreq" && !(it.price == null || it.price === "")) return false;
    if (state.itemsChip === "sale" && !it.oldPrice) return false;
    if (state.itemsChip === "badge" && !it.badge) return false;
    return true;
  }

  /* ---------------- отрисовка товаров ---------------- */
  function priceLabel(it) {
    if (it.price == null || it.price === "") return "По запросу";
    return money(it.price);
  }

  function itemRowHTML(cat, ci, ii) {
    var it = cat.items[ii];
    var badges = "";
    if (!it.img || /__NEED_PHOTO__/.test(it.img)) badges += '<span class="tag hot">нет фото</span>';
    if (it.badge) badges += '<span class="tag gold">' + esc(it.badge) + "</span>";
    if (it.oldPrice) badges += '<span class="tag hot">скидка</span>';
    if (Array.isArray(it.packs) && it.packs.length > 1) badges += '<span class="tag">' + it.packs.length + " фас.</span>";
    var sel = state.selected[it.id] ? " selected" : "";
    return '' +
      '<div class="item' + sel + '" draggable="true" data-ci="' + ci + '" data-ii="' + ii + '">' +
        '<span class="selbox"><input type="checkbox" data-sel="' + esc(it.id) + '"' + (state.selected[it.id] ? " checked" : "") + ' title="Выбрать"></span>' +
        '<span class="grip" title="Перетащите, чтобы изменить порядок">⠿</span>' +
        '<img src="' + esc(it.img || "assets/img/__NEED_PHOTO__.jpg") + '" alt="" onerror="this.style.opacity=.25">' +
        '<div class="info">' +
          "<b>" + esc(it.name) + badges + "</b>" +
          '<div class="meta">' + esc(it.weight || "—") + " · " + esc(it.unit === "кг" ? (it.piece ? "за упаковку" : "за кг") : "за шт") +
            (it.oldPrice ? ' · <s style="opacity:.6">' + money(it.oldPrice) + "</s>" : "") + "</div>" +
          '<div class="price' + (it.price == null || it.price === "" ? " none" : "") + '" data-price-ci="' + ci + '" data-price-ii="' + ii + '" title="Нажмите, чтобы изменить цену">' + priceLabel(it) + "</div>" +
        "</div>" +
        '<div class="acts">' +
          '<button class="btn btn-sm btn-icon" data-act="up" data-ci="' + ci + '" data-ii="' + ii + '" title="Выше">↑</button>' +
          '<button class="btn btn-sm btn-icon" data-act="down" data-ci="' + ci + '" data-ii="' + ii + '" title="Ниже">↓</button>' +
          '<button class="btn btn-sm" data-act="edit" data-ci="' + ci + '" data-ii="' + ii + '">Изменить</button>' +
          '<button class="btn btn-sm" data-act="dup" data-ci="' + ci + '" data-ii="' + ii + '">Копия</button>' +
          '<button class="btn btn-sm btn-danger" data-act="del" data-ci="' + ci + '" data-ii="' + ii + '">Удалить</button>' +
        "</div>" +
      "</div>";
  }

  function renderItems() {
    var root = $("#items-root");
    if (!root || !state.data) return;
    var d = state.data;
    var filtering = state.itemsQuery || state.itemsChip !== "all" || state.itemsCat;

    if (!d.catalog.length) {
      root.innerHTML = '<div class="empty">Категорий пока нет. Создайте первую во вкладке «Категории».</div>';
      return;
    }

    var html = d.catalog.map(function (cat, ci) {
      var shown = 0;
      var rows = cat.items.map(function (it, ii) {
        if (!itemMatchesFilters(it, cat.id)) return "";
        shown++;
        return itemRowHTML(cat, ci, ii);
      }).join("");

      if (filtering && !shown) return "";

      return '' +
        '<div class="cat-block">' +
          '<div class="cat-bar">' +
            '<span class="nm">' + esc(cat.title) + "</span>" +
            '<span class="cnt">' + (filtering ? shown + " из " + cat.items.length + " поз." : cat.items.length + " поз.") + "</span>" +
            '<div class="acts">' +
              '<button class="btn btn-sm" data-act="sel-cat" data-ci="' + ci + '" title="Выбрать все товары категории">☑ Все</button>' +
              '<button class="btn btn-sm" data-act="add-here" data-ci="' + ci + '">+ Товар</button>' +
            "</div>" +
          "</div>" +
          (rows || '<div class="empty" style="padding:16px">В этой категории пока нет товаров</div>') +
        "</div>";
    }).join("");

    root.innerHTML = html || '<div class="empty">Ничего не найдено по фильтру. Сбросьте поиск или чипы.</div>';
    renderBulkBar();
  }

  /* ---------------- инлайн-редактирование цены ---------------- */
  function startPriceEdit(cell) {
    if (cell.classList.contains("editing")) return;
    var ci = Number(cell.dataset.priceCi);
    var ii = Number(cell.dataset.priceIi);
    var it = state.data.catalog[ci].items[ii];
    cell.classList.add("editing");
    var old = it.price == null ? "" : String(it.price);
    cell.innerHTML = '<input type="number" min="0" step="1" value="' + esc(old) + '">';
    var inp = cell.querySelector("input");
    inp.focus();
    inp.select();

    var done = false;
    function commit() {
      if (done) return;
      done = true;
      var raw = inp.value.trim();
      var val = raw === "" ? null : Number(raw);
      if (raw !== "" && (isNaN(val) || val < 0)) {
        cell.classList.remove("editing");
        renderItems();
        return;
      }
      var changed = String(val) !== String(it.price == null ? "" : it.price);
      cell.classList.remove("editing");
      if (changed) {
        it.price = val;
        bump(1);
        renderItems();
        renderDash();
        toast("Цена «" + it.name + "»: " + (val == null ? "по запросу" : money(val)), "ok");
      } else {
        renderItems();
      }
    }

    inp.addEventListener("keydown", function (e) {
      if (e.key === "Enter") commit();
      if (e.key === "Escape") { done = true; cell.classList.remove("editing"); renderItems(); }
    });
    inp.addEventListener("blur", commit);
  }

  /* ---------------- мультивыбор и массовые действия ---------------- */
  function selectedIds() {
    return Object.keys(state.selected).filter(function (k) { return state.selected[k]; });
  }

  function eachSelectedItem(fn) {
    selectedIds().forEach(function (id) {
      var f = itemById(id);
      if (f) fn(f.item, f.cat);
    });
  }

  function renderBulkBar() {
    var bar = $("#bulk-bar");
    if (!bar) return;
    var n = selectedIds().length;
    bar.style.display = n > 0 ? "flex" : "none";
    var c = $("#bulk-count");
    if (c) c.textContent = "Выбрано: " + n;
  }

  function clearSelection() {
    state.selected = {};
    renderItems();
  }

  /* Масштабирует цену товара и его фасовки на коэффициент. */
  function scaleItemPrices(it, factor) {
    if (it.price != null) it.price = Math.max(1, Math.round(it.price * factor));
    if (it.packPrice != null) it.packPrice = Math.max(1, Math.round(it.packPrice * factor));
    if (Array.isArray(it.packs)) {
      it.packs.forEach(function (p) {
        if (p.price != null) p.price = Math.max(1, Math.round(p.price * factor));
        if (p.total != null) p.total = Math.max(1, Math.round(p.total * factor));
      });
    }
  }

  function bulkApplyPercent() {
    var raw = $("#bulk-percent").value.trim();
    if (raw === "") { toast("Введите процент, например 10 или -5", "err"); return; }
    var n = Number(raw);
    if (isNaN(n) || n <= -100) { toast("Некорректный процент", "err"); return; }
    var ids = selectedIds();
    var factor = 1 + n / 100;
    var touched = 0;
    eachSelectedItem(function (it) {
      if (it.price == null) return; // «по запросу» не трогаем
      scaleItemPrices(it, factor);
      touched++;
    });
    $("#bulk-percent").value = "";
    bump(touched);
    renderItems(); renderDash();
    toast("Цена изменена у " + touched + " товар(ов)", "ok");
  }

  function bulkSetBadge(badge) {
    var ids = selectedIds();
    eachSelectedItem(function (it) { it.badge = badge || null; });
    bump(ids.length);
    renderItems(); renderDash();
    toast(badge ? "Плашка «" + badge + "» установлена" : "Плашки сняты", "ok");
  }

  function bulkMove(catId) {
    var target = catById(catId);
    if (!target) return;
    var ids = selectedIds();
    if (!confirm("Перенести " + ids.length + " товар(ов) в категорию «" + target.title + "»?")) {
      $("#bulk-move").value = "";
      return;
    }
    eachSelectedItem(function (it, cat) {
      if (cat.id === catId) return;
      var idx = cat.items.indexOf(it);
      if (idx > -1) cat.items.splice(idx, 1);
      target.items.push(it);
    });
    $("#bulk-move").value = "";
    clearSelection();
    bump(ids.length);
    renderItems(); renderCats(); renderDash();
    toast("Товары перенесены", "ok");
  }

  function bulkDelete() {
    var ids = selectedIds();
    if (!ids.length) return;
    if (!confirm("Удалить выбранные товары (" + ids.length + " шт.)? Восстановить их будет нельзя.")) return;
    var n = 0;
    ids.forEach(function (id) {
      var f = itemById(id);
      if (f) {
        var idx = f.cat.items.indexOf(f.item);
        if (idx > -1) { f.cat.items.splice(idx, 1); n++; }
      }
    });
    state.selected = {};
    bump(n);
    renderItems(); renderCats(); renderDash();
    toast("Удалено товаров: " + n, "ok");
  }

  /* ---------------- отрисовка категорий ---------------- */
  function renderCats() {
    var root = $("#cats-root");
    if (!root || !state.data) return;
    var d = state.data;

    if (!d.catalog.length) {
      root.innerHTML = '<div class="empty">Категорий пока нет.</div>';
      return;
    }

    root.innerHTML = d.catalog.map(function (c, i) {
      return '' +
        '<div class="item cat-row" draggable="true" data-catdrag="' + i + '">' +
          '<span class="grip" title="Перетащите, чтобы изменить порядок">⠿</span>' +
          '<div class="info">' +
            "<b>" + esc(c.title) + "</b>" +
            '<div class="meta">' + esc(c.subtitle || "—") + " · код: " + esc(c.id) + " · " + c.items.length + " поз.</div>" +
          "</div>" +
          '<div class="acts">' +
            '<button class="btn btn-sm btn-icon" data-cact="up" data-ci="' + i + '" title="Выше">↑</button>' +
            '<button class="btn btn-sm btn-icon" data-cact="down" data-ci="' + i + '" title="Ниже">↓</button>' +
            '<button class="btn btn-sm" data-cact="edit" data-ci="' + i + '">Изменить</button>' +
            '<button class="btn btn-sm btn-danger" data-cact="del" data-ci="' + i + '">Удалить</button>' +
          "</div>" +
        "</div>";
    }).join("");

    fillCatFilter(); fillBulkMove();
  }

  /* селект фильтра по категориям */
  function fillCatFilter() {
    var sel = $("#items-cat-filter");
    if (!sel) return;
    var cur = sel.value || state.itemsCat;
    sel.innerHTML = '<option value="">Все категории</option>' + state.data.catalog.map(function (c) {
      return '<option value="' + esc(c.id) + '">' + esc(c.title) + "</option>";
    }).join("");
    sel.value = state.data.catalog.some(function (c) { return c.id === cur; }) ? cur : "";
    state.itemsCat = sel.value;
  }

  /* селект переноса в массовых действиях */
  function fillBulkMove() {
    var sel = $("#bulk-move");
    if (!sel) return;
    var cur = sel.value;
    sel.innerHTML = '<option value="">Перенести в категорию…</option>' + state.data.catalog.map(function (c) {
      return '<option value="' + esc(c.id) + '">' + esc(c.title) + "</option>";
    }).join("");
    sel.value = cur;
  }

  /* ---------------- перетаскивание (товары и категории) ---------------- */
  var dragSrc = null;

  function bindDrag() {
    document.addEventListener("dragstart", function (e) {
      var it = e.target.closest(".item[draggable]");
      if (!it) return;
      dragSrc = it;
      it.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });

    document.addEventListener("dragend", function (e) {
      var it = e.target.closest(".item[draggable]");
      if (it) it.classList.remove("dragging");
      $$(".drag-over").forEach(function (x) { x.classList.remove("drag-over"); });
      dragSrc = null;
    });

    document.addEventListener("dragover", function (e) {
      var it = e.target.closest(".item[draggable]");
      if (!it || !dragSrc || it === dragSrc) return;
      // товар — только внутри своей категории; категория — только с категорией
      if (dragSrc.classList.contains("cat-row") !== it.classList.contains("cat-row")) return;
      if (!dragSrc.classList.contains("cat-row") && it.dataset.ci !== dragSrc.dataset.ci) return;
      e.preventDefault();
      it.classList.add("drag-over");
    });

    document.addEventListener("dragleave", function (e) {
      var it = e.target.closest(".item[draggable]");
      if (it) it.classList.remove("drag-over");
    });

    document.addEventListener("drop", function (e) {
      var it = e.target.closest(".item[draggable]");
      if (!it || !dragSrc || it === dragSrc) return;
      if (dragSrc.classList.contains("cat-row") !== it.classList.contains("cat-row")) return;
      e.preventDefault();

      if (it.classList.contains("cat-row")) {
        // меняем порядок категорий
        var fromC = Number(dragSrc.dataset.catdrag);
        var toC = Number(it.dataset.catdrag);
        var cats = state.data.catalog;
        var movedCat = cats.splice(fromC, 1)[0];
        cats.splice(toC, 0, movedCat);
        bump(1);
        renderCats(); renderItems(); renderDash();
        toast("Порядок категорий изменён", "ok");
        return;
      }

      var ci = Number(it.dataset.ci);
      var from = Number(dragSrc.dataset.ii);
      var to = Number(it.dataset.ii);
      var items = state.data.catalog[ci].items;
      var moved = items.splice(from, 1)[0];
      items.splice(to, 0, moved);

      bump(1);
      renderItems();
      toast("Порядок изменён", "ok");
    });
  }

  /* ---------------- модалка товара ---------------- */
  function openItemModal(catId, itemId) {
    var d = state.data;
    var cat = catById(catId);
    if (!cat) return;

    var it = itemId ? cat.items.filter(function (x) { return x.id === itemId; })[0] : null;

    state.editingItem = { catId: catId, itemId: itemId || null };
    state.formChanged = false; // форма только что открыта — изменений ещё нет

    $("#mi-title").textContent = it ? "Изменить товар" : "Новый товар";
    $("#mi-cat").innerHTML = d.catalog.map(function (c) {
      return '<option value="' + esc(c.id) + '"' + (c.id === catId ? " selected" : "") + ">" + esc(c.title) + "</option>";
    }).join("");

    $("#mi-name").value = it ? it.name || "" : "";
    $("#mi-old").value = it && it.oldPrice != null ? it.oldPrice : "";
    $("#mi-unit").value = it ? it.unit || "шт" : "шт";
    $("#mi-badge").value = it ? it.badge || "" : "";
    $("#mi-desc").value = it ? it.desc || "" : "";
    $("#mi-tags").value = it ? it.tags || "" : "";
    $("#mi-img").value = it ? it.img || "" : "";
    $("#mi-piece").checked = it ? !!it.piece : false;

    // фасовки: копируем, чтобы не менять данные до «Сохранить»
    state.packDraft = it && Array.isArray(it.packs) && it.packs.length
      ? JSON.parse(JSON.stringify(it.packs))
      : [];
    if (!state.packDraft.length && it && (it.weight || it.price != null)) {
      // одна неявная фасовка из текущих полей
      state.packDraft.push({ weight: it.weight || "", price: it.price, total: it.packPrice != null ? it.packPrice : null });
    }
    if (!state.packDraft.length) {
      state.packDraft.push({ weight: "", price: "", total: "" });
    }
    // отмечаем основную: та, чей вес совпадает с весом витрины, иначе первая
    var mainFound = false;
    state.packDraft.forEach(function (p) {
      p.__main = !mainFound && it && p.weight && p.weight === it.weight;
      if (p.__main) mainFound = true;
    });
    if (!mainFound) state.packDraft[0].__main = true;
    renderPackRows();

    updatePrev();

    var needHint = $("#mi-need-hint");
    if (needHint) needHint.style.display = (it && /__NEED_PHOTO__/.test(it.img || "")) ? "block" : "none";

    $("#modal-item").classList.add("on");
    setTimeout(function () { $("#mi-name").focus(); }, 60);
  }

  /* Блок «Фасовки и цены» в модалке товара. */
  function renderPackRows() {
    var box = $("#mi-packs");
    if (!box) return;
    var draft = state.packDraft || [];
    if (!draft.length) {
      box.innerHTML = '<div class="empty" style="padding:10px">Фасовок нет — добавьте первую</div>';
      syncPackSummary();
      return;
    }
    box.innerHTML = draft.map(function (p, i) {
      var checked = p.__main ? " checked" : "";
      return '' +
        '<div class="pack-row' + (p.__main ? " main" : "") + '" data-pi="' + i + '">' +
          '<input type="radio" name="mi-pack-main" data-pradio="' + i + '"' + checked + ' title="Основная фасовка">' +
          '<input type="text" data-pw="' + i + '" value="' + esc(p.weight || "") + '" placeholder="Вес, напр. 500 г">' +
          '<input type="number" data-pp="' + i + '" min="0" step="1" value="' + esc(p.price == null ? "" : p.price) + '" placeholder="₽">' +
          '<input type="number" data-pt="' + i + '" min="0" step="1" value="' + esc(p.total == null ? "" : p.total) + '" placeholder="Всего">' +
          '<button class="btn btn-sm btn-danger p-del" data-pdel="' + i + '" title="Удалить фасовку">×</button>' +
        "</div>";
    }).join("");
    syncPackSummary();
  }

  /* Синхронизирует поля «Цена / Всего за фасовку / Основная фасовка» над блоком. */
  function syncPackSummary() {
    var draft = state.packDraft || [];
    var main = null;
    draft.forEach(function (p) { if (p.__main && !main) main = p; });
    if (!main && draft.length) main = draft[0];
    var piece = $("#mi-piece").checked;

    if (main) {
      $("#mi-weight").value = main.weight || "";
      $("#mi-price").value = main.price == null ? "" : main.price;
      var total = main.total;
      if (total == null || total === "") {
        total = calcPackTotal(main, piece);
      }
      $("#mi-packprice").value = total == null ? "" : total;
    } else {
      $("#mi-packprice").value = "";
    }
  }

  /* «Всего» для фасовки: у порционных — цена упаковки, у весовых — цена за кг × кг. */
  function calcPackTotal(p, piece) {
    var price = p.price == null || p.price === "" ? null : Number(p.price);
    if (price == null) return null;
    if (piece) return Math.round(price);
    return Math.round(price * kgOf(p.weight)); // «1 кг» → цена за кг, «500 г» → половина
  }

  function updatePrev() {
    var v = $("#mi-img").value.trim();
    var p = $("#mi-prev");
    if (v) { p.src = v; p.style.display = "block"; }
    else { p.removeAttribute("src"); p.style.display = "block"; p.style.opacity = 0.3; }
    p.style.opacity = 1;
  }

  /* Товар без нормального фото: подставляем заглушку одним нажатием. */
  function markNeedPhoto() {
    $("#mi-img").value = "assets/img/__NEED_PHOTO__.jpg";
    updatePrev();
    toast("Поставлена заглушка «ПОЧИНИ МЕНЯ». Выберите или загрузите фото.", "ok");
  }

  /* Сборка массива фасовок из формы перед сохранением. */
  function collectPacks() {
    // главная фасовка — по ссылке на исходную строку черновика,
    // чтобы индексы не сбились после фильтрации пустых строк
    var mainSrc = null;
    (state.packDraft || []).forEach(function (p) { if (p.__main && !mainSrc) mainSrc = p; });
    if (!mainSrc && state.packDraft && state.packDraft.length) mainSrc = state.packDraft[0];

    var draft = (state.packDraft || []).map(function (p) {
      var w = String(p.weight || "").trim();
      var price = p.price === "" || p.price == null ? null : Number(p.price);
      var total = p.total === "" || p.total == null ? null : Number(p.total);
      if (total == null) total = calcPackTotal(p, $("#mi-piece").checked);
      return { weight: w, price: price, total: total, __src: p };
    }).filter(function (p) { return p.weight || p.price != null; });

    var main = null;
    draft.forEach(function (p) { if (p.__src === mainSrc) main = p; });
    if (!main && draft.length) main = draft[0];

    if (draft.length < 2) {
      // одна фасовка: packs не пишем, но вес/цену/стоимость берём из неё
      return { packs: null, main: main };
    }
    return {
      packs: draft.map(function (p) { return { weight: p.weight, price: p.price, total: p.total }; }),
      main: main
    };
  }

  function saveItem() {
    var name = $("#mi-name").value.trim();
    if (!name) { toast("Введите название товара", "err"); $("#mi-name").focus(); return; }

    var d = state.data;
    var catId = $("#mi-cat").value;
    var cat = catById(catId);
    if (!cat) { toast("Категория не найдена", "err"); return; }

    var priceRaw = $("#mi-price").value.trim();
    var oldRaw = $("#mi-old").value.trim();
    var packsInfo = collectPacks();

    var prev = itemById(state.editingItem && state.editingItem.itemId);
    var prevItem = prev ? prev.item : null;

    // предупреждение о дубле названия в этой же категории
    var dup = cat.items.some(function (x) {
      if (prevItem && x === prevItem) return false;
      return normName(x.name) === normName(name);
    });
    if (dup && !confirm("В категории «" + cat.title + "» уже есть товар с названием «" + name + "». Всё равно сохранить?")) {
      return;
    }

    // база — прежний товар (сохраняем неизвестные форме поля), поверх — значения формы
    var payload = prevItem ? JSON.parse(JSON.stringify(prevItem)) : { id: "", desc: "", tags: "" };
    payload.name = name;
    payload.weight = packsInfo.main && packsInfo.main.weight ? packsInfo.main.weight : ($("#mi-weight").value.trim() || "1 шт");
    payload.price = priceRaw === "" ? null : Number(priceRaw);
    payload.oldPrice = oldRaw === "" ? null : Number(oldRaw);
    payload.unit = $("#mi-unit").value;
    payload.piece = $("#mi-piece").checked;
    payload.img = $("#mi-img").value.trim() || "assets/img/hero-caviar.jpg";
    payload.badge = $("#mi-badge").value || null;
    payload.desc = $("#mi-desc").value.trim();
    payload.tags = $("#mi-tags").value.trim();
    payload.packs = packsInfo.packs;
    // стоимость основной фасовки: для порционных — цена упаковки
    if (packsInfo.main) {
      payload.packPrice = packsInfo.main.total != null ? packsInfo.main.total
        : (payload.piece && payload.price != null ? payload.price : null);
    } else {
      payload.packPrice = null;
    }

    var ed = state.editingItem;

    if (ed && ed.itemId) {
      // правка существующего
      var srcCat = catById(ed.catId);
      var idx = srcCat.items.findIndex(function (x) { return x.id === ed.itemId; });
      if (idx === -1) { toast("Товар не найден", "err"); return; }
      payload.id = srcCat.items[idx].id;

      if (ed.catId === catId) {
        srcCat.items[idx] = payload;
      } else {
        srcCat.items.splice(idx, 1);
        cat.items.push(payload);
      }
    } else {
      payload.id = slug(name) + "-" + Date.now().toString(36).slice(-4);
      cat.items.push(payload);
    }

    bump(1);
    state.formChanged = false; // сохранено — закрываем без подтверждения
    closeModal("#modal-item");
    renderItems(); renderDash();
    updateStatus(null, "Есть несохранённые изменения");
    toast("Товар сохранён. Нажмите «Сохранить на сайт».", "ok");
  }

  /* ---------------- модалка категории ---------------- */
  function openCatModal(idx) {
    var d = state.data;
    var c = idx != null ? d.catalog[idx] : null;
    state.editingCat = idx != null ? idx : null;
    state.formChanged = false; // форма только что открыта — изменений ещё нет

    $("#mc-title").textContent = c ? "Изменить категорию" : "Новая категория";
    $("#mc-title-in").value = c ? c.title || "" : "";
    $("#mc-sub").value = c ? c.subtitle || "" : "";
    $("#mc-id").value = c ? c.id || "" : "";

    var warn = $("#mc-id-warn");
    if (warn) warn.style.display = "none";
    if (c) {
      // покажем предупреждение, только если код реально изменят
      $("#mc-id").dataset.orig = c.id || "";
    } else if (warn) {
      $("#mc-id").dataset.orig = "";
    }

    $("#modal-cat").classList.add("on");
    setTimeout(function () { $("#mc-title-in").focus(); }, 60);
  }

  function saveCat() {
    var title = $("#mc-title-in").value.trim();
    if (!title) { toast("Введите название категории", "err"); return; }

    var d = state.data;
    var id = $("#mc-id").value.trim() || slug(title) || "cat";
    id = slug(id) || "cat";

    // уникальность кода
    var dup = d.catalog.some(function (c, i) {
      return c.id === id && i !== state.editingCat;
    });
    if (dup) { toast("Такой код уже есть, выберите другой", "err"); return; }

    if (state.editingCat != null) {
      var c = d.catalog[state.editingCat];
      c.title = title;
      c.subtitle = $("#mc-sub").value.trim();
      if (c.id !== id && c.id && !confirm("Код категории изменится с «" + c.id + "» на «" + id + "». Ссылки вида ?cat=" + c.id + " перестанут работать. Продолжить?")) {
        return;
      }
      c.id = id;
    } else {
      d.catalog.push({
        id: id,
        title: title,
        subtitle: $("#mc-sub").value.trim(),
        items: []
      });
    }

    bump(1);
    state.formChanged = false; // сохранено — закрываем без подтверждения
    closeModal("#modal-cat");
    renderItems(); renderCats(); renderDash();
    updateStatus(null, "Есть несохранённые изменения");
    toast("Категория сохранена", "ok");
  }

  /* ---------------- модалка привязки фото к товару ---------------- */
  function openBindModal(title, cb) {
    state.bindCb = cb;
    $("#bind-title").textContent = title || "К какому товару привязать?";
    $("#bind-search").value = "";
    renderBindResults("");
    $("#modal-bind").classList.add("on");
    setTimeout(function () { $("#bind-search").focus(); }, 60);
  }

  function renderBindResults(query) {
    var box = $("#bind-results");
    if (!box || !state.data) return;
    var q = normName(query);
    var html = "";
    state.data.catalog.forEach(function (c) {
      var rows = (c.items || []).filter(function (it) {
        return !q || normName(it.name).indexOf(q) > -1 || normName(it.tags || "").indexOf(q) > -1;
      }).slice(0, 8);
      if (!rows.length) return;
      html += '<div style="font-size:.72rem;color:var(--muted);margin:8px 0 4px">' + esc(c.title) + "</div>";
      html += rows.map(function (it) {
        var used = it.img && !/__NEED_PHOTO__/.test(it.img);
        return '<button class="bind-row" data-bind-id="' + esc(it.id) + '">' +
          "<span><b>" + esc(it.name) + "</b>" +
          (used ? ' <span class="ct">· есть фото</span>' : ' <span class="ct">· без фото</span>') +
          "</span></button>";
      }).join("");
    });
    box.innerHTML = html || '<div class="empty">Ничего не найдено</div>';
  }

  /* ---------------- галерея фото ---------------- */
  var photoList = [];

  function loadPhotos() {
    if (state.isLocal) {
      return fetch("assets/img/credits.json")
        .then(function (r) { return r.json(); })
        .then(function (credits) {
          photoList = (Array.isArray(credits) ? credits : []).map(function (c) {
            var name = c.file.replace(/^assets\/img\//, "");
            return { name: name, path: c.file, sha: "", size: 0 };
          });
          return photoList;
        })
        .catch(function () { return finishLocalPhotos(); });
    }
    // список файлов из папки assets/img репозитория
    return gh("/repos/" + state.repo + "/contents/assets/img?ref=" + encodeURIComponent(state.branch))
      .then(function (files) {
        photoList = (Array.isArray(files) ? files : [])
          .filter(function (f) { return /\.(jpe?g|png|webp|svg)$/i.test(f.name); })
          .map(function (f) { return { name: f.name, path: f.path, sha: f.sha, size: f.size }; });
        return photoList;
      })
      .catch(function () { photoList = []; return photoList; });
  }

  /* Локально без GitHub: собираем список уникальных фото из каталога + заглушка. */
  function finishLocalPhotos() {
    var seen = {};
    photoList = [];
    (state.data && state.data.catalog ? state.data.catalog : []).forEach(function (c) {
      (c.items || []).forEach(function (it) {
        if (it.img && !seen[it.img]) {
          seen[it.img] = 1;
          photoList.push({ name: it.img.replace(/^assets\/img\//, ""), path: it.img, sha: "", size: 0 });
        }
      });
    });
    if (photoList.length < 5) {
      var fallback = ["__NEED_PHOTO__.jpg", "sm-skumbriya-gk.jpg", "sm-gorbusha-gk.jpg", "hero-caviar.jpg", "hero-table.jpg"];
      fallback.forEach(function (n) {
        var p = "assets/img/" + n;
        if (!seen[p]) { seen[p] = 1; photoList.push({ name: n, path: p, sha: "", size: 0 }); }
      });
    }
    return photoList;
  }

  /* Карта «путь фото → товар», чтобы показывать, где используется фото. */
  function photoUsageMap() {
    var map = {};
    (state.data ? state.data.catalog : []).forEach(function (c) {
      (c.items || []).forEach(function (it) {
        if (it.img && !map[it.img]) map[it.img] = it;
      });
    });
    return map;
  }

  function renderGallery() {
    var g = $("#gallery");
    if (!g) return;
    var cnt = $("#photo-count");
    if (cnt) cnt.textContent = photoList.length;

    if (!photoList.length) {
      g.innerHTML = '<div class="empty" style="grid-column:1/-1">Фото пока нет</div>';
      return;
    }
    var usage = photoUsageMap();
    var q = normName(state.photoQuery);
    // сколько товаров ссылаются на заглушку «ПОЧИНИ МЕНЯ»
    var stubCount = 0;
    (state.data ? state.data.catalog : []).forEach(function (c) {
      (c.items || []).forEach(function (it) { if (/__NEED_PHOTO__/.test(it.img || "")) stubCount++; });
    });
    g.innerHTML = photoList.filter(function (f) {
      return !q || normName(f.name).indexOf(q) > -1;
    }).map(function (f) {
      var owner = usage[f.path];
      var isStub = /\/__NEED_PHOTO__\./.test(f.path);
      var used = owner && !/__NEED_PHOTO__/.test(owner.img);
      // файл-заглушку удалять нельзя: на него ссылается много товаров без фото
      var canDelete = !used && !isStub && !state.isLocal && f.sha;
      return '' +
        '<div class="gal-item" data-file="' + esc(f.path) + '" title="' + esc(f.name) + '">' +
          '<img src="' + esc(f.path) + '?v=' + Date.now() + '" alt="" loading="lazy">' +
          '<span class="nm">' + esc(f.name) + "</span>" +
          (used
            ? '<span class="use used">у товара: ' + esc(owner.name) + "</span>"
            : isStub
              ? '<span class="use used">заглушка «нет фото»: ' + stubCount + " тов.</span>"
              : '<span class="use">не используется</span>') +
          '<div class="g-acts">' +
            '<button class="btn" data-gact="bind" data-gi="' + esc(f.path) + '">Привязать…</button>' +
            (canDelete ? '<button class="btn btn-danger" data-gact="del" data-gi="' + esc(f.path) + '">Удалить</button>' : "") +
          "</div>" +
        "</div>";
    }).join("");
  }

  /* ---------------- «Нужны фото» ---------------- */
  function renderNeed() {
    var root = $("#need-root");
    if (!root || !state.data) return;
    var cnt = $("#need-count");
    var rows = [];
    state.data.catalog.forEach(function (c) {
      (c.items || []).forEach(function (it) {
        if (!it.img || /__NEED_PHOTO__/.test(it.img)) rows.push({ cat: c, it: it });
      });
    });
    if (cnt) cnt.textContent = rows.length;

    if (!rows.length) {
      root.innerHTML = '<div class="empty" style="padding:14px">Все товары с фото. Отличная работа!</div>';
      return;
    }
    root.innerHTML = rows.map(function (r) {
      return '<div class="need-row">' +
        '<span class="nm">' + esc(r.it.name) + "</span>" +
        '<span class="ct">' + esc(r.cat.title) + "</span>" +
        '<button class="btn btn-sm btn-primary" data-np="' + esc(r.it.id) + '">Загрузить фото</button>' +
        "</div>";
    }).join("");
  }

  /* ---------------- загрузка фото ---------------- */
  function compressImage(file, maxW, quality) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        URL.revokeObjectURL(url);
        var w = img.width, h = img.height;
        if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
        var c = document.createElement("canvas");
        c.width = w; c.height = h;
        var ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        c.toBlob(function (blob) {
          if (!blob) return reject(new Error("Не удалось сжать"));
          resolve(blob);
        }, "image/jpeg", quality || 0.85);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("Файл не читается как изображение")); };
      img.src = url;
    });
  }

  function blobToB64(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () {
        var s = String(fr.result);
        resolve(s.slice(s.indexOf(",") + 1));
      };
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
  }

  /**
   * Загрузка фото в репозиторий.
   * opts.name — точное имя файла (напр. "<id товара>.jpg"); без него — slug + время.
   * opts.label — что писать в коммит после «Админка: загрузка фото …».
   */
  function uploadPhoto(file, opts) {
    opts = opts || {};
    var name = opts.name || (slug(file.name.replace(/\.[^.]+$/, "")) || "photo") + "-" + Date.now().toString(36) + ".jpg";
    var path = "assets/img/" + name;
    var commitLabel = opts.label || name;
    var uploadedSha = "";

    return compressImage(file, 1400, 0.86)
      .then(function (blob) {
        return blobToB64(blob).then(function (b64) {
          if (state.isLocal) {
            // штатный путь express — POST /api/admin/upload; fallback — dev-прокси vite
            var upBody = JSON.stringify({ path: path, content: b64 });
            var upHeaders = { "Content-Type": "application/json" };
            return fetch("/api/admin/upload", { method: "POST", headers: upHeaders, body: upBody })
              .then(function (r) {
                if (!r.ok) throw new Error("Ошибка загрузки фото на сервер (HTTP " + r.status + ")");
                return r.json();
              })
              .catch(function (e1) {
                return fetch("/api/upload", { method: "POST", headers: upHeaders, body: upBody })
                  .then(function (r2) {
                    if (!r2.ok) throw e1;
                    return r2.json();
                  });
              });
          }
          // у существующего файла GitHub требует sha: берём из photoList (loadPhotos),
          // если там пусто/не подошло — перечитываем и повторяем один раз
          var existing = null;
          photoList.forEach(function (f) { if (f.path === path && f.sha) existing = f; });
          var payload = {
            message: "Админка: загрузка фото " + commitLabel,
            content: b64,
            branch: state.branch
          };
          if (existing) payload.sha = existing.sha;
          return gh("/repos/" + state.repo + "/contents/" + path, { method: "PUT", body: payload })
            .catch(function (e) {
              if (e.status !== 422) throw e;
              return gh("/repos/" + state.repo + "/contents/" + path + "?ref=" + encodeURIComponent(state.branch))
                .then(function (file) {
                  payload.sha = file.sha;
                  return gh("/repos/" + state.repo + "/contents/" + path, { method: "PUT", body: payload });
                });
            })
            .then(function (res) {
              // запоминаем sha — понадобится, если фото захотят удалить
              uploadedSha = res && res.content && res.content.sha ? res.content.sha : (payload.sha || "");
              return res;
            });
        });
      })
      .then(function () {
        // обновляем/дополняем локальный список фото
        var found = null;
        photoList.forEach(function (f) { if (f.path === path) found = f; });
        if (found) { found.name = name; found.sha = uploadedSha || found.sha; }
        else photoList.push({ name: name, path: path, sha: uploadedSha || "", size: 0 });
        renderGallery();
        return path;
      });
  }

  /* Удаление фото из репозитория (только неиспользуемые). */
  function deletePhoto(path) {
    var f = null;
    photoList.forEach(function (x) { if (x.path === path) f = x; });
    if (!f) { toast("Фото не найдено", "err"); return; }
    // заглушка «ПОЧИНИ МЕНЯ» служит сотням товаров без фото — удалять нельзя
    if (/\/__NEED_PHOTO__\./.test(f.path)) {
      toast("Заглушку __NEED_PHOTO__ удалять нельзя — она показывается у товаров без фото", "err");
      return;
    }
    if (state.isLocal) { toast("В локальном режиме фото из папки не удаляется", "err"); return; }
    if (!f.sha) { toast("Нет sha файла — обновите список и попробуйте снова", "err"); return; }
    if (!confirm("Удалить файл " + f.name + " из репозитория? Действие необратимо.")) return;

    toast("Удаляю фото…");
    gh("/repos/" + state.repo + "/contents/" + f.path, {
      method: "DELETE",
      body: {
        message: "Админка: удаление фото " + f.name,
        sha: f.sha,
        branch: state.branch
      }
    }).then(function () {
      photoList = photoList.filter(function (x) { return x.path !== path; });
      renderGallery();
      toast("Фото удалено", "ok");
    }).catch(function (e) {
      toast("Не удалось удалить: " + e.message, "err");
    });
  }

  /* ---------------- ассистент «фото → товар» ---------------- */

  /* Подбирает до 3 товаров, чьи названия похожи на имя файла. */
  function matchItemsForFile(fileName) {
    var base = normName(String(fileName).replace(/\.[^.]+$/, ""));
    var scored = [];
    (state.data ? state.data.catalog : []).forEach(function (c) {
      (c.items || []).forEach(function (it) {
        var s = fuzzyScore(base, it.name);
        if (s > 0) scored.push({ cat: c, it: it, s: s });
      });
    });
    scored.sort(function (a, b) { return b.s - a.s; });
    return scored.slice(0, 3).map(function (x) { return { catId: x.cat.id, catTitle: x.cat.title, itemId: x.it.id, name: x.it.name }; });
  }

  /* Варианты в select строки очереди: совпадения + все товары по группам (или поиск). */
  function queueSelectHTML(row, qi, query) {
    var d = state.data;
    var selectedId = row.chosen || "";
    var html = '<option value="">— выберите товар вручную —</option>';

    if (!query && row.matches.length) {
      html += '<optgroup label="Похожие по имени файла">';
      row.matches.forEach(function (m) {
        html += '<option value="' + esc(m.itemId) + '"' + (m.itemId === selectedId ? " selected" : "") + ">" + esc(m.name) + "</option>";
      });
      html += "</optgroup>";
    }

    var q = normName(query);
    d.catalog.forEach(function (c) {
      var rows = (c.items || []).filter(function (it) {
        return !q || normName(it.name).indexOf(q) > -1;
      });
      if (!rows.length) return;
      html += '<optgroup label="' + esc(c.title) + '">';
      rows.forEach(function (it) {
        html += '<option value="' + esc(it.id) + '"' + (it.id === selectedId ? " selected" : "") + ">" + esc(it.name) + "</option>";
      });
      html += "</optgroup>";
    });
    return html;
  }

  function renderQueue() {
    var box = $("#upload-queue");
    var bar = $("#queue-bar");
    if (!box) return;
    if (!state.queue.length) {
      box.innerHTML = "";
      if (bar) bar.style.display = "none";
      return;
    }
    if (bar) bar.style.display = "flex";
    box.innerHTML = state.queue.map(function (row, qi) {
      if (row.done) {
        return '<div class="q-row done" data-qi="' + qi + '">' +
          '<img src="' + esc(row.thumb) + '" alt="">' +
          '<div class="q-main"><div class="q-name">' + esc(row.file.name) + "</div>" +
          '<div class="q-controls"><span style="color:#7ee2a0;font-size:.84rem">Готово: ' + esc(row.doneText || "загружено") + "</span></div></div>" +
          '<div class="q-acts"></div></div>';
      }
      return '' +
        '<div class="q-row" data-qi="' + qi + '">' +
          '<img src="' + esc(row.thumb) + '" alt="">' +
          '<div class="q-main">' +
            '<div class="q-name">' + esc(row.file.name) + (row.matches.length ? "" : " · похожих товаров не найдено") + "</div>" +
            '<div class="q-controls">' +
              '<select class="q-select" data-qsel="' + qi + '">' + queueSelectHTML(row, qi, "") + "</select>" +
              '<input type="search" class="q-search" data-qsearch="' + qi + '" placeholder="поиск товара…">' +
            "</div>" +
          "</div>" +
          '<div class="q-acts">' +
            '<button class="btn btn-sm btn-primary" data-qact="bind" data-qi="' + qi + '">Загрузить и привязать</button>' +
          "</div>" +
        "</div>";
    }).join("");
  }

  /* Выбор файлов: строим очередь с предположениями, грузим по кнопкам. */
  function handleFiles(files) {
    var arr = Array.prototype.slice.call(files || []);
    if (!arr.length) return;
    arr.forEach(function (f) {
      // часть камер/систем отдаёт пустой type — проверяем и расширение
      if (!/^image\//.test(f.type) && !/\.(jpe?g|png|webp|gif|bmp|svg)$/i.test(f.name)) return;
      state.queue.push({
        file: f,
        thumb: URL.createObjectURL(f),
        matches: matchItemsForFile(f.name),
        chosen: "",
        done: false
      });
    });
    // предвыбор лучшего совпадения
    state.queue.forEach(function (row) {
      if (!row.chosen && row.matches.length) row.chosen = row.matches[0].itemId;
    });
    renderQueue();
    toast("Файлов в очереди: " + state.queue.filter(function (r) { return !r.done; }).length + ". Проверьте соответствие и нажмите «Загрузить и привязать».");
  }

  /* Загрузка одной строки очереди с привязкой к товару. */
  function queueBindOne(qi) {
    var row = state.queue[qi];
    if (!row || row.done) return;
    var f = itemById(row.chosen);
    if (!f) { toast("Сначала выберите товар для «" + row.file.name + "»", "err"); return; }

    var btns = $$('#upload-queue [data-qact="bind"][data-qi="' + qi + '"]');
    btns.forEach(function (b) { b.disabled = true; });
    toast("Загружаю «" + row.file.name + "» → " + f.item.name);

    uploadPhoto(row.file, { name: f.item.id + ".jpg", label: "«" + f.item.name + "» (" + row.file.name + ")" })
      .then(function (path) {
        f.item.img = path;
        bump(1);
        row.done = true;
        row.doneText = f.item.name;
        renderQueue();
        renderItems(); renderNeed(); renderDash();
        toast("Фото привязано к «" + f.item.name + "». Не забудьте «Сохранить на сайт».", "ok");
      })
      .catch(function (e) {
        btns.forEach(function (b) { b.disabled = false; });
        toast("Ошибка загрузки: " + e.message, "err");
      });
  }

  /* Загрузка всей очереди как раньше — slug + время, без привязки. */
  function queueUploadAll() {
    var pending = state.queue.filter(function (r) { return !r.done; });
    if (!pending.length) { toast("Нет файлов в очереди"); return; }
    var i = 0, done = 0;
    toast("Загружаю фото: 0/" + pending.length);

    function next() {
      if (i >= pending.length) {
        renderQueue(); renderDash();
        toast("Загружено фото: " + done + ". Нажмите «Сохранить на сайт».", "ok");
        return;
      }
      var row = pending[i++];
      uploadPhoto(row.file).then(function () {
        row.done = true;
        row.doneText = "без привязки";
        done++;
        renderQueue();
        toast("Загружаю фото: " + done + "/" + pending.length);
        next();
      }).catch(function (e) {
        toast("Ошибка загрузки: " + e.message, "err");
        next();
      });
    }
    next();
  }

  /* Быстрая загрузка фото для позиции из списка «Нужны фото». */
  function needPhotoPick(itemId) {
    var f = itemById(itemId);
    if (!f) return;
    var inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.onchange = function () {
      if (!inp.files.length) return;
      toast("Загружаю фото для «" + f.item.name + "»…");
      uploadPhoto(inp.files[0], { name: f.item.id + ".jpg", label: "«" + f.item.name + "»" })
        .then(function (path) {
          f.item.img = path;
          bump(1);
          renderItems(); renderNeed(); renderDash(); renderGallery();
          toast("Фото загружено и привязано к «" + f.item.name + "»", "ok");
        })
        .catch(function (e) { toast(e.message, "err"); });
    };
    inp.click();
  }

  /* ---------------- промокоды ---------------- */
  function renderPromos() {
    var root = $("#promos-list");
    if (!root || !state.data) return;
    var promos = (state.data.shop && state.data.shop.promos) || [];
    var cnt = $("#promo-count");
    if (cnt) cnt.textContent = promos.filter(function (p) { return p.active !== false; }).length + " / " + promos.length;

    if (!promos.length) {
      root.innerHTML = '<div class="empty" style="padding:12px">Промокодов пока нет. Добавьте первый ниже.</div>';
      return;
    }
    root.innerHTML = promos.map(function (p, i) {
      var off = p.active === false ? " p-off" : "";
      return '<div class="promo-row' + off + '" data-pi="' + i + '">' +
        '<input type="text" data-pk="code" value="' + esc(p.code || "") + '" placeholder="КОД" style="text-transform:uppercase">' +
        '<select data-pk="type">' +
          '<option value="percent"' + (p.type === "percent" ? " selected" : "") + ">процент, %</option>" +
          '<option value="fixed"' + (p.type !== "percent" ? " selected" : "") + ">фикс. сумма, ₽</option>" +
        "</select>" +
        '<input type="number" data-pk="value" min="1" value="' + esc(p.value == null ? "" : p.value) + '" placeholder="Размер">' +
        '<input type="number" data-pk="minSum" min="0" value="' + esc(p.minSum == null ? "" : p.minSum) + '" placeholder="Мин. сумма">' +
        '<label class="check" title="Активен"><input type="checkbox" data-pk="active"' + (p.active !== false ? " checked" : "") + "> вкл</label>" +
        '<button class="btn btn-sm btn-danger promo-del" data-pdel="' + i + '">×</button>' +
        "</div>";
    }).join("");
  }

  function ensurePromos() {
    if (!state.data) return;
    if (!state.data.shop) state.data.shop = {};
    if (!Array.isArray(state.data.shop.promos)) state.data.shop.promos = [];
  }

  function addPromo() {
    ensurePromos();
    var code = $("#promo-code").value.trim().toUpperCase();
    var type = $("#promo-type").value;
    var value = Number($("#promo-value").value);
    var minRaw = $("#promo-min").value.trim();
    var minSum = minRaw === "" ? null : Number(minRaw);
    if (!code) { toast("Введите код промокода", "err"); return; }
    if (!(value > 0)) { toast("Размер скидки должен быть больше нуля", "err"); return; }
    if (type === "percent" && value > 99) { toast("Процент скидки: от 1 до 99", "err"); return; }
    var dup = state.data.shop.promos.some(function (p) {
      return String(p.code || "").toUpperCase() === code;
    });
    if (dup) { toast("Такой код уже есть", "err"); return; }
    state.data.shop.promos.push({ code: code, type: type, value: value, minSum: minSum, active: true });
    $("#promo-code").value = ""; $("#promo-value").value = ""; $("#promo-min").value = "";
    bump(1);
    renderPromos(); renderDash();
    toast("Промокод «" + code + "» добавлен", "ok");
  }

  /* ---------------- заказы (через серверный API) ---------------- */
  var ORDERS_API = (function () {
    if (window.IKRA_API_URL) return String(window.IKRA_API_URL).replace(/\/$/, "");
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return "http://localhost:8080";
    return "https://ikra-shop.up.railway.app";
  })();

  function apiFetch(path, opts) {
    opts = opts || {};
    var cfg = {
      method: opts.method || "GET",
      credentials: "include",
      headers: Object.assign({ Accept: "application/json" }, opts.headers || {})
    };
    if (opts.body !== undefined) {
      cfg.headers["Content-Type"] = "application/json";
      cfg.body = JSON.stringify(opts.body);
    }
    return fetch(ORDERS_API + path, cfg).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) {
          var e = new Error(d.error || "Ошибка " + r.status);
          e.status = r.status;
          throw e;
        }
        return d;
      });
    });
  }

  var STATUS_LABEL = {
    pending: "Ожидает оплаты",
    paid: "Оплачен",
    canceled: "Отменён",
    expired: "Истёк",
    refunded: "Возврат",
    failed: "Ошибка"
  };

  function money2(cents) {
    return new Intl.NumberFormat("ru-RU").format(Math.round(cents / 100)) + " ₽";
  }

  function renderOrders(data) {
    var root = $("#orders-list");
    var statsEl = $("#orders-stats");
    if (!root) return;

    if (statsEl && Array.isArray(data.stats)) {
      statsEl.innerHTML = data.stats.map(function (s) {
        return '<div class="order-stat">' +
          '<span class="lbl">' + esc(STATUS_LABEL[s.status] || s.status) + "</span>" +
          '<b class="val">' + s.n + "</b>" +
          '<span class="sum">' + money2(s.sum_cents || 0) + "</span>" +
        "</div>";
      }).join("") || '<div class="empty">Заказов пока нет</div>';
    }

    if (!data.orders || !data.orders.length) {
      root.innerHTML = '<div class="empty">Заказов с таким статусом нет</div>';
      return;
    }

    root.innerHTML = data.orders.map(function (o) {
      var lines = (o.items && o.items.lines ? o.items.lines : []).map(function (l) {
        return "<div class='order-line'>" + esc(l.name) + " × " + l.qty + " — " + money2(l.sum * 100) + "</div>";
      }).join("");
      var stClass = o.status === "paid" ? "gold" : (o.status === "pending" ? "" : "hot");
      return '' +
        '<details class="order-row">' +
          "<summary>" +
            '<span class="order-id">#' + esc(String(o.id).slice(0, 8)) + "</span>" +
            '<span class="order-date">' + new Date(o.createdAt).toLocaleString("ru-RU") + "</span>" +
            '<span class="order-name">' + esc(o.name) + "</span>" +
            '<span class="order-total">' + money2(o.total * 100) + "</span>" +
            '<span class="tag ' + stClass + '">' + esc(STATUS_LABEL[o.status] || o.status) + "</span>" +
          "</summary>" +
          '<div class="order-body">' +
            "<div><b>Телефон:</b> " + esc(o.phone) + "</div>" +
            "<div><b>Адрес:</b> " + esc(o.address || "—") + "</div>" +
            "<div><b>Доставка:</b> " + esc(o.delivery) + " · <b>Оплата:</b> " + esc(o.payment) + "</div>" +
            (o.comment ? "<div><b>Комментарий:</b> " + esc(o.comment) + "</div>" : "") +
            '<div class="order-lines">' + lines + "</div>" +
            '<div class="inline" style="margin-top:10px">' +
              '<select data-order-status="' + esc(o.id) + '">' +
                Object.keys(STATUS_LABEL).map(function (k) {
                  return '<option value="' + k + '"' + (k === o.status ? " selected" : "") + ">" + STATUS_LABEL[k] + "</option>";
                }).join("") +
              "</select>" +
              '<a class="btn btn-sm" target="_blank" rel="noopener" href="https://wa.me/' + esc(String(o.phone).replace(/\D/g, "").replace(/^8/, "7")) + '">WhatsApp</a>' +
            "</div>" +
          "</div>" +
        "</details>";
    }).join("");
  }

  function loadOrders() {
    var filter = $("#orders-filter") ? $("#orders-filter").value : "";
    var note = $("#orders-api-note");
    var list = $("#orders-list");
    if (list) list.innerHTML = '<div class="empty">Загружаю…</div>';
    return apiFetch("/api/orders" + (filter ? "?status=" + encodeURIComponent(filter) : ""))
      .then(function (d) {
        if (note) note.style.display = "none";
        renderOrders(d);
      })
      .catch(function (e) {
        if (note) {
          note.style.display = "block";
          note.textContent = "Не удалось получить заказы: " + e.message +
            ". Проверьте, что сервер запущен и вы вошли как администратор через Google.";
        }
        var root = $("#orders-list");
        if (root) root.innerHTML = '<div class="empty">Заказы недоступны</div>';
      });
  }

  /* ---------------- экспорт: JSON-копия и прайс CSV ---------------- */
  function downloadBackup() {
    var blob = new Blob([JSON.stringify(state.data, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "ikra-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Копия скачана", "ok");
  }

  /* Строка CSV: экранируем точку с запятой и кавычки. */
  function csvCell(v) {
    var s = v == null ? "" : String(v);
    if (/[;"\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function downloadCsvPrice() {
    var rows = ["Категория;Товар;Фасовка;Цена;Единица"];
    (state.data ? state.data.catalog : []).forEach(function (c) {
      (c.items || []).forEach(function (it) {
        var unit = it.piece ? "за упаковку" : (it.unit === "кг" ? "за кг" : "за шт");
        var packs = Array.isArray(it.packs) && it.packs.length ? it.packs : null;
        if (packs) {
          packs.forEach(function (p) {
            var price = p.total != null ? p.total : (p.price != null ? p.price : it.price);
            rows.push([c.title, it.name, p.weight || it.weight || "", price == null ? "" : price, unit].map(csvCell).join(";"));
          });
        } else {
          rows.push([c.title, it.name, it.weight || "", it.price == null ? "" : it.price, unit].map(csvCell).join(";"));
        }
      });
    });
    // BOM — чтобы Excel открывал кириллицу корректно
    var blob = new Blob(["\uFEFF" + rows.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "ikra-price-" + new Date().toISOString().slice(0, 10) + ".csv";
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Прайс скачан (CSV)", "ok");
  }

  /* ---------------- настройки магазина и оплаты ---------------- */
  function fillShop() {
    var s = state.data.shop || {};
    $$("[data-shop]").forEach(function (el) {
      var k = el.dataset.shop;
      if (el.type === "checkbox") el.checked = !!s[k];
      else el.value = s[k] == null ? "" : s[k];
    });
    var p = state.data.payments || {};
    $$("[data-pay]").forEach(function (el) {
      var k = el.dataset.pay;
      if (k === "orderEndpoint") el.value = state.data.orderEndpoint || "";
      else el.value = p[k] == null ? "" : p[k];
    });
  }

  /* Числовое поле: пусто → null, иначе число. */
  function fieldNumber(el) {
    var v = el.value.trim();
    return v === "" ? null : Number(v);
  }

  function bindShopInputs() {
    $$("[data-shop]").forEach(function (el) {
      el.addEventListener("input", function () {
        var k = el.dataset.shop;
        if (el.type === "checkbox") state.data.shop[k] = el.checked;
        else if (el.type === "number") state.data.shop[k] = fieldNumber(el);
        else state.data.shop[k] = el.value;
        markFieldDirty("shop:" + k); // одно изменение на поле, а не на каждый символ
      });
    });
    $$("[data-pay]").forEach(function (el) {
      el.addEventListener("input", function () {
        var k = el.dataset.pay;
        if (k === "orderEndpoint") state.data.orderEndpoint = el.value;
        else state.data.payments[k] = el.value;
        markFieldDirty("pay:" + k);
      });
    });
  }

  /* ---------------- модалки ---------------- */
  function closeModal(sel) {
    var m = $(sel);
    if (m) m.classList.remove("on");
  }

  /* Закрытие с защитой: изменённую форму товара/категории не гасим молча. */
  function requestCloseModal(m) {
    if (!m || !m.classList.contains("on")) return;
    if ((m.id === "modal-item" || m.id === "modal-cat") && state.formChanged) {
      if (!confirm("Форма изменена. Закрыть без сохранения?")) return;
    }
    m.classList.remove("on");
    if (m.id === "modal-bind") state.bindCb = null;
    if (m.id === "modal-item" || m.id === "modal-cat") state.formChanged = false;
  }

  /* Верхняя открытая модалка (последняя в DOM — она же визуально верхняя). */
  function topOpenModal() {
    var open = $$(".modal-back.on");
    return open.length ? open[open.length - 1] : null;
  }

  /* ---------------- вход ---------------- */
  function doLogin() {
    var repo = $("#in-repo").value.trim();
    var token = $("#in-token").value.trim();
    var branch = $("#in-branch").value.trim() || "main";

    if (!repo || !token) { toast("Заполните репозиторий и токен", "err"); return; }
    if (repo.indexOf("/") === -1) { toast("Репозиторий в формате владелец/название", "err"); return; }

    state.repo = repo;
    state.token = token;
    state.branch = branch;

    var btn = $("#btn-login");
    btn.disabled = true;
    btn.textContent = "Проверяю…";

    loadFromRepo()
      .then(function () {
        localStorage.setItem(LS.repo, repo);
        localStorage.setItem(LS.token, token);
        localStorage.setItem(LS.branch, branch);
        startApp();
      })
      .catch(function (e) {
        toast(e.message, "err");
        btn.disabled = false;
        btn.textContent = "Войти через GitHub токен";
      });
  }

  function startApp() {
    $("#login").style.display = "none";
    $("#shell").classList.add("on");

    fillShop();
    renderCats();     // заодно наполняет фильтр, bulk-move и селекты очереди
    renderItems();
    renderPromos();
    renderNeed();
    renderDash();
    updateStatus(true, "Подключено: " + state.repo + (state.isLocal ? " (локально)" : ""));
    setDirty(false);

    var hist = $("#btn-history");
    if (hist) hist.href = "https://github.com/" + state.repo + "/commits/" + state.branch + "/" + DATA_PATH;

    loadPhotos().then(function () { renderGallery(); });

    // отступ строки сохранения под липкой панелью вкладок (мобильный режим)
    setTimeout(syncMobileBarH, 0);
  }

  /* ---------------- сохранение ---------------- */
  function doSave() {
    var btn = $("#btn-save");
    btn.disabled = true;
    btn.textContent = "Сохраняю каталог…";

    var d = state.data;
    var n = allItemsCount();
    var msg = "Админка: обновление каталога (" + n + " товаров, " + d.catalog.length + " категорий)";

    saveToRepo(msg, function () {
      // стадия между коммитом каталога и резервной копией
      btn.textContent = "Обновляю резервную копию…";
    })
      .then(function () {
        setDirty(false);
        renderDash();
        if (state.isLocal) {
          updateStatus(true, "Сохранено локально в data/catalog.json");
          toast("Каталог успешно сохранён локально!", "ok");
        } else {
          updateStatus(true, "Сохранено. Сайт обновится через 1-2 минуты");
          toast("Сохранено. GitHub Pages обновится в течение 1-2 минут.", "ok");
        }
      })
      .catch(function (e) {
        toast("Не сохранено: " + e.message, "err");
        updateStatus(false, "Ошибка сохранения");
      })
      .then(function () {
        btn.disabled = false;
        btn.textContent = "Сохранить на сайт";
      });
  }

  /* ---------------- обработчики ---------------- */
  function bindAll() {
    $("#btn-login").addEventListener("click", doLogin);
    $("#in-token").addEventListener("keydown", function (e) {
      if (e.key === "Enter") doLogin();
    });

    // Яндекс-вход для администратора (redirect=admin: сервер проверит is_admin)
    var yandexBtn = $("#btn-login-yandex");
    if (yandexBtn) {
      yandexBtn.addEventListener("click", function () {
        window.location.href = ORDERS_API + "/api/auth/yandex/start?redirect=admin";
      });
    }

    // Заказы
    var ordersReload = $("#btn-orders-reload");
    if (ordersReload) ordersReload.addEventListener("click", loadOrders);
    var ordersFilter = $("#orders-filter");
    if (ordersFilter) ordersFilter.addEventListener("change", loadOrders);

    var ordersList = $("#orders-list");
    if (ordersList) {
      ordersList.addEventListener("change", function (e) {
        var sel = e.target.closest("[data-order-status]");
        if (!sel) return;
        apiFetch("/api/orders/" + encodeURIComponent(sel.dataset.orderStatus) + "/status", {
          method: "PATCH",
          body: { status: sel.value }
        })
          .then(function () { toast("Статус заказа обновлён", "ok"); loadOrders(); })
          .catch(function (err) { toast("Не удалось обновить: " + err.message, "err"); });
      });
    }

    var localBtn = $("#btn-login-local");
    if (localBtn) {
      localBtn.addEventListener("click", function () {
        state.isLocal = true;
        state.repo = "Локальный каталог";
        state.branch = "local";
        $("#in-repo").value = state.repo;
        updateStatus(null, "Загрузка локального каталога…");
        loadFromRepo()
          .then(startApp)
          .then(function () {
            toast("Вход выполнен в локальном режиме", "ok");
          })
          .catch(function (e) {
            toast(e.message, "err");
          });
      });
    }

    $("#btn-logout").addEventListener("click", function () {
      if (state.dirty && !confirm("Есть несохранённые изменения. Выйти без сохранения?")) return;
      localStorage.removeItem(LS.token);
      location.reload();
    });

    // вкладки
    $$(".tab-btn[data-tab]").forEach(function (b) {
      b.addEventListener("click", function () { switchTab(b.dataset.tab); });
    });

    $("#btn-save").addEventListener("click", doSave);

    $("#btn-reload").addEventListener("click", function () {
      if (state.dirty && !confirm("Несохранённые изменения (" + state.changes + ") будут потеряны. Продолжить?")) return;
      loadFromRepo().then(function () {
        fillShop(); renderCats(); renderItems(); renderPromos(); renderNeed(); renderDash();
        setDirty(false);
        updateStatus(true, "Обновлено из репозитория");
        toast("Данные обновлены", "ok");
      }).catch(function (e) { toast(e.message, "err"); });
    });

    /* ----- дашборд ----- */
    $("#panel-dash").addEventListener("click", function (e) {
      var st = e.target.closest(".stat[data-djump]");
      if (st) { dashJump(st.dataset.djump); return; }
      if (e.target.closest("#dash-add-item")) {
        if (!state.data.catalog.length) { toast("Сначала создайте категорию", "err"); return; }
        switchTab("items");
        openItemModal(state.data.catalog[0].id, null);
        return;
      }
      if (e.target.closest("#dash-upload-photo")) {
        switchTab("photos");
        var fi = $("#file-input");
        if (fi) fi.click();
        return;
      }
      if (e.target.closest("#dash-export")) { downloadBackup(); return; }
      if (e.target.closest("#dash-csv")) { downloadCsvPrice(); return; }
    });

    /* ----- фильтры товаров ----- */
    $("#items-search").addEventListener("input", function () {
      state.itemsQuery = this.value;
      renderItems();
    });
    $("#items-cat-filter").addEventListener("change", function () {
      state.itemsCat = this.value;
      renderItems();
    });
    $$(".chip").forEach(function (ch) {
      ch.addEventListener("click", function () {
        state.itemsChip = ch.dataset.chip;
        syncChipsUI();
        renderItems();
      });
    });

    /* ----- массовые действия ----- */
    $("#bulk-percent-apply").addEventListener("click", bulkApplyPercent);
    $("#bulk-percent").addEventListener("keydown", function (e) {
      if (e.key === "Enter") bulkApplyPercent();
    });
    $("#bulk-clear-badge").addEventListener("click", function () { bulkSetBadge(""); });
    $$("#bulk-bar [data-badge]").forEach(function (b) {
      b.addEventListener("click", function () { bulkSetBadge(b.dataset.badge); });
    });
    $("#bulk-move").addEventListener("change", function () {
      if (this.value) bulkMove(this.value);
    });
    $("#bulk-del").addEventListener("click", bulkDelete);
    $("#bulk-sel-clear").addEventListener("click", clearSelection);

    /* ----- товары ----- */
    $("#btn-add-item").addEventListener("click", function () {
      if (!state.data.catalog.length) { toast("Сначала создайте категорию", "err"); return; }
      openItemModal(state.data.catalog[0].id, null);
    });

    $("#items-root").addEventListener("click", function (e) {
      // клик по цене — инлайн-редактирование
      var priceCell = e.target.closest("[data-price-ci]");
      if (priceCell && e.target.tagName !== "INPUT") { startPriceEdit(priceCell); return; }

      var b = e.target.closest("button[data-act]");
      if (!b) return;
      var act = b.dataset.act;
      var ci = Number(b.dataset.ci);
      var ii = b.dataset.ii != null ? Number(b.dataset.ii) : null;
      var cat = state.data.catalog[ci];

      if (act === "add-here") { openItemModal(cat.id, null); return; }

      if (act === "sel-cat") {
        // выбрать/снять все товары категории
        var allSelected = cat.items.length > 0 && cat.items.every(function (it) { return state.selected[it.id]; });
        cat.items.forEach(function (it) {
          if (allSelected) delete state.selected[it.id];
          else state.selected[it.id] = true;
        });
        renderItems();
        return;
      }

      if (act === "edit") {
        openItemModal(cat.id, cat.items[ii].id);
      } else if (act === "dup") {
        var copy = JSON.parse(JSON.stringify(cat.items[ii]));
        copy.id = slug(copy.name) + "-" + Date.now().toString(36).slice(-4);
        copy.name = copy.name + " (копия)";
        cat.items.splice(ii + 1, 0, copy);
        bump(1); renderItems(); renderDash();
        toast("Создана копия товара", "ok");
      } else if (act === "up" || act === "down") {
        var j = act === "up" ? ii - 1 : ii + 1;
        if (j < 0 || j >= cat.items.length) return;
        var tmp = cat.items[ii];
        cat.items[ii] = cat.items[j];
        cat.items[j] = tmp;
        bump(1); renderItems();
      } else if (act === "del") {
        var victim = cat.items[ii];
        if (!victim) return;
        if (!confirm("Удалить «" + victim.name + "»?")) return;
        cat.items.splice(ii, 1);
        delete state.selected[victim.id];
        bump(1); renderItems(); renderDash(); renderNeed();
        // 8 секунд на то, чтобы передумать
        toast("Товар удалён", "ok", "Вернуть", function () {
          // категория могла быть удалена/пересоздана после товара — ищем заново
          var cur = catById(cat.id);
          if (!cur) { toast("Категория «" + cat.title + "» удалена — вернуть товар некуда", "err"); return; }
          cur.items.splice(Math.min(ii, cur.items.length), 0, victim);
          bump(1); // иначе «Вернуть» не пометит dirty и товар пропадёт после перезагрузки
          renderItems(); renderCats(); renderDash(); renderNeed();
          toast("Товар возвращён. Нажмите «Сохранить на сайт».", "ok");
        }, 8000);
      }
    });

    // чекбоксы выбора товаров
    $("#items-root").addEventListener("change", function (e) {
      var cb = e.target.closest("[data-sel]");
      if (!cb) return;
      if (cb.checked) state.selected[cb.dataset.sel] = true;
      else delete state.selected[cb.dataset.sel];
      var row = cb.closest(".item");
      if (row) row.classList.toggle("selected", cb.checked);
      renderBulkBar();
    });

    /* ----- категории ----- */
    $("#btn-add-cat").addEventListener("click", function () { openCatModal(null); });

    $("#cats-root").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-cact]");
      if (!b) return;
      var ci = Number(b.dataset.ci);
      var act = b.dataset.cact;
      var d = state.data;

      if (act === "edit") { openCatModal(ci); return; }

      if (act === "up" || act === "down") {
        var j = act === "up" ? ci - 1 : ci + 1;
        if (j < 0 || j >= d.catalog.length) return;
        var tmp = d.catalog[ci];
        d.catalog[ci] = d.catalog[j];
        d.catalog[j] = tmp;
        bump(1); renderCats(); renderItems();
        return;
      }

      var c = d.catalog[ci];
      var msg = c.items.length
        ? "В категории «" + c.title + "» " + c.items.length + " товаров. Удалить вместе с ними?"
        : "Удалить категорию «" + c.title + "»?";
      if (!confirm(msg)) return;
      // Снимок до удаления: для кнопки «Вернуть» (тост живёт 10 секунд)
      var removedCat = JSON.parse(JSON.stringify(c));
      var removedIdx = ci;
      d.catalog.splice(ci, 1);
      bump(1); renderItems(); renderCats(); renderDash();
      toast("Категория удалена", "ok", "Вернуть", function () {
        d.catalog.splice(Math.min(removedIdx, d.catalog.length), 0, removedCat);
        bump(1); renderCats(); renderItems(); renderDash();
        toast("Категория восстановлена", "ok");
      }, 10000);
    });

    /* ----- модалка товара ----- */
    $("#mi-save").addEventListener("click", saveItem);
    $("#mi-cancel").addEventListener("click", function () { requestCloseModal($("#modal-item")); });
    $("#mi-img").addEventListener("input", updatePrev);
    $("#mi-need").addEventListener("click", markNeedPhoto);
    $("#mi-piece").addEventListener("change", syncPackSummary);
    $("#mi-unit").addEventListener("change", syncPackSummary);

    // поля «цена / всего / фасовка» синхронизируются с основной строкой фасовок
    function syncMainFromSummary(field) {
      var draft = state.packDraft || [];
      if (!draft.length) return;
      var mainIdx = 0;
      draft.forEach(function (p, i) { if (p.__main) mainIdx = i; });
      if (mainIdx >= draft.length) mainIdx = 0;
      if (field === "weight") draft[mainIdx].weight = $("#mi-weight").value;
      if (field === "price") draft[mainIdx].price = $("#mi-price").value;
      if (field === "total") draft[mainIdx].total = $("#mi-packprice").value;
      // обновляем строки фасовок, не трогая поля, которые сейчас редактируют
      var box = $("#mi-packs");
      if (!box) return;
      var p = draft[mainIdx];
      var set = function (sel, val) {
        var el2 = box.querySelector(sel);
        if (el2 && document.activeElement !== el2) el2.value = val == null ? "" : val;
      };
      set('[data-pw="' + mainIdx + '"]', p.weight);
      set('[data-pp="' + mainIdx + '"]', p.price);
      set('[data-pt="' + mainIdx + '"]', p.total);
    }
    $("#mi-weight").addEventListener("input", function () { syncMainFromSummary("weight"); });
    $("#mi-price").addEventListener("input", function () { syncMainFromSummary("price"); });
    $("#mi-packprice").addEventListener("input", function () { syncMainFromSummary("total"); });

    $("#mi-packs-add").addEventListener("click", function () {
      if (!state.packDraft) state.packDraft = [];
      state.packDraft.push({ weight: "", price: "", total: "" });
      if (state.packDraft.length === 1) state.packDraft[0].__main = true;
      renderPackRows();
    });

    // клики по блоку фасовок: удалить строку, выбрать основную
    $("#mi-packs").addEventListener("click", function (e) {
      var del = e.target.closest("[data-pdel]");
      if (del) {
        var di = Number(del.dataset.pdel);
        var wasMain = state.packDraft[di] && state.packDraft[di].__main;
        state.packDraft.splice(di, 1);
        if (wasMain && state.packDraft.length) state.packDraft[0].__main = true;
        renderPackRows();
        return;
      }
    });
    $("#mi-packs").addEventListener("change", function (e) {
      var radio = e.target.closest("[data-pradio]");
      if (radio) {
        var ri = Number(radio.dataset.pradio);
        state.packDraft.forEach(function (p, i) { p.__main = i === ri; });
        renderPackRows();
        return;
      }
    });
    // правка полей фасовки: пишем в черновик, основная — обновляет сводку
    $("#mi-packs").addEventListener("input", function (e) {
      var t = e.target;
      var box = t.closest(".pack-row");
      if (!box) return;
      var pi = Number(box.dataset.pi);
      var p = state.packDraft[pi];
      if (!p) return;
      if (t.dataset.pw != null) p.weight = t.value;
      if (t.dataset.pp != null) p.price = t.value;
      if (t.dataset.pt != null) p.total = t.value;
      if (p.__main) syncPackSummary();
    });

    $("#mi-pick").addEventListener("click", function () {
      state.imgTarget = function (path) {
        $("#mi-img").value = path;
        updatePrev();
      };
      $("#gal-pick").innerHTML = photoList.map(function (f) {
        return '<div class="gal-item pick" data-file="' + esc(f.path) + '">' +
          '<img src="' + esc(f.path) + '?v=' + Date.now() + '" alt="">' +
          '<span class="nm">' + esc(f.name) + "</span></div>";
      }).join("") || '<div class="empty" style="grid-column:1/-1">Фото нет</div>';
      $("#modal-gallery").classList.add("on");
      setTimeout(function () { var c = $("#gal-cancel"); if (c) c.focus(); }, 60);
    });

    $("#gal-pick").addEventListener("click", function (e) {
      var g = e.target.closest(".gal-item");
      if (!g) return;
      if (state.imgTarget) state.imgTarget(g.dataset.file);
      closeModal("#modal-gallery");
    });
    $("#gal-cancel").addEventListener("click", function () { closeModal("#modal-gallery"); });

    $("#mi-upload").addEventListener("click", function () {
      var inp = document.createElement("input");
      inp.type = "file";
      inp.accept = "image/*";
      inp.onchange = function () {
        if (!inp.files.length) return;
        toast("Загружаю фото…");
        uploadPhoto(inp.files[0]).then(function (path) {
          $("#mi-img").value = path;
          updatePrev();
          toast("Фото загружено", "ok");
        }).catch(function (e) { toast(e.message, "err"); });
      };
      inp.click();
    });

    /* ----- модалка категории ----- */
    $("#mc-save").addEventListener("click", saveCat);
    $("#mc-cancel").addEventListener("click", function () { requestCloseModal($("#modal-cat")); });
    $("#mc-id").addEventListener("input", function () {
      var warn = $("#mc-id-warn");
      if (warn) {
        var orig = $("#mc-id").dataset.orig || "";
        warn.style.display = orig && this.value.trim() !== orig ? "block" : "none";
      }
    });

    /* ----- модалка привязки фото ----- */
    $("#bind-search").addEventListener("input", function () {
      renderBindResults(this.value);
    });
    $("#bind-results").addEventListener("click", function (e) {
      var b = e.target.closest("[data-bind-id]");
      if (!b || !state.bindCb) return;
      var cb = state.bindCb;
      state.bindCb = null;
      closeModal("#modal-bind");
      cb(b.dataset.bindId);
    });
    $("#bind-cancel").addEventListener("click", function () {
      state.bindCb = null;
      closeModal("#modal-bind");
    });

    /* ----- фото: зона загрузки ----- */
    var drop = $("#drop"), fi = $("#file-input");
    if (drop) {
      drop.addEventListener("click", function () { fi.click(); });
      drop.addEventListener("dragover", function (e) { e.preventDefault(); drop.classList.add("over"); });
      drop.addEventListener("dragleave", function () { drop.classList.remove("over"); });
      drop.addEventListener("drop", function (e) {
        e.preventDefault();
        drop.classList.remove("over");
        handleFiles(e.dataTransfer.files);
      });
      fi.addEventListener("change", function () { handleFiles(fi.files); fi.value = ""; });
    }

    /* ----- фото: очередь ассистента ----- */
    $("#upload-queue").addEventListener("click", function (e) {
      var b = e.target.closest("[data-qact]");
      if (!b) return;
      if (b.dataset.qact === "bind") queueBindOne(Number(b.dataset.qi));
    });
    $("#upload-queue").addEventListener("input", function (e) {
      var s = e.target.closest("[data-qsearch]");
      if (!s) return;
      var qi = Number(s.dataset.qsearch);
      var row = state.queue[qi];
      var sel = this.querySelector('[data-qsel="' + qi + '"]');
      if (row && sel) sel.innerHTML = queueSelectHTML(row, qi, s.value);
    });
    $("#q-upload-all").addEventListener("click", queueUploadAll);
    $("#q-clear").addEventListener("click", function () {
      state.queue.forEach(function (r) {
        try { URL.revokeObjectURL(r.thumb); } catch (e) {}
      });
      state.queue = [];
      renderQueue();
    });

    /* ----- фото: галерея и «нужны фото» ----- */
    $("#gallery").addEventListener("click", function (e) {
      var b = e.target.closest("[data-gact]");
      if (b) {
        var path = b.dataset.gi;
        if (b.dataset.gact === "del") {
          deletePhoto(path);
          return;
        }
        if (b.dataset.gact === "bind") {
          openBindModal("Привязать " + path.replace(/^assets\/img\//, "") + " к товару", function (itemId) {
            var f = itemById(itemId);
            if (!f) return;
            f.item.img = path;
            bump(1);
            renderItems(); renderNeed(); renderDash(); renderGallery();
            toast("Фото привязано к «" + f.item.name + "»", "ok");
          });
          return;
        }
      }
      // клик по самому фото — открыть в новой вкладке
      var img = e.target.closest("img");
      var item = img ? img.closest(".gal-item") : null;
      if (item && item.dataset.file) window.open(item.dataset.file, "_blank");
    });

    $("#photo-filter").addEventListener("input", function () {
      state.photoQuery = this.value;
      renderGallery();
    });

    $("#need-root").addEventListener("click", function (e) {
      var b = e.target.closest("[data-np]");
      if (b) needPhotoPick(b.dataset.np);
    });

    /* ----- промокоды ----- */
    $("#btn-promo-add").addEventListener("click", addPromo);
    $("#promos-list").addEventListener("input", function (e) {
      var t = e.target.closest("[data-pk]");
      if (!t) return;
      var rowEl = t.closest(".promo-row");
      var p = (state.data.shop.promos || [])[Number(rowEl.dataset.pi)];
      if (!p) return;
      var k = t.dataset.pk;
      if (k === "active") p.active = t.checked;
      else if (k === "value") p.value = fieldNumber(t);
      else if (k === "minSum") p.minSum = fieldNumber(t);
      else p[k] = t.value;
      markFieldDirty("promo:" + rowEl.dataset.pi + ":" + k);
    });
    $("#promos-list").addEventListener("change", function (e) {
      var t = e.target.closest("[data-pk]");
      if (!t) return;
      var rowEl = t.closest(".promo-row");
      var p = (state.data.shop.promos || [])[Number(rowEl.dataset.pi)];
      if (!p) return;
      var k = t.dataset.pk;
      if (k === "active") {
        p.active = t.checked;
        rowEl.classList.toggle("p-off", !t.checked);
        markFieldDirty("promo:" + rowEl.dataset.pi + ":active");
        renderDash();
      } else if (t.tagName === "SELECT") {
        p[k] = t.value;
        markFieldDirty("promo:" + rowEl.dataset.pi + ":" + k);
      }
    });
    $("#promos-list").addEventListener("click", function (e) {
      var del = e.target.closest("[data-pdel]");
      if (!del) return;
      var i = Number(del.dataset.pdel);
      var p = (state.data.shop.promos || [])[i];
      if (!p) return;
      if (!confirm("Удалить промокод «" + (p.code || i) + "»?")) return;
      state.data.shop.promos.splice(i, 1);
      bump(1); renderPromos(); renderDash();
      toast("Промокод удалён", "ok");
    });

    /* ----- резервные копии ----- */
    $("#btn-export").addEventListener("click", downloadBackup);
    $("#btn-csv").addEventListener("click", downloadCsvPrice);

    $("#import-file").addEventListener("change", function (e) {
      var f = e.target.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var d = JSON.parse(fr.result);
          if (!d.catalog) throw new Error("В файле нет каталога");
          state.data = d;
          normalize();
          fillShop(); renderCats(); renderItems(); renderPromos(); renderNeed(); renderDash();
          setDirty(true);
          updateDirtyUI();
          toast("Данные загружены. Нажмите «Сохранить на сайт».", "ok");
        } catch (err) {
          toast("Файл не подошёл: " + err.message, "err");
        }
      };
      fr.readAsText(f);
      e.target.value = "";
    });

    // закрытие модалок по фону и Esc
    $$(".modal-back").forEach(function (m) {
      m.addEventListener("click", function (e) {
        if (e.target === m) requestCloseModal(m);
      });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        // гасим только верхнюю модалку: галерея поверх формы товара не должна
        // одним Esc закрыть и выбор фото, и саму форму с введёнными полями
        var top = topOpenModal();
        if (top) requestCloseModal(top);
      }
      // e.code — работает и в русской раскладке (e.key там «ы») (R2v2-Н3)
      if ((e.ctrlKey || e.metaKey) && (e.code === "KeyS" || String(e.key).toLowerCase() === "s")) { e.preventDefault(); if (state.data) doSave(); }
    });

    // «форма менялась» — для защиты от закрытия без сохранения
    ["#modal-item", "#modal-cat"].forEach(function (sel) {
      var m = $(sel);
      if (!m) return;
      m.addEventListener("input", function () { state.formChanged = true; });
      m.addEventListener("change", function () { state.formChanged = true; });
    });

    // предупреждение при уходе
    window.addEventListener("beforeunload", function (e) {
      if (state.dirty) { e.preventDefault(); e.returnValue = ""; }
    });

    bindShopInputs();
    bindDrag();

    // при изменении размеров окна пересчитываем высоту мобильной панели вкладок
    window.addEventListener("resize", syncMobileBarH);
  }

  /* ---------------- старт ---------------- */
  function boot() {
    bindAll();

    var repo = localStorage.getItem(LS.repo);
    var token = localStorage.getItem(LS.token);
    var branch = localStorage.getItem(LS.branch);

    if (repo) $("#in-repo").value = repo;
    if (branch) $("#in-branch").value = branch;

    if (repo && token) {
      state.repo = repo;
      state.token = token;
      state.branch = branch || "main";
      updateStatus(null, "Подключаюсь…");
      loadFromRepo()
        .then(startApp)
        .catch(function (e) {
          localStorage.removeItem(LS.token);
          toast(e.message, "err");
          $("#login").style.display = "grid";
        });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
