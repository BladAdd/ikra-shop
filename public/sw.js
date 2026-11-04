/* ==========================================================================
   Икра & Рыба — сервис-воркер (PWA).
   Стратегии кэширования:
     - admin.html, api.github.com, любые /api/* — только сеть, без кэша;
     - навигации (request.mode === "navigate")  — сеть сначала, при ошибке
                                                  офлайн-фолбэк на index.html;
     - data/catalog.json                        — сеть сначала (свежий каталог
                                                  важнее закэшированного);
     - assets/img/*, *.css, *.js, шрифты        — stale-while-revalidate:
                                                  мгновенно из кэша + тихое
                                                  обновление через сеть.
   ========================================================================== */

const VERSION = "ikra-v10";

/* Минимальный офлайн-набор. Пути относительные: воркер лежит в корне сайта
   (/ikra-shop/), поэтому адреса считаются от его собственного расположения. */
var PRECACHE = [
  "./",
  "./index.html",
  "./assets/css/style.css",
  "./assets/js/app.js",
  "./assets/js/data.js",
  "./assets/js/api.js",
  "./assets/js/auth-ui.js",
  "./icons/icon.svg",
  "./manifest.webmanifest",
  /* Те же стили/скрипты под точными версионными ключами, как их реально
     запрашивают страницы (?v=8/v9 из HTML): cache.match() сверяет URL
     вместе с query, поэтому держим в кэше оба варианта ключа. */
  "./assets/css/style.css?v=10",
  "./assets/js/data.js?v=7",
  "./assets/js/app.js?v=9"
];

/* ---------- Установка: предзагрузка офлайн-набора ---------- */
self.addEventListener("install", function (event) {
  // Новый воркер сразу вступает в дело, чтобы обновления сайта доезжали быстрее.
  self.skipWaiting();
  event.waitUntil(
    caches.open(VERSION).then(function (cache) {
      return cache.addAll(PRECACHE);
    })
  );
});

/* ---------- Активация: удаляем кэши прошлых версий ---------- */
self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (key) {
          if (key !== VERSION) return caches.delete(key);
          return null;
        }));
      })
      .then(function () {
        // Берём управление всеми открытыми вкладками без перезагрузки.
        return self.clients.claim();
      })
  );
});

/* ---------- Сеть сначала (для навигаций и свежих данных) ---------- */
function networkFirst(request) {
  return fetch(request).then(function (response) {
    if (response && response.ok) {
      // Обновляем копию в кэше — она пригодится офлайн.
      var copy = response.clone();
      caches.open(VERSION).then(function (cache) {
        cache.put(request, copy);
      });
    }
    return response;
  }).catch(function () {
    // Сеть недоступна — отдаём последнюю сохранённую копию.
    // ignoreSearch: ключи в кэше могут отличаться лишь суффиксом ?v=...
    return caches.match(request, { ignoreSearch: true });
  });
}

/* ---------- Stale-while-revalidate (картинки, стили, скрипты, шрифты) ---------- */
function staleWhileRevalidate(request) {
  return caches.open(VERSION).then(function (cache) {
    var update = fetch(request).then(function (response) {
      if (response && response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    });
    // ignoreSearch: страницы просят ресурсы с ?v=..., а precache кладёт их
    // и без query — сравниваем только путь, чтобы совпадение гарантировалось.
    return cache.match(request, { ignoreSearch: true }).then(function (cached) {
      if (cached) {
        // Отдаём из кэша мгновенно; сеть в фоне освежает копию.
        update.catch(function () {});
        return cached;
      }
      // В кэше пусто — ждём сеть и кладём копию в кэш.
      return update;
    });
  });
}

/* Проверка ресурсного пути: картинки, стили, скрипты, шрифты (same-origin). */
function isAssetUrl(url) {
  if (url.origin !== self.location.origin) return false;
  var path = url.pathname;
  if (path.indexOf("/assets/img/") !== -1) return true;
  if (/\.(css|js)$/i.test(path)) return true;
  return /\.(woff2?|ttf|otf|eot)$/i.test(path);
}

/* ---------- Перехват запросов ---------- */
self.addEventListener("fetch", function (event) {
  var request = event.request;

  // Кэш обслуживаем только для GET; POST и прочее — мимо воркера.
  if (request.method !== "GET") return;

  var url = new URL(request.url);

  /* 1) Админка и API — только сеть, никакой кэш.
        При ошибке сети запрос просто «роняется» (respondWith отклонится). */
  if (
    url.pathname.indexOf("admin.html") !== -1 ||
    url.hostname === "api.github.com" ||
    url.pathname.indexOf("/api/") !== -1
  ) {
    event.respondWith(fetch(request));
    return;
  }

  /* 2) Навигации — сеть сначала; офлайн отдаём index.html из кэша.
        Успешный ответ для главной обновляет кэш, чтобы офлайн-фолбэк
        не устаревал навсегда при неизменном sw.js. Страницы товара
        (product.html?id=...) НЕ кэшируем — иначе в кэше накопится
        отдельный вариант на каждый товар. */
  if (request.mode === "navigate") {
    // Путь до главной = корень scope воркера ("/ikra-shop/").
    var homePath = new URL("./", self.registration.scope).pathname;
    event.respondWith(
      fetch(request).then(function (response) {
        var path = url.pathname;
        // Кэш обновляем только для "/" и "/index.html".
        if (
          response && response.ok &&
          (path === homePath || path === homePath + "index.html")
        ) {
          // Обновляем оба канонических ключа главной страницы
          // (те же, что лежат в precache).
          caches.open(VERSION).then(function (cache) {
            cache.put("./", response.clone());
            cache.put("./index.html", response.clone());
          });
        }
        return response;
      }).catch(function () {
        return caches.match("./index.html", { ignoreSearch: true });
      })
    );
    return;
  }

  /* 3) Каталог товаров — сеть сначала: свежие цены важнее. */
  if (url.pathname.indexOf("/data/catalog.json") !== -1) {
    event.respondWith(networkFirst(request));
    return;
  }

  /* 4) Ресурсы — stale-while-revalidate (только GET и same-origin,
        что уже проверено выше и внутри isAssetUrl). */
  if (isAssetUrl(url)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  /* Всё остальное — поведение браузера по умолчанию. */
});
