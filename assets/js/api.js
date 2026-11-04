/* ==========================================================================
   API-клиент магазина.
   Серверная часть (Railway/Render) обслуживает заказы, вход и платежи.
   Адрес API задаётся на странице: window.IKRA_API_URL, иначе — автоопределение.
   ========================================================================== */

var API_BASE = (function () {
  if (typeof window !== "undefined" && window.IKRA_API_URL) return String(window.IKRA_API_URL).replace(/\/$/, "");
  // Локальная разработка: фронт на 3000/8799, API на 8080
  if (typeof location !== "undefined" && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    return location.port === "8080" ? "" : "http://localhost:8080";
  }
  return "";
})();

var API = {
  base: API_BASE,

  request: function (path, opts) {
    opts = opts || {};
    var url = API_BASE + path;
    var cfg = {
      method: opts.method || "GET",
      credentials: "include",
      headers: Object.assign({ Accept: "application/json" }, opts.headers || {}),
    };
    if (opts.body !== undefined) {
      cfg.headers["Content-Type"] = "application/json";
      cfg.body = JSON.stringify(opts.body);
    }
    return fetch(url, cfg).then(function (r) {
      return r
        .json()
        .catch(function () {
          return {};
        })
        .then(function (data) {
          if (!r.ok) {
            var err = new Error(data.error || "Ошибка сервера (" + r.status + ")");
            err.status = r.status;
            err.data = data;
            throw err;
          }
          return data;
        });
    });
  },

  health: function () {
    return API.request("/api/health");
  },

  me: function () {
    return API.request("/api/auth/me").then(function (d) {
      return d.user;
    });
  },

  login: function (email, password) {
    return API.request("/api/auth/login", { method: "POST", body: { email: email, password: password } });
  },

  register: function (email, password, name) {
    return API.request("/api/auth/register", { method: "POST", body: { email: email, password: password, name: name } });
  },

  logout: function () {
    return API.request("/api/auth/logout", { method: "POST" });
  },

  oauthStartUrl: function (provider, intent) {
    return API_BASE + "/api/auth/" + provider + "/start" + (intent ? "?redirect=" + encodeURIComponent(intent) : "");
  },

  // Вход через MAX: мини-приложение подтверждает пользователя, сервер
  // выдаёт одноразовый код; на сайте код обменивается на сессию
  maxWebAppLogin: function (initData) {
    return API.request("/api/auth/max/webapp", { method: "POST", body: { initData: initData } });
  },

  maxClaim: function (code) {
    return API.request("/api/auth/max/claim", { method: "POST", body: { code: code } });
  },

  createOrder: function (payload) {
    return API.request("/api/orders", { method: "POST", body: payload });
  },

  myOrders: function () {
    return API.request("/api/orders/my");
  },

  createPayment: function (orderId, method) {
    return API.request("/api/payments/create", { method: "POST", body: { orderId: orderId, method: method } });
  },

  paymentStatus: function (orderId) {
    return API.request("/api/payments/" + encodeURIComponent(orderId) + "/status");
  },
};