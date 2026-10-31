# -*- coding: utf-8 -*-
"""Поиск и подготовка фото товаров (Wikimedia Commons, только свободные лицензии).

    python tools/photo_tools.py search '<json {"id": "запрос"}>'
    python tools/photo_tools.py card <id> <set>/<NN>     # выбранный кадр -> assets/img/<id>.jpg
"""
import json, os, re, sys, urllib.parse, urllib.request
from io import BytesIO
from PIL import Image, ImageOps, ImageFilter

UA = {"User-Agent": "ikra-shop-photo-picker/1.0 (shop catalogue photos)"}


def api(params):
    params = dict(params, format="json")
    url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(params)
    return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read())


def search(term, want=10, limit=50):
    # "intitle:" — иначе полнотекстовый поиск выдаёт чужие блюда, где слово лишь упомянуто
    q = "intitle:" + term + " filetype:bitmap" if "intitle:" not in term else term
    d = api({"action": "query", "generator": "search", "gsrsearch": q,
             "gsrlimit": limit, "gsrnamespace": 6, "prop": "imageinfo",
             "iiprop": "url|size|extmetadata", "iiurlwidth": 1200})
    out = []
    for p in (d.get("query", {}).get("pages", {}) or {}).values():
        ii = p["imageinfo"][0]; meta = ii.get("extmetadata", {})
        lic = meta.get("LicenseShortName", {}).get("value", "")
        if not re.search(r"CC BY|CC0|Public domain|CC-BY", lic, re.I):
            continue
        if min(ii["width"], ii["height"]) < 500:
            continue
        title = p["title"].lower()
        bad = ("stew", "soup", "burger", "sandwich", "pizza", "salad", "with ", "and ", "map", "menu",
               "engraving", "poster", "label", "document", "ticket", "book", "portrait", "street")
        if any(b in title for b in bad):
            continue
        out.append({"title": p["title"], "url": ii.get("thumburl") or ii["url"],
                    "page": ii.get("descriptionurl"), "license": lic,
                    "artist": re.sub(r"<[^>]+>", "", meta.get("Artist", {}).get("value", ""))[:90]})
    return out[:want]


def crop43(src):
    im = ImageOps.exif_transpose(Image.open(src)).convert("RGB")
    W, H = im.size; r = 4 / 3
    if W / H > r:
        nw = int(H * r); im = im.crop(((W - nw) // 2, 0, (W - nw) // 2 + nw, H))
    else:
        nh = int(W / r); im = im.crop((0, (H - nh) // 2, W, (H - nh) // 2 + nh))
    return im.resize((900, 675), Image.LANCZOS).filter(ImageFilter.UnsharpMask(radius=1.1, percent=45, threshold=3))


def do_search(spec, base="tools/candidates/photos"):
    for key, q in spec.items():
        d = os.path.join(base, key); os.makedirs(d, exist_ok=True)
        lic = os.path.join(d, "license.json")
        if os.path.exists(lic) and json.load(open(lic, encoding="utf-8")):
            print(key, "skip"); continue
        got = []
        try:
            found = search(q)
        except Exception as e:
            print(key, "failed", e); continue
        for c in found:
            try:
                data = urllib.request.urlopen(urllib.request.Request(c["url"], headers=UA), timeout=60).read()
                im = Image.open(BytesIO(data)).convert("RGB")
            except Exception:
                continue
            got.append(c)
            im.save(os.path.join(d, f"{len(got):02d}.jpg"), "JPEG", quality=86)
        json.dump(got, open(lic, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(key, len(got))


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "search":
        do_search({k: (v if isinstance(v, str) else v["q"]) for k, v in json.loads(sys.argv[2]).items()})
    elif cmd == "card":
        ident, ref = sys.argv[2], sys.argv[3]
        src = os.path.join("tools/candidates/photos", ref + ".jpg")
        crop43(src).save(os.path.join("assets", "img", ident + ".jpg"), "JPEG", quality=88, optimize=True, progressive=True)
        print("card", ident, "<-", src)
