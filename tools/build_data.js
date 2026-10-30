/* Собирает data/catalog.json из текущего products.js — разовый перенос. */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "assets", "js", "products.js"), "utf8");

// вытаскиваем объявления из products.js, выполняя его в песочнице
const sandbox = {};
const fn = new Function(
  src + "\nreturn { CATALOG, SHOP, PAYMENTS, ORDER_ENDPOINT };"
);
const { CATALOG, SHOP, PAYMENTS, ORDER_ENDPOINT } = fn();

const data = {
  version: 1,
  updatedAt: new Date().toISOString(),
  shop: SHOP,
  payments: PAYMENTS,
  orderEndpoint: ORDER_ENDPOINT || "",
  catalog: CATALOG
};

const outDir = path.join(root, "data");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, "catalog.json"),
  JSON.stringify(data, null, 2),
  "utf8"
);

const items = CATALOG.reduce((n, c) => n + c.items.length, 0);
console.log(`data/catalog.json: ${CATALOG.length} категорий, ${items} товаров`);
