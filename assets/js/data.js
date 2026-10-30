/* ==========================================================================
   Загрузка данных магазина.
   Источник правды — data/catalog.json. Его правит админка (admin.html).
   Если JSON не загрузился, сайт берёт встроенный резервный набор,
   чтобы страница никогда не оставалась пустой.
   ========================================================================== */

var CATALOG = [];
var SHOP = {};
var PAYMENTS = { provider: "link", currency: "RUB" };
var ORDER_ENDPOINT = "";

var DATA_URL = "data/catalog.json?v=" + Date.now();

function loadShopData() {
  return fetch(DATA_URL, { cache: "no-store" })
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function (d) {
      CATALOG = Array.isArray(d.catalog) ? d.catalog : [];
      SHOP = d.shop || {};
      PAYMENTS = d.payments || PAYMENTS;
      ORDER_ENDPOINT = d.orderEndpoint || "";
      return d;
    })
    .catch(function (err) {
      console.warn("Не удалось загрузить data/catalog.json:", err.message);
      // резервные значения, чтобы страница не сломалась
      SHOP = SHOP || {};
      if (!SHOP.whatsapp) SHOP.whatsapp = "79619200292";
      if (!SHOP.name) SHOP.name = "Икра";
      return null;
    });
}
