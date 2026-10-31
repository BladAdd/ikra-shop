# -*- coding: utf-8 -*-
"""Подбор фото на Wikimedia Commons: только свободные лицензии.
stage 1 -> tools/candidates/<set>/<key>/NN.jpg + license.json (1200px, как есть)
stage 2 (--final) -> assets/img/<key>.jpg (кадр 4:3, 900x675)
run: python tools/wm3.py '<json {"key": {"q": "query", "pick": 1}}>' [--final]
"""
import json, os, re, sys, urllib.parse, urllib.request
from io import BytesIO
from PIL import Image, ImageOps, ImageFilter

UA = {"User-Agent": "ikra-shop-photo-picker/1.0 (shop catalogue photos)"}
SET = os.environ.get("WM_SET", "wm4")
ROOT = os.path.join("tools", "candidates", SET)
FINAL = "--final" in sys.argv
spec = json.loads([a for a in sys.argv[1:] if not a.startswith("--")][0])
spec = {k: (v if isinstance(v, dict) else {"q": v}) for k, v in spec.items()}

def api(params):
    params = dict(params, format="json")
    url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(params)
    return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read())

def search(term, limit=50):
    d = api({"action": "query", "generator": "search", "gsrsearch": term + " filetype:bitmap",
             "gsrlimit": limit, "gsrnamespace": 6, "prop": "imageinfo",
             "iiprop": "url|size|extmetadata", "iiurlwidth": 1200})
    out = []
    for p in (d.get("query", {}).get("pages", {}) or {}).values():
        ii = p["imageinfo"][0]; meta = ii.get("extmetadata", {})
        lic = meta.get("LicenseShortName", {}).get("value", "")
        if not re.search(r"CC BY|CC0|Public domain|CC-BY", lic, re.I):
            continue
        out.append({"title": p["title"], "url": ii.get("thumburl") or ii["url"],
                    "w": ii["width"], "h": ii["height"], "page": ii.get("descriptionurl"),
                    "license": lic,
                    "artist": re.sub(r"<[^>]+>", "", meta.get("Artist", {}).get("value", ""))[:90]})
    return out

def to_card(src, dst):
    im = ImageOps.exif_transpose(Image.open(src)).convert("RGB")
    W, H = im.size
    if H / W > 1.05:                       # портретный кадр — берём центр с запасом
        nh = int(W * 0.95); im = im.crop((0, (H - nh) // 2, W, (H - nh) // 2 + nh))
    W, H = im.size; r = 4 / 3
    if W / H > r:
        nw = int(H * r); im = im.crop(((W - nw) // 2, 0, (W - nw) // 2 + nw, H))
    else:
        nh = int(W / r); im = im.crop((0, (H - nh) // 2, W, (H - nh) // 2 + nh))
    im = im.resize((900, 675), Image.LANCZOS).filter(ImageFilter.UnsharpMask(radius=1.1, percent=45, threshold=3))
    im.save(dst, "JPEG", quality=88, optimize=True, progressive=True)

def main(spec, FINAL):
  for key, cfg in spec.items():
    q = cfg["q"]; lim = cfg.get("limit", 50)
    d = os.path.join(ROOT, key); os.makedirs(d, exist_ok=True)
    lic_path = os.path.join(d, "license.json")
    if FINAL:
        pick = cfg.get("pick"); pickf = cfg.get("pickfile")
        data = json.load(open(lic_path, encoding="utf-8"))
        src = os.path.join(d, f"{pick:02d}.jpg") if pick else os.path.join(ROOT, "_raw", pickf)
        to_card(src, os.path.join("assets", "img", key + ".jpg"))
        if pick:
            el = dict(data[pick - 1]); el["file"] = "assets/img/" + key + ".jpg"
            json.dump([el], open(os.path.join("tools", "candidates", "final_" + key + ".json"), "w", encoding="utf-8"),
                      ensure_ascii=False, indent=1)
        print("final", key, "->", pick or pickf)
        continue
    if cfg.get("pickfile"):
        print(key, "procure-only"); continue
    if os.path.exists(lic_path) and json.load(open(lic_path, encoding="utf-8")):
        print(key, "skip"); continue
    try:
        found = search(q, lim)
    except Exception as e:
        print(key, "search failed", e); continue
    got = []
    for c in found:
        if min(c["w"], c["h"]) < 500:
            continue
        try:
            data = urllib.request.urlopen(urllib.request.Request(c["url"], headers=UA), timeout=60).read()
            im = Image.open(BytesIO(data)).convert("RGB")
        except Exception:
            continue
        n = len(got) + 1
        im.save(os.path.join(d, f"{n:02d}.jpg"), "JPEG", quality=86)
        c["file"] = f"{key}/{n:02d}.jpg"; got.append(c)
        if len(got) >= cfg.get("want", 6):
            break
    json.dump(got, open(lic_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(key, len(got))
