/* Удаляет тестовый товар из data/catalog.json в репозитории. */
const { execSync } = require("child_process");

const REPO = "BladAdd/ikra-shop";
const BRANCH = "main";
const PATH = "data/catalog.json";
const API = "https://api.github.com";
const token = execSync("gh auth token", { encoding: "utf8" }).trim();

const b64enc = (s) => Buffer.from(s, "utf8").toString("base64");
const b64dec = (s) => Buffer.from(String(s).replace(/\s/g, ""), "base64").toString("utf8");

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
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : {};
}

(async () => {
  const file = await gh(`/repos/${REPO}/contents/${PATH}?ref=${BRANCH}`);
  const data = JSON.parse(b64dec(file.content));

  let removed = 0;
  data.catalog.forEach((c) => {
    const before = c.items.length;
    c.items = c.items.filter((i) => !/ТЕСТОВЫЙ ТОВАР/i.test(i.name || ""));
    removed += before - c.items.length;
  });

  const total = data.catalog.reduce((n, c) => n + c.items.length, 0);
  console.log(`удалено тестовых: ${removed}, осталось товаров: ${total}`);

  if (!removed) {
    console.log("нечего удалять");
    return;
  }

  await gh(`/repos/${REPO}/contents/${PATH}`, {
    method: "PUT",
    body: {
      message: "Удалён тестовый товар после проверки админки",
      content: b64enc(JSON.stringify(data, null, 2) + "\n"),
      branch: BRANCH,
      sha: file.sha
    }
  });
  console.log("готово");
})().catch((e) => {
  console.error("ОШИБКА:", e.message);
  process.exit(1);
});