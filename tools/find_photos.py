"""Поиск свободных (Commons) фото под карточку 4:3 без лишней еды.

Запуск: python tools/find_photos.py
Кладёт кандидатов в tools/candidates/<slot>/NN.jpg и пишет отчёт tools/candidates/report.json
"""
import json, os, re, sys, time, urllib.parse, urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = os.path.dirname(os.path.abspath(__file__))
CAND = os.path.join(BASE, "candidates")
UA = {"User-Agent": "CaviarShopImagePicker/1.0 (shop site build)"}
API = "https://commons.wikimedia.org/w/api.php"

# slot -> (запросы к Commons, плохие слова)
PLAN = {
    "okun": ["red sea perch smoked", "Sebastes cooked dish", "rockfish dish", "red gurnard dish"],
    "gorbusha-tesha": ["smoked pink salmon", "pink salmon fillet", "grilled pink salmon"],
    "bryushki-semgi": ["salmon belly", "smoked salmon slices", "salmon fillet piece"],
    "tunec-balyk": ["smoked tuna", "tuna loin", "cured tuna"],
    "gorbusha-plast": ["smoked salmon whole", "hot smoked salmon fish", "smoked fish whole wrap"],
    "skumbriya-hk": ["smoked mackerel fillet", "mackerel vacuum", "cold smoked fish"],
    "seld-hk": ["smoked herring", "herring fish smoked"],
    "seld-zalom": ["herring fish", "atlantic herring", "herring fillet"],
    "ivasi-hk": ["sardine fish", "sardinops sagax", "smoked sardines"],
    "moyva-hk": ["capelin fish", "capelin smoked", "mallotus villosus"],
    "ivasi-ss": ["sardines salted", "sardine fish fresh", "sardinops"],
    "keta-balyk": ["smoked chum salmon", "chum salmon fillet", "keta salmon fresh"],
    "vyal-vobla": ["dried roach fish", "dried fish rutilus", "vobla"],
    "vyal-kambala-ersh": ["dried flounder", "flatfish dried", "flounder fish"],
    "perepelinye": ["quail eggs", "quail egg", "Coturnix coturnix eggs"],
}
BAD = ("map", "chart", "logo", "diagram", "sign", "stamp", "skeleton", "drawing",
       "larva", "specimen", "museum", "lane", "street", "river", "bridge", "anatomy")


def api(params):
    params = dict(params, format="json")
    url = API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers=UA)
    for a in range(4):
        try:
            with urllib.request.urlopen(req, timeout=25) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            if a == 3:
                print("   API fail:", e)
                return {}
            time.sleep(2 + a * 2)


def fetch(url, dest):
    req = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = r.read()
        if len(data) < 15000:
            return False
        open(dest, "wb").write(data)
        return True
    except Exception:
        return False


report = {}
for slot, queries in PLAN.items():
    outdir = os.path.join(CAND, slot)
    os.makedirs(outdir, exist_ok=True)
    seen, got = set(), []
    for q in queries:
        data = api({"action": "query", "generator": "search", "gsrsearch": q,
                    "gsrnamespace": 6, "gsrlimit": 12, "prop": "imageinfo",
                    "iiprop": "url|size|extmetadata", "iiurlwidth": 1000})
        pages = (data.get("query") or {}).get("pages") or {}
        for p in pages.values():
            if "imageinfo" not in p:
                continue
            ii = p["imageinfo"][0]
            title = p["title"]
            low = title.lower()
            if low in seen or not low.endswith((".jpg", ".jpeg", ".png")):
                continue
            if any(b in low for b in BAD):
                continue
            w, h = ii["width"], ii["height"]
            if w < 700 or h < 500:
                continue
            ar = w / h
            if not (1.05 <= ar <= 1.9):
                continue
            seen.add(low)
            meta = ii.get("extmetadata") or {}
            lic = (meta.get("LicenseShortName", {}).get("value") or "")
            artist = re.sub(r"<[^>]+>", "", meta.get("Artist", {}).get("value") or "")[:80]
            got.append({"title": title, "thumb": ii.get("thumburl"), "page": ii.get("descriptionurl"),
                        "w": w, "h": h, "license": lic, "artist": artist, "q": q,
                        "title_clean": re.sub(r"^File:", "", title).rsplit(".", 1)[0].replace("_", " ")})
    got.sort(key=lambda x: abs(x["w"] / x["h"] - 1.33))
    n = 0
    for g in got[:8]:
        dest = os.path.join(outdir, f"{n:02d}.jpg")
        if fetch(g["thumb"], dest):
            g["file"] = os.path.join(slot, f"{n:02d}.jpg")
            n += 1
        time.sleep(0.6)
    report[slot] = [{k: v for k, v in g.items() if k != "thumb"} for g in got if "file" in g]
    print(f"{slot}: {len(report[slot])} photo(s)")
    time.sleep(1.2)

json.dump(report, open(os.path.join(CAND, "report.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("done")