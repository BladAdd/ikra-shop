"""Финальная обработка фото для витрины: кадрирование 4:3 + ресайз до 1200px."""
import os, sys
from PIL import Image

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
BASE = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.abspath(os.path.join(BASE, "..", "assets", "img"))
C2 = os.path.join(BASE, "candidates2")

# целевое имя -> файл-источник
FINAL = {
    "caviar-red-1.jpg":  ("red-caviar__0.jpg",  (0.5, 0.5)),
    "caviar-red-2.jpg":  ("red-caviar__3.jpg",  (0.5, 0.5)),
    "caviar-red-3.jpg":  ("red-caviar__2.jpg",  (0.5, 0.5)),
    "caviar-black-1.jpg":("black-caviar__0.jpg",(0.5, 0.45)),
    "caviar-black-2.jpg":("black-caviar__2.jpg",(0.5, 0.5)),
    "hero-caviar.jpg":   ("red-caviar__1.jpg",  (0.5, 0.5)),
    "hero-table.jpg":    ("smoked-fish__1.jpg", (0.5, 0.5)),
    "fish-semga.jpg":    ("smoked-salmon__1.jpg",(0.5, 0.5)),
    "fish-skumbriya.jpg":("smoked-mackerel__0.jpg",(0.5, 0.5)),
    "fish-forel.jpg":    ("smoked-trout__2.jpg",(0.5, 0.5)),
    "fish-gorbusha.jpg": ("smoked-salmon__0.jpg",(0.5, 0.5)),
    "fish-tunec.jpg":    ("tuna__1.jpg",        (0.5, 0.5)),
    "fish-kizhuch.jpg":  ("smoked-fish__0.jpg", (0.5, 0.5)),
    "fish-maslyanaya.jpg":("smoked-fish__2.jpg",(0.5, 0.5)),
    "fish-moyva.jpg":    ("smoked-mackerel__2.jpg",(0.5, 0.5)),
    "liver-treska.jpg":  ("cod-liver__2.jpg",   (0.5, 0.5)),
}

TARGET = (1200, 900)


def crop_center(im, focus):
    tw, th = TARGET
    tr = tw / th
    w, h = im.size
    r = w / h
    if r > tr:                      # шире — режем по бокам
        nw = int(h * tr)
        cx = int(w * focus[0])
        x0 = max(0, min(w - nw, cx - nw // 2))
        box = (x0, 0, x0 + nw, h)
    else:                           # выше — режем сверху/снизу
        nh = int(w / tr)
        cy = int(h * focus[1])
        y0 = max(0, min(h - nh, cy - nh // 2))
        box = (0, y0, w, y0 + nh)
    return im.crop(box).resize(TARGET, Image.LANCZOS)


done, err = [], []
for out_name, (src_name, focus) in FINAL.items():
    src = os.path.join(C2, src_name)
    if not os.path.exists(src):
        err.append(f"MISS src {src_name}")
        continue
    try:
        im = Image.open(src).convert("RGB")
        im = crop_center(im, focus)
        dst = os.path.join(IMG, out_name)
        im.save(dst, "JPEG", quality=86, optimize=True, progressive=True)
        done.append((out_name, os.path.getsize(dst)))
        print(f"[OK] {out_name:22} {os.path.getsize(dst)//1024:4} KB  <- {src_name}")
    except Exception as e:
        err.append(f"{out_name}: {e}")

print(f"\nprocessed {len(done)}/{len(FINAL)}")
for e in err:
    print(" !", e)