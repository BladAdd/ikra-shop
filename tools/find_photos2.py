"""Пакет 2: продукты в товарном виде (пачка/поднос), не на тарелке в блюде."""
import json, os, re, sys, time, urllib.parse, urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
BASE = os.path.dirname(os.path.abspath(__file__))
CAND = os.path.join(BASE, "candidates")
UA = {"User-Agent": "CaviarShopImagePicker/1.0 (shop site build)"}
API = "https://commons.wikimedia.org/w/api.php"

SEARCH = {
    "gorbusha-tesha": ["hot smoked salmon", "smoked pink salmon fish", "salmon fillet raw"],
    "bryushki-semgi": ["salmon fillet sliced", "gravlax salmon", "salmon sashimi plate"],
    "keta-balyk": ["chum salmon", "keta fish", "chum salmon smoked"],
    "bryushki2": ["smoked salmon pieces", "salmon belly smoked", "cured salmon fillet"],
    "gorbusha-plast2": ["smoked fish market", "smoked salmon whole fish", "hot smoked fish"],
    "seld-zalom2": ["herring fillets", "herring salted", "salted herring"],
    "ivasi-hk2": ["smoked sardines", "canned sardines", "sardine fish market"],
    "tunec-balyk2": ["mojama", "tuna jerky", "tuna steak smoked"],
    "skumbriya-hk2": ["smoked mackerel slices", "mackerel smoked whole", "smoked fish plate"],
}
BAD = ("map", "chart", "logo", "diagram", "sign", "stamp", "skeleton", "drawing", "larva",
       "specimen", "museum", "street", "bridge", "anatomy", "boat", "catch", "net", "port",
       "catalogue", "innisfallen", "gull", "lake", "underwater", "reef")


def api(params):
    url = API + "?" + urllib.parse.urlencode(dict(params, format="json"))
    req = urllib.request.Request(url, headers=UA)
    for a in range(4):
        try:
            with urllib.request.urlopen(req, timeout=25) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            if a == 3:
                print("  API fail:", e); return {}
            time.sleep(3 + a * 3)


def fetch(url, dest):
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=30) as r:
            data = r.read()
        if len(data) < 15000:
            return False
        open(dest, "wb").write(data)
        return True
    except Exception:
        return False


report = json.load(open(os.path.join(CAND, "report.json"), encoding="utf-8"))
for slot, queries in SEARCH.items():
    outdir = os.path.join(CAND, slot)
    os.makedirs(outdir, exist_ok=True)
    got, seen = [], set()
    for q in queries:
        data = api({"action": "query", "generator": "search", "gsrsearch": q, "gsrnamespace": 6,
                    "gsrlimit": 12, "prop": "imageinfo", "iiprop": "url|size|extmetadata",
                    "iiurlwidth": 1000})
        for p in ((data.get("query") or {}).get("pages") or {}).values():
            if "imageinfo" not in p:
                continue
            ii = p["imageinfo"][0]
            low = p["title"].lower()
            if low in seen or not low.endswith((".jpg", ".jpeg", ".png")):
                continue
            if any(b in low for b in BAD):
                continue
            w, h = ii["width"], ii["height"]
            if w < 700 or h < 500 or not (1.05 <= w / h <= 1.9):
                continue
            seen.add(low)
            meta = ii.get("extmetadata") or {}
            got.append({"title": p["title"], "thumb": ii.get("thumburl"), "page": ii.get("descriptionurl"),
                        "w": w, "h": h, "license": meta.get("LicenseShortName", {}).get("value") or "",
                        "artist": re.sub(r"<[^>]+>", "", meta.get("Artist", {}).get("value") or "")[:80],
                        "q": q, "title_clean": re.sub(r"^File:", "", p["title"]).rsplit(".", 1)[0].replace("_", " ")})
        time.sleep(1.5)
    got.sort(key=lambda x: abs(x["w"] / x["h"] - 1.33))
    report[slot] = []
    n = 0
    for g in got[:8]:
        if fetch(g["thumb"], os.path.join(outdir, f"{n:02d}.jpg")):
            g["file"] = os.path.join(slot, f"{n:02d}.jpg")
            report[slot].append({k: v for k, v in g.items() if k != "thumb"})
            n += 1
        time.sleep(0.6)
    print(slot, n)

json.dump(report, open(os.path.join(CAND, "report.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("done")