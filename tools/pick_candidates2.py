import json, os, sys, time, urllib.parse, urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
IMG = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "img"))
CAND = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "candidates"))
os.makedirs(CAND, exist_ok=True)
UA = {"User-Agent": "CaviarShopBuilder/1.0 (site build)"}
API = "https://commons.wikimedia.org/w/api.php"

# слот -> категории Commons, откуда брать фото
PLAN = {
    "fish-forel":     ["Smoked trout"],
    "fish-gorbusha":  ["Smoked salmon"],
    "fish-tunec":     ["Canned tuna", "Tuna as food"],
    "caviar-black-1": ["Caviar"],
    "liver-treska":   ["Cod liver as food", "Canned cod liver"],
    "hero-table":     ["Smoked fish", "Fish as food"],
}

BAD = ("oil", "capsule", "drawing", "map", "chart", "logo", "skeleton", "specimen",
       "larva", "fry", "juvenile", "stamp", "banknote", "diagram", "graph")


def api(params):
    params = dict(params, format="json")
    req = urllib.request.Request(API + "?" + urllib.parse.urlencode(params), headers=UA)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=25) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            if attempt == 2:
                raise
            time.sleep(2)


def cat_files(cat, limit=30):
    d = api({"action": "query", "generator": "categorymembers",
             "gcmtitle": f"Category:{cat}", "gcmtype": "file", "gcmlimit": limit,
             "prop": "imageinfo", "iiprop": "url|size|extmetadata|mime",
             "iiurlwidth": 1000})
    out = []
    for p in d.get("query", {}).get("pages", {}).values():
        ii = (p.get("imageinfo") or [{}])[0]
        if not ii.get("thumburl") or ii.get("mime") not in ("image/jpeg", "image/png", "image/webp"):
            continue
        t = p.get("title", "")
        if any(b in t.lower() for b in BAD):
            continue
        if (ii.get("width") or 0) < 800:
            continue
        meta = ii.get("extmetadata", {})
        out.append({
            "title": t, "url": ii["thumburl"], "page": ii.get("descriptionurl", ""),
            "license": meta.get("LicenseShortName", {}).get("value", ""),
            "artist": meta.get("Artist", {}).get("value", ""),
            "w": ii.get("width"), "h": ii.get("height"),
        })
    return out


picks = {}
for slot, cats in PLAN.items():
    cands = []
    for cat in cats:
        try:
            cands += cat_files(cat)
        except Exception as e:
            print(f"[CAT FAIL] {slot} / {cat}: {e}")
        if len(cands) >= 3:
            break
    picks[slot] = []
    for i, r in enumerate(cands[:3]):
        fname = f"{slot}__{i}.jpg"
        try:
            req = urllib.request.Request(r["url"], headers=UA)
            with urllib.request.urlopen(req, timeout=25) as rr:
                data = rr.read()
            open(os.path.join(CAND, fname), "wb").write(data)
            picks[slot].append(dict(r, cand=fname, bytes=len(data)))
            print(f"[CAND] {fname:28} {r['license']:14} {r['title'][:62]}")
        except Exception as e:
            print(f"[FAIL] {fname}: {e}")
        time.sleep(0.6)
    sys.stdout.flush()

json.dump(picks, open(os.path.join(CAND, "picks2.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=2)
print("\nDone. Candidates in tools/candidates")