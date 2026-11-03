# README — «Икра & Рыба»

## 1. Что это

Витрина интернет-магазина икры и копчёной рыбы, развёрнутая на GitHub Pages:

- **Сайт:** https://bladadd.github.io/ikra-shop/
- **Админка:** https://bladadd.github.io/ikra-shop/admin.html
- **Репозиторий:** https://github.com/BladAdd/ikra-shop (ветка `main`)

Технически это **чистые HTML/CSS/JS** (без фронтенд-фреймворков), сборка Vite.
Node-сервер (`server/`) **опционален**: витрина и оформление заказа работают и без него
(заказ уходит в WhatsApp; сервер нужен для SQLite-базы, сессий и онлайн-оплаты RollyPay).

## 2. Структура проекта

| Путь | Назначение |
|---|---|
| `index.html` | Витрина: шапка, каталог, корзина, оформление заказа |
| `product.html` | Карточка товара (cтраница товара) |
| `admin.html` | Админ-панель (работает через GitHub API) |
| `public/` | Статика, копируется в `dist/` при сборке: `404.html`, `privacy.html`, `offer.html`, `robots.txt`, `sitemap.xml`, `sw.js` (PWA), `manifest.webmanifest`, `icons/` |
| `assets/js/app.js` | Витрина: карточки, корзина, промокоды, лайтбокс, «выгоднее» |
| `assets/js/product.js` | Логика карточки товара |
| `assets/js/admin.js` | Логика админки (редактирование, фото, GitHub API) |
| `assets/js/api.js` | Обёртка над GitHub Contents API |
| `assets/js/auth-ui.js` | UI входа в админку по GitHub PAT |
| `assets/js/data.js` | **Сгенерированный** встроенный резерв каталога (fallback без сервера) |
| `assets/js/pwa.js` | Регистрация service worker |
| `data/catalog.json` | **Источник правды**: каталог, 147 товаров в 7 категориях + `shop`/контакты/промокоды |
| `server/` | Опциональный Node-сервер: Express + SQLite (better-sqlite3) + JWT + RollyPay |
| `tools/` | Инструменты: `build_catalog.py` (сборка каталога), `embed_catalog.cjs` (встраивание в data.js), `check_catalog.py` (линтер данных), `client_photos.py` (обработка фото заказчика), `_audit/` (аудиты) |

## 3. Команды

```bash
npm run dev         # локальный dev-сервер Vite на :3000
npm run dev:server  # dev-режим серверной части (tsx watch server/index.ts)
npm run build       # production-сборка: vite build + tsc сервера (tsconfig.server.json)
npm run build:pages # сборка для GitHub Pages: DEPLOY_TARGET=pages vite build
npm run lint        # проверка типов (tsc, клиент + сервер)
npm run start       # запуск собранного сервера (dist-server/index.js)
npm run preview     # предпросмотр собранного дистрибутива (vite preview)

# Регенерация каталога и резервной копии:
python tools/build_catalog.py    # собрать data/catalog.json из прайсов поставщика
node tools/embed_catalog.cjs     # встроить catalog.json в assets/js/data.js
python tools/check_catalog.py    # проверка/линт данных каталога
```

> `DEPLOY_TARGET=pages npx vite build` работает **только в Git Bash**. В PowerShell
> переменная окружения так не передаётся — используйте Git Bash или `npm run build:pages`.

## 4. Деплой

- Деплой автоматический: **push в `main` → GitHub Actions
  (`.github/workflows/deploy-pages.yml`) → GitHub Pages**. Публикуется содержимое `dist/`.
  Статус: `gh run list --limit 1` (≈40 сек).
- Сборку для Pages делает сам workflow (`npm ci && npm run build:pages`).

> ⚠️ **Правило при конфликте `data/catalog.json`:** файл генерируемый, его правит и админка
> (коммиты «Админка: …»). При merge-конфликте берём **нашу сборку**, а правки админки
> заново накатываем поверх, осмысленно (перенести изменённые поля вручную).

## 5. Данные

- **`data/catalog.json`** — единственный источник правды. Поля товара: `id`, `name`,
  `weight`, `price`, `oldPrice`, `unit` (`кг`/`шт`), `piece`, `img`, `badge`, `desc`, `tags`.
  `price` — цена за 1 кг у весовых и за упаковку у порционных (`piece: true`); `null` — «По запросу».
- **Промокоды** — массив `shop.promos` в каталоге: `{ code, type: "percent"|"fixed", value, minSum, active }`.
- **`packs`** — все фасовки из прайса, контракт:
  `[{ "weight": "1 кг", "price": 790, "total": 790 }, ...]` (вес, цена за фасовку, сумма партии).
  Фасовка, выбранная в корзине, записывается как `packWeight` и влияет на цену строки.
- **Ключи localStorage (браузер пользователя):**
  - `caviar_cart_v1` — корзина;
  - `caviar_fav_v1` — избранное;
  - `caviar_checkout_v1` — черновик формы оформления заказа;
  - `ikra_admin_visible` — показывать ссылку «Управление» (включается открытием сайта с `?admin=1`).

## 6. Админка

- **Вход:** аккаунт GitHub → GitHub **Personal Access Token (fine-grained)** с правами на репозиторий
  `BladAdd/ikra-shop`, ветка `main`. Токен хранится в `localStorage` браузера — только на клиенте,
  на сервер не передаётся. Подробнее — [АДМИНКА-ИНСТРУКЦИЯ.md](АДМИНКА-ИНСТРУКЦИЯ.md).
- **Что умеет (правки через GitHub API, коммиты в `main`):**
  - редактирование товаров и категорий: название, вес, цена, `oldPrice`, `unit`, `img`, `badge`, `desc`, `tags`;
  - порядок товаров drag&drop;
  - загрузка новых фото (сжатие до 1400px, файлы кладутся в `assets/img` через Contents API);
  - кнопка «Нужно фото» — ставит заглушку `__NEED_PHOTO__.jpg`;
  - метка «нет фото» в списке товаров;
  - при сохранении автоматически сохраняются поля `packs` и `packPrice` (в форме их нет — защита от потери).
- Сайт обновляется после push в `main` автоматически (см. раздел «Деплой»).
