import json, os, sys, time, urllib.parse, urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
BASE = os.path.dirname(os.path.abspath(__file__))
CAND = os.path.join(BASE, "candidates2")
os.makedirs(CAND, exist_ok=True)
UA = {"User-Agent": "CaviarShopBuilder/1.0 (site build)"}
API = "https://commons.wikimedia.org/w/api.php"

PLAN = {
    "red-caviar":     ["Salmon roe", "Red caviar", "Caviar"],
    "black-caviar":   ["Caviar", "Sturgeon caviar"],
    "smoked-salmon":  ["Smoked salmon"],
    "smoked-mackerel":["Smoked mackerel"],
    "smoked-trout":   ["Smoked trout"],
    "smoked-fish":    ["Smoked fish"],
    "tuna":           ["Tuna as food", "Canned tuna"],
    "cod-liver":      ["Cod liver"],
}

BAD = ("oil", "capsule", "drawing", "map", "chart", "logo", "skeleton", "specimen",
       "larva", "fry", "juvenile", "stamp", "banknote", "diagram", "graph", "sign",
       "label", "advert", "poster", "smoking", "project")


def api(params):
    params = dict(params, format="json")
    req = urllib.request.Request(API + "?" + urllib.parse.urlencode(params), headers=UA)
    for a in range(3):
        try:
            with urllib.request.urlopen(req, timeout=25) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception:
            if a == 2:
                raise
            time.sleep(2)


def cat_files(cat, limit=40):
    try:
        d = api({"action": "query", "generator": "categorymembers",
                 "gcmtitle": f"Category:{cat}", "gcmtype": "file", "gcmlimit": limit,
                 "prop": "imageinfo", "iiprop": "url|size|extmetadata|mime",
                 "iiurlwidth": 1100})
    except Exception as e:
        print(f"  [cat fail] {cat}: {e}")
        return []
    out = []
    for p in d.get("query", {}).get("pages", {}).values():
        ii = (p.get("imageinfo") or [{}])[0]
        if not ii.get("thumburl") or ii.get("mime") not in ("image/jpeg", "image/png", "image/webp"):
            continue
        t = p.get("title", "")
        if any(b in t.lower() for b in BAD):
            continue
        if (ii.get("width") or 0) < 900:
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
    seen, cands = set(), []
    for cat in cats:
        for r in cat_files(cat):
            if r["title"] in seen:
                continue
            seen.add(r["title"])
            cands.append(r)
        if len(cands) >= 5:
            break
    picks[slot] = []
    for i, r in enumerate(cands[:4]):
        fname = f"{slot}__{i}.jpg"
        try:
            req = urllib.request.Request(r["url"], headers=UA)
            with urllib.request.urlopen(req, timeout=25) as rr:
                data = rr.read()
            open(os.path.join(CAND, fname), "wb").write(data)
            picks[slot].append(dict(r, cand=fname, bytes=len(data)))
            print(f"[CAND] {fname:26} {r['license']:14} {r['title'][:60]}")
        except Exception as e:
            print(f"[FAIL] {fname}: {e}")
        time.sleep(0.5)
    sys.stdout.flush()

json.dump(picks, open(os.path.join(CAND, "picks.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=2)
print("\nDone")