# -*- coding: utf-8 -*-
"""
Фото заказчика -> кадры витрины.
Исходники лежат в tools/photo_src/client с русскими именами; здесь они приводятся
к 4:3 (как карточка товара), логотип поставщика «обрезается» кадрированием,
результат записывается под ASCII-именами.
"""
import os
from PIL import Image, ImageOps, ImageEnhance

SRC = os.path.join("tools", "photo_src", "client")
OUT = "assets/img"

# name -> (ascii, crop_box в долях (l, t, r, b), output_width)
JOBS = {
    "Скумбрия горячего копчения.jpg": ("skumbriya-gk.jpg", None, 900),
    "Скумбрия копчёная.jpg":          ("skumbriya-hk-slices.jpg", None, 900),
    "Селедка копчёная.jpg":           ("seld-kopchenaya.jpg", (0, 0, 1, 1), 900),
    "Иваси копченая.jpg":             ("ivasi-kopchenaya.jpg", None, 640),
    "Иваси.jpg":                      ("ivasi-ss.jpg", None, 640),
    "Мойва копчёная.jpg":             ("moyva-kopchenaya.jpg", None, 800),
    "Горбуша.jpg":                    ("gorbusha-tesha.jpg", None, 900),
    # Кадр 2.14:1 — распорки сверху; логотип поставщика в правом верхнем углу.
    "Горбуша копчёная.jpg":           ("gorbusha-gk-e.jpg", (0, 0.30, 1, 1), 900),
    "Масляная копчёная.jpg":          ("maslyanaya-kopchenaya.jpg", None, 900),
    "Палтус копчёный.jpg":            ("paltus-kopchenyy.jpg", None, 900),
    "Тунец копчёный.jpg":             ("tunec-kopchenyy.jpg", None, 900),
    "Брюшки сёмги копчёные.jpg":      ("bryushki-semgi-kopchenye.jpg", None, 900),
    "Крафтовый рулет тунец, сёмга, масляная.jpg": ("rulet-tunec-semga-maslyanaya.jpg", None, 900),
}

def center_crop_box(w, h, ratio):
    if w / h > ratio:
        nw = int(h * ratio); x = (w - nw) // 2
        return (x, 0, x + nw, h)
    nh = int(w / ratio); y = (h - nh) // 2
    return (0, y, w, y + nh)

for name, (ascii_name, frac, width) in JOBS.items():
    src = os.path.join(SRC, name)
    im = Image.open(src).convert("RGB")
    im = ImageOps.exif_transpose(im)
    w, h = im.size
    if frac:
        box = (int(w*frac[0]), int(h*frac[1]), int(w*frac[2]), int(h*frac[3]))
        im = im.crop(box)
        w, h = im.size
    im = im.crop(center_crop_box(w, h, 4/3))
    im = im.resize((width, int(width * 3 / 4)), Image.LANCZOS)
    im = ImageEnhance.Sharpness(im).enhance(1.12)
    im = ImageEnhance.Contrast(im).enhance(1.04)
    dst = os.path.join(OUT, ascii_name)
    im.save(dst, "JPEG", quality=88, optimize=True, progressive=True)
    print(f"{name} -> {ascii_name}  {im.size[0]}x{im.size[1]}  {os.path.getsize(dst)//1024} КБ")
