"""Установка отобранных свободных фото в assets/img с обрезкой под карточку 4:3.

Запуск: python tools/install_photos.py
"""
import json, os, sys
from PIL import Image, ImageOps

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
root = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
CAND = os.path.join(root, "tools", "candidates")
IMG = os.path.join(root, "assets", "img")

# (слот, индекс кандидата, имя файла на сайте, ширина, высота)
JOBS = [
    ("bryushki-semgi", 5, "bryushki-semgi-kopchenye.jpg", 900, 675),
    ("tunec-balyk2", 3, "tunec-kopchenyy.jpg", 900, 675),
    ("gorbusha-plast2", 4, "gorbusha-plast.jpg", 900, 675),
    ("skumbriya-hk2", 2, "skumbriya-hk-slices.jpg", 900, 675),
    ("perepelinye", 5, "yaica-perepelinye.jpg", 900, 675),
    ("ivasi-ss", 0, "ivasi-ss.jpg", 900, 675),
    ("moyva-hk", 3, "moyva-kopchenaya.jpg", 900, 675),
    # CLOSER: сколько процентов кадра оставить (меньше 100 — ближе к рыбе)
    ("gorbusha-plast2", 4, "gorbusha-plast.jpg", 900, 675, 118),
    ("skumbriya-hk2", 2, "skumbriya-hk-slices.jpg", 900, 675, 112),
    ("skumbriya-hk2", 2, "skumbriya-hk-fresh.jpg", 900, 675, 92),
    ("gorbusha-plast2", 0, "gorbusha-plast-fresh.jpg", 900, 675, 55),
    ("keta-balyk", 3, "keta-live.jpg", 900, 675, 100),
    ("ivasi-hk", 4, "ivasi-live.jpg", 900, 675, 100),
]

report = json.load(open(os.path.join(CAND, "report.json"), encoding="utf-8"))
credits = json.load(open(os.path.join(IMG, "credits.json"), encoding="utf-8"))
done = {}

for job in JOBS:
    slot, idx, out_name, tw, th = job[:5]
    closer = job[5] if len(job) > 5 else 100  # % кадра, который оставляем (100 — весь кадр)
    g = report[slot][idx]
    src = ImageOps.exif_transpose(Image.open(os.path.join(CAND, g["file"])).convert("RGB"))
    w, h = src.size
    ratio = tw / th
    if w / h > ratio:
        nw = int(h * ratio)
        src = src.crop(((w - nw) // 2, 0, (w + nw) // 2, h))
    else:
        nh = int(w / ratio)
        src = src.crop((0, (h - nh) // 2, w, (h + nh) // 2))
    if closer != 100:
        w, h = src.size
        cw, ch = int(w * closer / 100), int(h * closer / 100)
        left, top = (w - cw) // 2, int((h - ch) * 0.3)
        src = src.crop((left, top, left + cw, top + ch))
    src = src.resize((tw, th), Image.LANCZOS)
    dest = os.path.join(IMG, out_name)
    src.save(dest, "JPEG", quality=88, optimize=True, progressive=True)
    credits = [c for c in credits if c["file"] != "assets/img/" + out_name]
    credits.append({"file": "assets/img/" + out_name, "source": g["title"],
                    "license": g["license"], "author": g["artist"], "page": g["page"]})
    done[slot] = "assets/img/" + out_name
    print(f"{out_name}: {tw}x{th} <- {g['title']}")

json.dump(credits, open(os.path.join(IMG, "credits.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
json.dump(done, open(os.path.join(CAND, "installed.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)

# Подключаем новые файлы к каталогу
catalog_path = os.path.join(root, "data", "catalog.json")
cat = json.load(open(catalog_path, encoding="utf-8"))
# слот -> id товара, который его использует
ITEM_OF_SLOT = {
    "bryushki-semgi": "sm-bryushki-semgi",
    "tunec-balyk2": "sm-tunec-balyk",
    "gorbusha-plast2": "sm-gorbusha-plast",
    "skumbriya-hk2": "sm-skumbriya-hk",
    "perepelinye": "yaica-perepelinye",
    "ivasi-ss": "ss-ivasi",
    "moyva-hk": "sm-moyva-hk",
}
changed = 0
for c in cat["catalog"]:
    for it in c["items"]:
        for slot, item_id in ITEM_OF_SLOT.items():
            if it["id"] == item_id:
                it["img"] = done[slot]
                changed += 1
                print("catalog:", it["id"], "->", done[slot])
if changed == 0:
    raise SystemExit("Ни один товар не найден — id в ITEM_OF_SLOT устарели, каталог не тронут.")
with open(catalog_path, "w", encoding="utf-8") as f:
    json.dump(cat, f, ensure_ascii=False, indent=2)
    f.flush()
print("changed:", changed, "| catalog size:", os.path.getsize(catalog_path))
print("verify:", open(catalog_path, encoding="utf-8").read().count(".jpg") >= changed)