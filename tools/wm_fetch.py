# -*- coding: utf-8 -*-
"""Подбирает фото с Wikimedia Commons (лицензия CC/PD, коммерческое использование)
и складывает кандидатов в tools/candidates/wm/<key>/ вместе с license.json."""
import json, os, re, sys, urllib.parse, urllib.request
from PIL import Image
from io import BytesIO

UA = {"User-Agent": "ikra-shop-photo-picker/1.0 (contact: shop@example.ru)"}

def api(params):
    params = dict(params, format="json")
    url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(params)
    return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read())

def search(term, limit=40, maxw=2600):
    d = api({
        "action": "query", "generator": "search",
        "gsrsearch": term + " filetype:bitmap", "gsrlimit": limit, "gsrnamespace": 6,
        "prop": "imageinfo", "iiprop": "url|size|extmetadata", "iiurlwidth": 1400,
    })
    out = []
    for p in (d.get("query", {}).get("pages", {}) or {}).values():
        ii = p["imageinfo"][0]
        meta = ii.get("extmetadata", {})
        lic = meta.get("LicenseShortName", {}).get("value", "")
        artist = re.sub(r"<[^>]+>", "", meta.get("Artist", {}).get("value", ""))[:80]
        if not re.search(r"CC BY|CC0|Public domain|CC-BY", lic, re.I):
            continue
        if min(ii["width"], ii["height"]) < 700 or ii["width"] < ii["height"] * 0.75:
            continue
        if max(ii["width"], ii["height"]) > maxw * 3:
            # гигантские снимки чаще всего чужие сканы каталогов
            continue
        out.append({"title": p["title"], "url": ii.get("thumburl") or ii["url"],
                    "width": ii["width"], "height": ii["height"],
                    "page": ii.get("descriptionurl"), "license": lic, "artist": artist})
    return out

def fetch(key, term):
    os.makedirs(root, exist_ok=True)
    got = []
    for c in search(term):
        try:
            data = urllib.request.urlopen(urllib.request.Request(c["url"], headers=UA), timeout=30).read()
            im = Image.open(BytesIO(data)).convert("RGB")
        except Exception:
            continue
        if im.width < 500 or im.height < 320:
            continue
        n = len(got) + 1
        path = os.path.join(root, f"{n:02d}.jpg")
        im.save(path, "JPEG", quality=88)
        c["file"] = f"{key}/{n:02d}.jpg"
        got.append(c)
        if len(got) >= 6:
            break
    with open(os.path.join(root, "license.json"), "w", encoding="utf-8") as f:
        json.dump(got, f, ensure_ascii=False, indent=1)
    print(key, len(got))

queries = json.loads(sys.argv[1])
for key, term in queries.items():
    root = os.path.join("tools/candidates/wm", key)
    lic = os.path.join(root, "license.json")
    if os.path.exists(lic) and json.load(open(lic, encoding="utf-8")):
        print(key, "skip"); continue
    fetch(key, term)
