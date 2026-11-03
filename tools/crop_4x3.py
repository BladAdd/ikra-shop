# -*- coding: utf-8 -*-
"""
Товарные фото каталога -> единый кадр 4:3.
Читает data/catalog.json, находит подключённые карточками фото (img без
__NEED_PHOTO__) и центральным кропом приводит их к точным 4:3 — то же
кадрирование, что раньше делал CSS object-fit:cover, поэтому витрина
визуально не меняется. Более 1400 px по ширине — уменьшение до 1400x1050
(LANCZOS), меньшие не апскейлятся. Файлы, уже попадающие в 4:3 с допуском,
не перекодируются — повторный запуск ничего не меняет.
"""
import json
import os
from PIL import Image, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATALOG = os.path.join(ROOT, "data", "catalog.json")
IMG_DIR = os.path.join(ROOT, "assets", "img")

RATIO = 4 / 3      # целевая пропорция карточки товара
MAX_W = 1400       # шире — уменьшаем до 1400x1050
TOL = 0.005        # допуск по отклонению пропорции от 4:3 (уже в допуске — пропуск)

def center_crop_box(w, h, ratio):
    if w / h > ratio:
        nw = int(h * ratio); x = (w - nw) // 2
        return (x, 0, x + nw, h)
    nh = int(w / ratio); y = (h - nh) // 2
    return (0, y, w, y + nh)

def catalog_images():
    """Имена файлов, подключённые в каталоге (заглушка __NEED_PHOTO__ не трогается)."""
    with open(CATALOG, encoding="utf-8") as f:
        data = json.load(f)
    names = set()
    for cat in data["catalog"]:
        for item in cat.get("items", []):
            img = item.get("img", "")
            if img and "__NEED_PHOTO__" not in img:
                names.add(os.path.basename(img))
    return sorted(names)

for name in catalog_images():
    path = os.path.join(IMG_DIR, name)
    if not os.path.isfile(path):
        print(f"!! нет файла: {name}")
        continue
    im = Image.open(path)
    icc = im.info.get("icc_profile")  # цветовой профиль исходника сохраняем
    im = ImageOps.exif_transpose(im)
    w, h = im.size
    if abs(w / h - RATIO) <= TOL:
        print(f"-- {name}  {w}x{h}  уже 4:3, пропуск")
        continue
    size_before, bytes_before = (w, h), os.path.getsize(path)
    im = im.convert("RGB").crop(center_crop_box(w, h, RATIO))
    if im.size[0] > MAX_W:
        im = im.resize((MAX_W, int(MAX_W * 3 / 4)), Image.LANCZOS)
    tmp = path + ".tmp"
    im.save(tmp, "JPEG", quality=88, optimize=True, progressive=True, icc_profile=icc)
    os.replace(tmp, path)  # сначала во временный файл, чтобы не оставить битый JPEG
    w2, h2 = im.size
    print(f"{name}  {size_before[0]}x{size_before[1]} -> {w2}x{h2}  "
          f"{bytes_before // 1024} КБ -> {os.path.getsize(path) // 1024} КБ")
