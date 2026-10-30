/* ==========================================================================
   Встраивает data/catalog.json в assets/js/data.js как резервную копию.
   Запускать после каждой правки каталога (вручную или из админки):
       node tools/embed_catalog.cjs
   ========================================================================== */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const catalogPath = path.join(root, "data", "catalog.json");
const dataJsPath = path.join(root, "assets", "js", "data.js");

const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf-8"));

// Компактная сериализация: файл остаётся читаемым, но не раздувается отступами
const serialized = JSON.stringify(catalog);

// Заменяем объявление целиком, чтобы не оставалось хвостов от прошлой версии
const LINE_RE = /^var FALLBACK_DATA = .*;$/m;

let src = fs.readFileSync(dataJsPath, "utf-8");
if (!LINE_RE.test(src)) {
  console.error("Не найдена строка `var FALLBACK_DATA = ...;` в data.js.");
  process.exit(1);
}

src = src.replace(LINE_RE, "var FALLBACK_DATA = " + serialized + ";");
fs.writeFileSync(dataJsPath, src, "utf-8");

const items = catalog.catalog.reduce((n, c) => n + c.items.length, 0);
const kb = Math.round(Buffer.byteLength(serialized) / 1024);
console.log(`data.js: встроено ${catalog.catalog.length} категорий, ${items} товаров (${kb} КБ)`);