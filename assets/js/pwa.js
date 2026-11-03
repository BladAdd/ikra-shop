/* ==========================================================================
   Икра & Рыба — регистрация сервис-воркера (PWA).
   Подключается в index.html. Никаких баннеров установки не показываем.
   ========================================================================== */

(function () {
  "use strict";

  // Страницу могут открыть напрямую с диска (file://) — там воркер недоступен.
  var protocol = window.location.protocol;
  if (protocol !== "http:" && protocol !== "https:") return;

  window.addEventListener("load", function () {
    // Старые браузеры без Service Worker просто ничего не делают.
    if (!("serviceWorker" in navigator)) return;

    // Относительный путь обязателен: сайт живёт в подкаталоге (/ikra-shop/).
    navigator.serviceWorker
      .register("sw.js")
      .catch(function (err) {
        console.warn("[PWA] Сервис-воркер не зарегистрирован:", err);
      });
  });
})();
