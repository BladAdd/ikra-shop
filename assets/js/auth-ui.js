/* ==========================================================================
   Аккаунт покупателя: вход через Яндекс/VK/MAX, регистрация и вход по e-mail.
   ========================================================================== */

(function () {
  "use strict";

  var els = {};
  var currentUser = null;
  var listeners = [];

  function $(id) { return document.getElementById(id); }

  function notify() {
    listeners.forEach(function (fn) {
      try { fn(currentUser); } catch (e) { console.warn(e); }
    });
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Сервер считается доступным, только если база API реально задана:
  // в проде без IKRA_API_URL база пустая — серверные фичи мягко отключаем
  function apiOnline() {
    return typeof API !== "undefined" && API.base !== "";
  }

  // Локальный тост: window.IkraToast нигде не определён, поэтому авторизационные
  // сообщения пропадали. Если глобальный тост однажды появится — используем его,
  // иначе показываем элемент #toast со страницы
  var toastTimer = null;

  function toast(msg, kind) {
    if (typeof window.IkraToast === "function") {
      window.IkraToast(msg, kind);
      return;
    }
    var el = $("toast");
    if (!el) return;
    el.textContent = msg;
    el.className = "toast on" + (kind ? " " + kind : "");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.className = "toast";
      toastTimer = null;
    }, 3200);
  }

  function renderAccount() {
    if (!els.wrap) return;
    if (currentUser) {
      var initials = (currentUser.name || currentUser.email || "?").trim().charAt(0).toUpperCase();
      // Защита от пустых name и email — иначе .split упа́ет (fallback «Гость»)
      var shownName = (currentUser.name || currentUser.email || "").trim().split(" ")[0] || "Гость";
      els.wrap.innerHTML =
        '<button type="button" class="account-btn logged" id="account-btn" aria-haspopup="true">' +
          (currentUser.avatar
            ? '<img class="account-avatar" src="' + escapeHtml(currentUser.avatar) + '" alt="" referrerpolicy="no-referrer">'
            : '<span class="account-avatar initial">' + escapeHtml(initials) + "</span>") +
          '<span class="account-name">' + escapeHtml(shownName) + "</span>" +
        "</button>" +
        '<div class="account-menu" id="account-menu">' +
          '<div class="account-menu-head">' +
            "<b>" + escapeHtml(currentUser.name || "Покупатель") + "</b>" +
            "<span>" + escapeHtml(currentUser.email || "") + "</span>" +
          "</div>" +
          // «Мои заказы» показываем только при живом API: без сервера ссылка мёртвая
          (apiOnline()
            ? '<a href="#" class="account-menu-item" data-account-action="orders">Мои заказы</a>'
            : "") +
          (currentUser.isAdmin ? '<a href="admin.html" class="account-menu-item">Админ-панель</a>' : "") +
          '<button type="button" class="account-menu-item danger" data-account-action="logout">Выйти</button>' +
        "</div>";
    } else {
      els.wrap.innerHTML =
        '<button type="button" class="account-btn" id="account-btn">' +
          '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">' +
            '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>' +
          "</svg>" +
          '<span class="account-name">Войти</span>' +
        "</button>";
    }
  }

  function openModal(mode) {
    if (!els.modal) return;
    els.modal.classList.add("on");
    document.body.style.overflow = "hidden";
    switchTab(mode || "login");
    setTimeout(function () {
      var el = mode === "register" ? els.regName : els.loginEmail;
      if (el) el.focus();
    }, 80);
  }

  function closeModal() {
    if (!els.modal) return;
    els.modal.classList.remove("on");
    document.body.style.overflow = "";
    clearErrors();
  }

  function switchTab(mode) {
    els.modal.dataset.mode = mode;
    var title = els.modal.querySelector("#auth-title");
    if (title) title.textContent = mode === "register" ? "Регистрация" : mode === "orders" ? "Мои заказы" : "Вход в аккаунт";
    document.querySelectorAll(".auth-tab").forEach(function (t) {
      t.classList.toggle("active", t.dataset.authTab === mode);
    });
    document.querySelectorAll(".auth-pane").forEach(function (p) {
      p.classList.toggle("on", p.dataset.authPane === mode);
    });
    clearErrors();
  }

  function clearErrors() {
    document.querySelectorAll(".auth-error").forEach(function (e) {
      e.textContent = "";
      e.classList.remove("on");
    });
  }

  /* ---------- Мои заказы (панель внутри auth-модалки; R7v2) ---------- */
  function ensureOrdersPane() {
    var card = els.modal ? els.modal.querySelector(".auth-card") : null;
    if (!card || card.querySelector('[data-auth-pane="orders"]')) return;
    var pane = document.createElement("div");
    pane.className = "auth-pane";
    pane.setAttribute("data-auth-pane", "orders");
    pane.innerHTML = '<div class="auth-orders" id="auth-orders-list">Загружаю заказы…</div>';
    card.appendChild(pane);
  }

  function openOrders() {
    if (!els.modal) return;
    if (!apiOnline()) {
      toast("История заказов заработает после подключения сервера. Статус заказа уточняйте в WhatsApp", "err");
      return;
    }
    ensureOrdersPane();
    els.modal.classList.add("on");
    document.body.style.overflow = "hidden";
    switchTab("orders");
    var title = els.modal.querySelector("#auth-title");
    if (title) title.textContent = "Мои заказы";
    var box = document.getElementById("auth-orders-list");
    if (box) box.textContent = "Загружаю заказы…";
    API.myOrders()
      .then(function (list) {
        var rows = Array.isArray(list) ? list : (list && list.orders) || [];
        if (!rows.length) {
          box.innerHTML = '<div class="auth-orders-empty">Заказов пока нет. Оформите первый — он появится здесь.</div>';
          return;
        }
        box.innerHTML = rows.map(function (o) {
          var st = String(o.status || "—");
          return '<div class="auth-orders-row"><b>Заказ #' + escapeHtml(String(o.id || "")) + "</b>" +
            "<span>" + escapeHtml(String(o.created_at || o.date || "")) + " · " + escapeHtml(String(o.total || "")) + "</span>" +
            '<span class="auth-orders-status">' + escapeHtml(st) + "</span></div>";
        }).join("");
      })
      .catch(function () {
        box.innerHTML = '<div class="auth-orders-empty">Не удалось загрузить заказы. Попробуйте позже или напишите в WhatsApp.</div>';
      });
  }

  function showError(scope, msg) {
    var el = document.querySelector('.auth-error[data-scope="' + scope + '"]');
    if (!el) return;
    el.textContent = msg;
    el.classList.add("on");
  }

  function setBusy(form, busy) {
    form.querySelectorAll("button, input").forEach(function (el) { el.disabled = busy; });
  }

  function handleAuthResult(user) {
    currentUser = user;
    renderAccount();
    notify();
    closeModal();
    toast("Вы вошли как " + (user.name || user.email || "Гость"), "ok");
  }

  function init() {
    els.wrap = $("account-slot");
    els.modal = $("auth-modal");
    els.loginEmail = $("auth-login-email");
    els.regName = $("auth-reg-name");

    renderAccount();

    // Делегирование кликов: кнопка входа, меню, вкладки, закрытие
    document.addEventListener("click", function (e) {
      var t = e.target;

      var accBtn = t.closest("#account-btn");
      if (accBtn) {
        if (currentUser) {
          e.preventDefault();
          var menu = $("account-menu");
          if (menu) menu.classList.toggle("open");
        } else {
          e.preventDefault();
          openModal("login");
        }
        return;
      }

      var action = t.closest("[data-account-action]");
      if (action) {
        e.preventDefault();
        if (action.dataset.accountAction === "orders") {
          var menuO = $("account-menu");
          if (menuO) menuO.classList.remove("open");
          openOrders();
          return;
        }
        if (action.dataset.accountAction === "logout") {
          // Выход должен работать даже без сервера: сначала чистим локальное
          // состояние UI, затем уведомляем сервер (ошибку сети молча игнорируем)
          currentUser = null;
          var openMenu = $("account-menu");
          if (openMenu) openMenu.classList.remove("open");
          renderAccount();
          notify();
          toast("Вы вышли из аккаунта", "ok");
          API.logout().catch(function () { /* сервер недоступен — сессия уже очищена локально */ });
        }
        return;
      }

      // закрытие меню по клику вне
      var menuEl = $("account-menu");
      if (menuEl && !t.closest("#account-slot")) menuEl.classList.remove("open");

      var tab = t.closest("[data-auth-tab]");
      if (tab) { e.preventDefault(); switchTab(tab.dataset.authTab); return; }

      if (t.closest("[data-auth-close]") || t === els.modal) { closeModal(); return; }

      var switchLink = t.closest("[data-auth-switch]");
      if (switchLink) { e.preventDefault(); switchTab(switchLink.dataset.authSwitch); }
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && els.modal && els.modal.classList.contains("on")) closeModal();
    });

    // Вход по e-mail
    var loginForm = $("auth-login-form");
    if (loginForm) {
      loginForm.addEventListener("submit", function (e) {
        e.preventDefault();
        clearErrors();
        // Без сервера POST уйдёт в 404 Pages — честно предупреждаем (R7v2)
        if (!apiOnline()) {
          showError("login", "Личный кабинет заработает после запуска сервера магазина. Пока оформляйте заказ формой на сайте — менеджер свяжется с вами");
          return;
        }
        var email = $("auth-login-email").value.trim();
        var password = $("auth-login-password").value;
        if (!email || !password) { showError("login", "Заполните почту и пароль"); return; }
        setBusy(loginForm, true);
        API.login(email, password)
          .then(function (d) { handleAuthResult(d.user); })
          .catch(function (err) { showError("login", err.message); })
          .then(function () { setBusy(loginForm, false); });
      });
    }

    // Регистрация
    var regForm = $("auth-register-form");
    if (regForm) {
      regForm.addEventListener("submit", function (e) {
        e.preventDefault();
        clearErrors();
        if (!apiOnline()) {
          showError("register", "Личный кабинет заработает после запуска сервера магазина. Пока оформляйте заказ формой на сайте — менеджер свяжется с вами");
          return;
        }
        var name = $("auth-reg-name").value.trim();
        var email = $("auth-reg-email").value.trim();
        var password = $("auth-reg-password").value;
        if (!name) { showError("register", "Укажите имя"); return; }
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { showError("register", "Проверьте адрес почты"); return; }
        if (password.length < 8) { showError("register", "Пароль не короче 8 символов"); return; }
        setBusy(regForm, true);
        API.register(email, password, name)
          .then(function (d) { handleAuthResult(d.user); })
          .catch(function (err) { showError("register", err.message); })
          .then(function () { setBusy(regForm, false); });
      });
    }

    // Вход через Яндекс / VK / MAX
    document.querySelectorAll("[data-oauth]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var provider = btn.getAttribute("data-oauth");
        // Без задеплоенного сервера редирект уводил бы на 404 — не навигируем
        if (!apiOnline()) {
          toast("Личный кабинет заработает после запуска сервера магазина. Пока оформляйте заказ формой на сайте — менеджер свяжется с вами");
          return;
        }
        if (provider === "max") { openMaxPanel(); return; }
        window.location.href = API.oauthStartUrl(provider);
      });
    });

    // MAX: у мессенджера нет OAuth для сайтов — показываем панель кода.
    // Ссылка на мини-приложение берётся из /api/health (maxBotLink, не секрет).
    function openMaxPanel() {
      var panel = $("max-panel");
      if (!panel) return;
      panel.hidden = false;
      var errEl = $("max-panel-err");
      if (errEl) errEl.hidden = true;
      API.health()
        .then(function (h) {
          var link = $("max-bot-link");
          var url = h && h.maxBotLink;
          if (link && url) {
            link.href = url;
          } else if (link) {
            // Бот ещё не настроен владельцем — подсказываем поддержку
            link.removeAttribute("href");
            link.textContent = "ссылку пришлёт поддержка (см. ниже)";
          }
        })
        .catch(function () {});
      var input = $("max-code-input");
      if (input) input.focus();
    }

    var claimBtn = $("max-claim-btn");
    if (claimBtn) {
      claimBtn.addEventListener("click", function () {
        var input = $("max-code-input");
        var errEl = $("max-panel-err");
        var code = input ? input.value.trim() : "";
        if (errEl) errEl.hidden = true;
        if (!/^\d{6}$/.test(code)) {
          if (errEl) { errEl.textContent = "Введите 6 цифр кода из MAX"; errEl.hidden = false; }
          return;
        }
        claimBtn.disabled = true;
        API.maxClaim(code)
          .then(function (d) { handleAuthResult(d.user); })
          .catch(function (err) {
            if (errEl) { errEl.textContent = err.message || "Код неверный или устарел"; errEl.hidden = false; }
          })
          .then(function () { claimBtn.disabled = false; });
      });
      // Enter в поле кода — как клик «Войти»
      var codeInput = $("max-code-input");
      if (codeInput) {
        codeInput.addEventListener("keydown", function (e) {
          if (e.key === "Enter") { e.preventDefault(); claimBtn.click(); }
        });
      }
    }

    // Результат OAuth после редиректа
    var params = new URLSearchParams(location.search);
    if (params.get("auth_error")) {
      var map = {
        state_mismatch: "Ссылка входа устарела, попробуйте снова",
        yandex_failed: "Яндекс не подтвердил вход. Попробуйте ещё раз",
        yandex_disabled: "Вход через Яндекс пока не настроен",
        vk_failed: "VK не подтвердил вход. Попробуйте ещё раз",
        vk_disabled: "Вход через VK пока не настроен",
        max_failed: "MAX не подтвердил вход. Попробуйте ещё раз",
        max_disabled: "Вход через MAX пока не настроен",
        not_admin: "У этой почты нет доступа к админ-панели",
      };
      var msg = map[params.get("auth_error")] || "Не удалось войти";
      toast(msg, "err");
      params.delete("auth_error");
      history.replaceState(null, "", location.pathname + (params.toString() ? "?" + params : "") + location.hash);
    }

    // Текущий пользователь
    API.me()
      .then(function (u) {
        currentUser = u;
        renderAccount();
        notify();
        if (params.get("auth") === "ok") {
          params.delete("auth");
          history.replaceState(null, "", location.pathname + (params.toString() ? "?" + params : "") + location.hash);
        }
      })
      .catch(function () { currentUser = null; renderAccount(); });
  }

  window.IkraAuth = {
    init: init,
    user: function () { return currentUser; },
    onChange: function (fn) { listeners.push(fn); },
    open: openModal,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();