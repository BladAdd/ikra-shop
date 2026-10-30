/* ==========================================================================
   Аккаунт покупателя: вход через Google, регистрация и вход по e-mail.
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

  function renderAccount() {
    if (!els.wrap) return;
    if (currentUser) {
      var initials = (currentUser.name || currentUser.email || "?").trim().charAt(0).toUpperCase();
      els.wrap.innerHTML =
        '<button type="button" class="account-btn logged" id="account-btn" aria-haspopup="true">' +
          (currentUser.avatar
            ? '<img class="account-avatar" src="' + escapeHtml(currentUser.avatar) + '" alt="" referrerpolicy="no-referrer">'
            : '<span class="account-avatar initial">' + escapeHtml(initials) + "</span>") +
          '<span class="account-name">' + escapeHtml((currentUser.name || currentUser.email).split(" ")[0]) + "</span>" +
        "</button>" +
        '<div class="account-menu" id="account-menu">' +
          '<div class="account-menu-head">' +
            "<b>" + escapeHtml(currentUser.name || "Покупатель") + "</b>" +
            "<span>" + escapeHtml(currentUser.email) + "</span>" +
          "</div>" +
          '<a href="#" class="account-menu-item" data-account-action="orders">Мои заказы</a>' +
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
    if (window.IkraToast) window.IkraToast("Вы вошли как " + (user.name || user.email));
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
        if (action.dataset.accountAction === "logout") {
          API.logout().then(function () {
            currentUser = null;
            renderAccount();
            notify();
            window.IkraToast && window.IkraToast("Вы вышли из аккаунта");
          });
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

    // Google
    document.querySelectorAll("[data-google-login]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        window.location.href = API.googleLoginUrl();
      });
    });

    // Результат OAuth после редиректа
    var params = new URLSearchParams(location.search);
    if (params.get("auth_error")) {
      var map = {
        state_mismatch: "Ссылка входа устарела, попробуйте снова",
        google_failed: "Google не подтвердил вход. Попробуйте ещё раз",
        google_disabled: "Вход через Google пока не настроен",
        not_admin: "У этой почты нет доступа к админ-панели",
      };
      var msg = map[params.get("auth_error")] || "Не удалось войти";
      window.IkraToast && window.IkraToast(msg);
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