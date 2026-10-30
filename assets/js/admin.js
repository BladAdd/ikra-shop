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
    data: null,          // { version, shop, payments, orderEndpoint, catalog }
    sha: null,           // текущий blob sha файла в репозитории
    dirty: false,
    editingItem: null,   // { catId, itemId } или null для нового
    editingCat: null,
    imgTarget: null      // колбэк для выбора фото
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

  var toastEl = $("#toast");
  var toastT = null;
  function toast(msg, kind) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.className = "toast on" + (kind ? " " + kind : "");
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.className = "toast"; }, 3200);
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

  function setDirty(v) {
    state.dirty = v;
    var el = $("#dirty");
    if (el) el.classList.toggle("on", v);
  }

  /* ---------------- GitHub API ---------------- */
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
    }).then(function (r) {
      if (r.status === 401) throw new Error("Токен не подошёл. Проверьте, что он действует и с доступом Contents: Read and write.");
      if (r.status === 403) throw new Error("Нет прав. Нужно разрешение Contents: Read and write на этот репозиторий.");
      if (r.status === 404) throw new Error("Не найдено. Проверьте название репозитория и ветку.");
      if (!r.ok) {
        return r.text().then(function (t) {
          var m = t;
          try { m = JSON.parse(t).message || t; } catch (e) {}
          throw new Error("GitHub: " + m);
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
    return gh("/repos/" + state.repo + "/contents/" + DATA_PATH + "?ref=" + encodeURIComponent(state.branch))
      .then(function (file) {
        state.sha = file.sha;
        var text = b64decode(file.content);
        state.data = JSON.parse(text);
        normalize();
        return state.data;
      });
  }

  function saveToRepo(message) {
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
      return res;
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
  }

  /* ---------------- статус ---------------- */
  function updateStatus(ok, text) {
    var dot = $("#st-dot"), t = $("#st-text");
    if (dot) dot.className = "dot " + (ok === true ? "ok" : ok === false ? "err" : "warn");
    if (t) t.textContent = text;
    var d = state.data;
    if (d) {
      var n = d.catalog.reduce(function (a, c) { return a + c.items.length; }, 0);
      $("#st-items").textContent = n;
      $("#st-cats").textContent = d.catalog.length;
    }
  }

  /* ---------------- отрисовка товаров ---------------- */
  function renderItems() {
    var root = $("#items-root");
    if (!root || !state.data) return;
    var d = state.data;

    if (!d.catalog.length) {
      root.innerHTML = '<div class="empty">Категорий пока нет. Создайте первую во вкладке «Категории».</div>';
      return;
    }

    root.innerHTML = d.catalog.map(function (cat, ci) {
      var rows = cat.items.map(function (it, ii) {
        var p = it.price != null && it.price !== "" ? money(it.price) : "Цена не указана";
        var badges = "";
        if (it.badge) badges += '<span class="tag gold">' + esc(it.badge) + "</span>";
        if (it.oldPrice) badges += '<span class="tag hot">старая цена</span>';
        return '' +
          '<div class="item" draggable="true" data-ci="' + ci + '" data-ii="' + ii + '">' +
            '<span class="grip" title="Перетащите, чтобы изменить порядок">⠿</span>' +
            '<img src="' + esc(it.img || "") + '" alt="" onerror="this.style.opacity=.25">' +
            '<div class="info">' +
              "<b>" + esc(it.name) + badges + "</b>" +
              '<div class="meta">' + esc(it.weight || "—") + " · " + esc(it.unit === "кг" ? "за кг" : "за шт") + "</div>" +
              '<div class="price' + (it.price == null || it.price === "" ? " none" : "") + '">' + p + "</div>" +
            "</div>" +
            '<div class="acts">' +
              '<button class="btn btn-sm" data-act="edit" data-ci="' + ci + '" data-ii="' + ii + '">Изменить</button>' +
              '<button class="btn btn-sm" data-act="dup" data-ci="' + ci + '" data-ii="' + ii + '">Копия</button>' +
              '<button class="btn btn-sm btn-danger" data-act="del" data-ci="' + ci + '" data-ii="' + ii + '">Удалить</button>' +
            "</div>" +
          "</div>";
      }).join("");

      return '' +
        '<div class="cat-block">' +
          '<div class="cat-bar">' +
            '<span class="nm">' + esc(cat.title) + "</span>" +
            '<span class="cnt">' + cat.items.length + " поз.</span>" +
            '<div class="acts">' +
              '<button class="btn btn-sm" data-act="add-here" data-ci="' + ci + '">+ Товар</button>' +
            "</div>" +
          "</div>" +
          (rows || '<div class="empty" style="padding:16px">В этой категории пока нет товаров</div>') +
        "</div>";
    }).join("");
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
        '<div class="item" style="grid-template-columns:1fr auto">' +
          '<div class="info">' +
            "<b>" + esc(c.title) + "</b>" +
            '<div class="meta">' + esc(c.subtitle || "—") + " · код: " + esc(c.id) + " · " + c.items.length + " поз.</div>" +
          "</div>" +
          '<div class="acts">' +
            '<button class="btn btn-sm" data-cact="edit" data-ci="' + i + '">Изменить</button>' +
            '<button class="btn btn-sm btn-danger" data-cact="del" data-ci="' + i + '">Удалить</button>' +
          "</div>" +
        "</div>";
    }).join("");
  }

  /* ---------------- галерея фото ---------------- */
  var photoList = [];

  function loadPhotos() {
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

  function renderGallery() {
    var g = $("#gallery");
    if (!g) return;
    var cnt = $("#photo-count");
    if (cnt) cnt.textContent = photoList.length;

    if (!photoList.length) {
      g.innerHTML = '<div class="empty" style="grid-column:1/-1">Фото пока нет</div>';
      return;
    }
    g.innerHTML = photoList.map(function (f) {
      return '' +
        '<div class="gal-item" data-file="' + esc(f.path) + '" title="' + esc(f.name) + '">' +
          '<img src="' + esc(f.path) + '?v=' + Date.now() + '" alt="" loading="lazy">' +
          '<div class="nm">' + esc(f.name) + "</div>" +
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

  function uploadPhoto(file) {
    var name = slug(file.name.replace(/\.[^.]+$/, "")) || "photo";
    name = name + "-" + Date.now().toString(36) + ".jpg";
    var path = "assets/img/" + name;

    return compressImage(file, 1400, 0.86)
      .then(function (blob) {
        return blobToB64(blob).then(function (b64) {
          return gh("/repos/" + state.repo + "/contents/" + path, {
            method: "PUT",
            body: {
              message: "Админка: загрузка фото " + name,
              content: b64,
              branch: state.branch
            }
          });
        });
      })
      .then(function () {
        photoList.push({ name: name, path: path, size: 0 });
        renderGallery();
        return path;
      });
  }

  function handleFiles(files) {
    var arr = Array.prototype.slice.call(files || []);
    if (!arr.length) return;
    var i = 0, done = 0;
    toast("Загружаю фото: 0/" + arr.length);

    function next() {
      if (i >= arr.length) {
        toast("Загружено фото: " + done, "ok");
        return;
      }
      var f = arr[i++];
      uploadPhoto(f).then(function () {
        done++;
        toast("Загружаю фото: " + done + "/" + arr.length);
        next();
      }).catch(function (e) {
        toast("Ошибка загрузки: " + e.message, "err");
        next();
      });
    }
    next();
  }

  /* ---------------- модалка товара ---------------- */
  function openItemModal(catId, itemId) {
    var d = state.data;
    var cat = d.catalog.filter(function (c) { return c.id === catId; })[0];
    if (!cat) return;

    var it = itemId ? cat.items.filter(function (x) { return x.id === itemId; })[0] : null;

    state.editingItem = { catId: catId, itemId: itemId || null };

    $("#mi-title").textContent = it ? "Изменить товар" : "Новый товар";
    $("#mi-cat").innerHTML = d.catalog.map(function (c) {
      return '<option value="' + esc(c.id) + '"' + (c.id === catId ? " selected" : "") + ">" + esc(c.title) + "</option>";
    }).join("");

    $("#mi-name").value = it ? it.name || "" : "";
    $("#mi-price").value = it && it.price != null ? it.price : "";
    $("#mi-old").value = it && it.oldPrice != null ? it.oldPrice : "";
    $("#mi-weight").value = it ? it.weight || "" : "";
    $("#mi-unit").value = it ? it.unit || "шт" : "шт";
    $("#mi-badge").value = it ? it.badge || "" : "";
    $("#mi-desc").value = it ? it.desc || "" : "";
    $("#mi-tags").value = it ? it.tags || "" : "";
    $("#mi-img").value = it ? it.img || "" : "";
    updatePrev();

    $("#modal-item").classList.add("on");
    setTimeout(function () { $("#mi-name").focus(); }, 60);
  }

  function updatePrev() {
    var v = $("#mi-img").value.trim();
    var p = $("#mi-prev");
    if (v) { p.src = v; p.style.display = "block"; }
    else { p.removeAttribute("src"); p.style.display = "block"; p.style.opacity = 0.3; }
    p.style.opacity = 1;
  }

  function saveItem() {
    var name = $("#mi-name").value.trim();
    if (!name) { toast("Введите название товара", "err"); $("#mi-name").focus(); return; }

    var d = state.data;
    var catId = $("#mi-cat").value;
    var cat = d.catalog.filter(function (c) { return c.id === catId; })[0];
    if (!cat) { toast("Категория не найдена", "err"); return; }

    var priceRaw = $("#mi-price").value.trim();
    var oldRaw = $("#mi-old").value.trim();

    var payload = {
      id: "",
      name: name,
      weight: $("#mi-weight").value.trim() || "1 шт",
      price: priceRaw === "" ? null : Number(priceRaw),
      oldPrice: oldRaw === "" ? null : Number(oldRaw),
      unit: $("#mi-unit").value,
      img: $("#mi-img").value.trim() || "assets/img/hero-caviar.jpg",
      badge: $("#mi-badge").value || null,
      desc: $("#mi-desc").value.trim(),
      tags: $("#mi-tags").value.trim()
    };

    var ed = state.editingItem;

    if (ed && ed.itemId) {
      // правка существующего
      var srcCat = d.catalog.filter(function (c) { return c.id === ed.catId; })[0];
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

    setDirty(true);
    closeModal("#modal-item");
    renderItems();
    updateStatus(null, "Есть несохранённые изменения");
    toast("Товар сохранён. Нажмите «Сохранить на сайт».", "ok");
  }

  /* ---------------- модалка категории ---------------- */
  function openCatModal(idx) {
    var d = state.data;
    var c = idx != null ? d.catalog[idx] : null;
    state.editingCat = idx != null ? idx : null;

    $("#mc-title").textContent = c ? "Изменить категорию" : "Новая категория";
    $("#mc-title-in").value = c ? c.title || "" : "";
    $("#mc-sub").value = c ? c.subtitle || "" : "";
    $("#mc-id").value = c ? c.id || "" : "";

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
      c.id = id;
    } else {
      d.catalog.push({
        id: id,
        title: title,
        subtitle: $("#mc-sub").value.trim(),
        items: []
      });
    }

    setDirty(true);
    closeModal("#modal-cat");
    renderItems();
    renderCats();
    updateStatus(null, "Есть несохранённые изменения");
    toast("Категория сохранена", "ok");
  }

  /* ---------------- настройки ---------------- */
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

  function bindShop() {
    $$("[data-shop]").forEach(function (el) {
      el.addEventListener("input", function () {
        var k = el.dataset.shop;
        state.data.shop[k] = el.type === "checkbox" ? el.checked : el.value;
        setDirty(true);
      });
    });
    $$("[data-pay]").forEach(function (el) {
      el.addEventListener("input", function () {
        var k = el.dataset.pay;
        if (k === "orderEndpoint") state.data.orderEndpoint = el.value;
        else state.data.payments[k] = el.value;
        setDirty(true);
      });
    });
  }

  /* ---------------- модалки ---------------- */
  function closeModal(sel) {
    var m = $(sel);
    if (m) m.classList.remove("on");
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
        btn.textContent = "Войти";
      });
  }

  function startApp() {
    $("#login").style.display = "none";
    $("#shell").classList.add("on");

    fillShop();
    bindShop();
    renderItems();
    renderCats();
    updateStatus(true, "Подключено: " + state.repo);
    setDirty(false);

    var hist = $("#btn-history");
    if (hist) hist.href = "https://github.com/" + state.repo + "/commits/" + state.branch + "/" + DATA_PATH;

    loadPhotos().then(renderGallery);
  }

  /* ---------------- сохранение ---------------- */
  function doSave() {
    var btn = $("#btn-save");
    btn.disabled = true;
    btn.textContent = "Сохраняю…";

    var d = state.data;
    var n = d.catalog.reduce(function (a, c) { return a + c.items.length; }, 0);
    var msg = "Админка: обновление каталога (" + n + " товаров, " + d.catalog.length + " категорий)";

    saveToRepo(msg)
      .then(function () {
        setDirty(false);
        updateStatus(true, "Сохранено. Сайт обновится через 1-2 минуты");
        toast("Сохранено. GitHub Pages обновится в течение 1-2 минут.", "ok");
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

  /* ---------------- перетаскивание ---------------- */
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
      if (it.dataset.ci !== dragSrc.dataset.ci) return;   // только внутри категории
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
      if (it.dataset.ci !== dragSrc.dataset.ci) return;
      e.preventDefault();

      var ci = Number(it.dataset.ci);
      var from = Number(dragSrc.dataset.ii);
      var to = Number(it.dataset.ii);
      var items = state.data.catalog[ci].items;
      var moved = items.splice(from, 1)[0];
      items.splice(to, 0, moved);

      setDirty(true);
      renderItems();
      toast("Порядок изменён", "ok");
    });
  }

  /* ---------------- обработчики ---------------- */
  function bindAll() {
    $("#btn-login").addEventListener("click", doLogin);
    $("#in-token").addEventListener("keydown", function (e) {
      if (e.key === "Enter") doLogin();
    });

    $("#btn-logout").addEventListener("click", function () {
      if (state.dirty && !confirm("Есть несохранённые изменения. Выйти без сохранения?")) return;
      localStorage.removeItem(LS.token);
      location.reload();
    });

    // вкладки
    $$(".tab-btn[data-tab]").forEach(function (b) {
      b.addEventListener("click", function () {
        $$(".tab-btn[data-tab]").forEach(function (x) { x.classList.remove("active"); });
        b.classList.add("active");
        $$(".panel").forEach(function (p) { p.classList.remove("on"); });
        var p = $("#panel-" + b.dataset.tab);
        if (p) p.classList.add("on");
      });
    });

    $("#btn-save").addEventListener("click", doSave);

    $("#btn-reload").addEventListener("click", function () {
      if (state.dirty && !confirm("Несохранённые изменения будут потеряны. Продолжить?")) return;
      loadFromRepo().then(function () {
        fillShop(); renderItems(); renderCats();
        setDirty(false);
        updateStatus(true, "Обновлено из репозитория");
        toast("Данные обновлены", "ok");
      }).catch(function (e) { toast(e.message, "err"); });
    });

    // товары
    $("#btn-add-item").addEventListener("click", function () {
      if (!state.data.catalog.length) { toast("Сначала создайте категорию", "err"); return; }
      openItemModal(state.data.catalog[0].id, null);
    });

    $("#items-root").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-act]");
      if (!b) return;
      var act = b.dataset.act;
      var ci = Number(b.dataset.ci);
      var ii = b.dataset.ii != null ? Number(b.dataset.ii) : null;
      var cat = state.data.catalog[ci];

      if (act === "add-here") { openItemModal(cat.id, null); return; }

      if (act === "edit") {
        openItemModal(cat.id, cat.items[ii].id);
      } else if (act === "dup") {
        var copy = JSON.parse(JSON.stringify(cat.items[ii]));
        copy.id = slug(copy.name) + "-" + Date.now().toString(36).slice(-4);
        copy.name = copy.name + " (копия)";
        cat.items.splice(ii + 1, 0, copy);
        setDirty(true); renderItems();
        toast("Создана копия товара", "ok");
      } else if (act === "del") {
        if (!confirm("Удалить «" + cat.items[ii].name + "»?")) return;
        cat.items.splice(ii, 1);
        setDirty(true); renderItems();
        toast("Товар удалён", "ok");
      }
    });

    // категории
    $("#btn-add-cat").addEventListener("click", function () { openCatModal(null); });

    $("#cats-root").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-cact]");
      if (!b) return;
      var ci = Number(b.dataset.ci);
      if (b.dataset.cact === "edit") {
        openCatModal(ci);
      } else {
        var c = state.data.catalog[ci];
        var msg = c.items.length
          ? "В категории «" + c.title + "» " + c.items.length + " товаров. Удалить вместе с ними?"
          : "Удалить категорию «" + c.title + "»?";
        if (!confirm(msg)) return;
        state.data.catalog.splice(ci, 1);
        setDirty(true); renderItems(); renderCats();
        toast("Категория удалена", "ok");
      }
    });

    // модалка товара
    $("#mi-save").addEventListener("click", saveItem);
    $("#mi-cancel").addEventListener("click", function () { closeModal("#modal-item"); });
    $("#mi-img").addEventListener("input", updatePrev);

    $("#mi-pick").addEventListener("click", function () {
      state.imgTarget = function (path) {
        $("#mi-img").value = path;
        updatePrev();
      };
      $("#gal-pick").innerHTML = photoList.map(function (f) {
        return '<div class="gal-item" data-file="' + esc(f.path) + '">' +
          '<img src="' + esc(f.path) + '?v=' + Date.now() + '" alt="">' +
          '<div class="nm">' + esc(f.name) + "</div></div>";
      }).join("") || '<div class="empty" style="grid-column:1/-1">Фото нет</div>';
      $("#modal-gallery").classList.add("on");
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

    // модалка категории
    $("#mc-save").addEventListener("click", saveCat);
    $("#mc-cancel").addEventListener("click", function () { closeModal("#modal-cat"); });

    // фото
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

    // резервные копии
    $("#btn-export").addEventListener("click", function () {
      var blob = new Blob([JSON.stringify(state.data, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "ikra-backup-" + new Date().toISOString().slice(0, 10) + ".json";
      a.click();
      URL.revokeObjectURL(a.href);
      toast("Копия скачана", "ok");
    });

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
          fillShop(); renderItems(); renderCats();
          setDirty(true);
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
        if (e.target === m) m.classList.remove("on");
      });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") $$(".modal-back.on").forEach(function (m) { m.classList.remove("on"); });
      if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); if (state.data) doSave(); }
    });

    // предупреждение при уходе
    window.addEventListener("beforeunload", function (e) {
      if (state.dirty) { e.preventDefault(); e.returnValue = ""; }
    });

    bindDrag();
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
