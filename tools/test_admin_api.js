/* Проверка механизма админки: чтение и запись data/catalog.json через GitHub API.
   Токен берётся из gh CLI, в файлы не пишется. */
const { execSync } = require("child_process");

const REPO = "BladAdd/ikra-shop";
const BRANCH = "main";
const PATH = "data/catalog.json";
const API = "https://api.github.com";

const token = execSync("gh auth token", { encoding: "utf8" }).trim();

function b64encode(str) {
  return Buffer.from(str, "utf8").toString("base64");
}
function b64decode(b64) {
  return Buffer.from(String(b64).replace(/\s/g, ""), "base64").toString("utf8");
}

async function gh(path, opts = {}) {
  const r = await fetch(API + path, {
    method: opts.method || "GET",
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json"
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

(async () => {
  console.log("1. Чтение файла из репозитория…");
  const file = await gh(`/repos/${REPO}/contents/${PATH}?ref=${BRANCH}`);
  const original = b64decode(file.content);
  const data = JSON.parse(original);
  const items = data.catalog.reduce((n, c) => n + c.items.length, 0);
  console.log(`   OK: sha=${file.sha.slice(0, 8)}  категорий=${data.catalog.length}  товаров=${items}`);

  console.log("2. Запись (проверка прав Contents: Read and write)…");
  const probe = JSON.parse(original);
  probe._selftest = new Date().toISOString();
  const put = await gh(`/repos/${REPO}/contents/${PATH}`, {
    method: "PUT",
    body: {
      message: "Админка: проверка записи (автотест)",
      content: b64encode(JSON.stringify(probe, null, 2) + "\n"),
      branch: BRANCH,
      sha: file.sha
    }
  });
  const newSha = put.content.sha;
  console.log(`   OK: новый sha=${newSha.slice(0, 8)}`);

  console.log("3. Откат к исходному содержимому…");
  const back = await gh(`/repos/${REPO}/contents/${PATH}`, {
    method: "PUT",
    body: {
      message: "Админка: откат автотеста",
      content: b64encode(original),
      branch: BRANCH,
      sha: newSha
    }
  });
  console.log(`   OK: sha=${back.content.sha.slice(0, 8)}`);

  console.log("4. Сверка содержимого…");
  const check = await gh(`/repos/${REPO}/contents/${PATH}?ref=${BRANCH}`);
  const now = b64decode(check.content);
  const same = JSON.stringify(JSON.parse(now)) === JSON.stringify(JSON.parse(original));
  console.log(`   ${same ? "OK: содержимое идентично исходному" : "ВНИМАНИЕ: содержимое отличается"}`);
  console.log(`   _selftest остался: ${now.includes("_selftest") ? "ДА (плохо)" : "нет (хорошо)"}`);
})().catch((e) => {
  console.error("ОШИБКА:", e.message);
  process.exit(1);
});
