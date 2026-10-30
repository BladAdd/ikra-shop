/* Сквозной тест админки: добавление товара, изменение цены, сохранение в репозиторий. */
const puppeteer = require("puppeteer-core");
const { execSync } = require("child_process");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = "http://localhost:8777";
const token = execSync("gh auth token", { encoding: "utf8" }).trim();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu"]
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });

  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("CONSOLE: " + m.text());
  });

  console.log("1. Открываю админку и вхожу…");
  await page.goto(BASE + "/admin.html", { waitUntil: "networkidle2" });
  await page.evaluate(
    (t) => {
      localStorage.setItem("ikra_admin_repo", "BladAdd/ikra-shop");
      localStorage.setItem("ikra_admin_token", t);
      localStorage.setItem("ikra_admin_branch", "main");
    },
    token
  );
  await page.reload({ waitUntil: "networkidle2" });
  await page.waitForSelector("#shell.on", { timeout: 20000 });
  await sleep(2500);

  const status = await page.$eval("#st-text", (e) => e.textContent);
  const items = await page.$eval("#st-items", (e) => e.textContent);
  console.log(`   статус: "${status}"  товаров: ${items}`);

  console.log("2. Открываю форму нового товара…");
  await page.click("#btn-add-item");
  await page.waitForSelector("#modal-item.on", { timeout: 5000 });
  await sleep(400);

  console.log("3. Заполняю и сохраняю товар…");
  await page.type("#mi-name", "ТЕСТОВЫЙ ТОВАР");
  await page.type("#mi-price", "1234");
  await page.type("#mi-weight", "250 г");
  await page.type("#mi-desc", "Проверка админки, будет удалено");
  await page.click("#mi-save");
  await sleep(800);

  const afterAdd = await page.$eval("#st-items", (e) => e.textContent);
  const dirtyOn = await page.$eval("#dirty", (e) => e.classList.contains("on"));
  console.log(`   товаров стало: ${afterAdd}  флаг изменений: ${dirtyOn ? "есть" : "нет"}`);

  const hasTest = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".item .info b")).some((b) =>
      b.textContent.includes("ТЕСТОВЫЙ ТОВАР")
    )
  );
  console.log(`   товар виден в списке: ${hasTest ? "да" : "НЕТ"}`);

  console.log("4. Сохраняю на сайт (запись в GitHub)…");
  await page.click("#btn-save");
  await sleep(6000);
  const saveStatus = await page.$eval("#st-text", (e) => e.textContent);
  const dirtyAfter = await page.$eval("#dirty", (e) => e.classList.contains("on"));
  console.log(`   статус после сохранения: "${saveStatus}"`);
  console.log(`   флаг изменений: ${dirtyAfter ? "ОСТАЛСЯ (плохо)" : "снят (хорошо)"}`);

  await page.screenshot({ path: "tools/shots/admin-after-save.png" });

  console.log("5. Ошибки в консоли:");
  console.log(errors.length ? "   " + errors.join("\n   ") : "   нет");

  await browser.close();
})().catch((e) => {
  console.error("ТЕСТ УПАЛ:", e.message);
  process.exit(1);
});
