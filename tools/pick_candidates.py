import json, os, sys, urllib.parse, urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
IMG = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "img"))
CAND = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "candidates"))
os.makedirs(CAND, exist_ok=True)
UA = {"User-Agent": "CaviarShopBuilder/1.0 (site build)"}
API = "https://commons.wikimedia.org/w/api.php"

BAD = ("larva", "fry", "juvenile", "egg", "drawing", "illustration", "slNSW".lower(),
       "map", "chart", "cooking", "boiled", "cake", "logo", "specimen", "skeleton")


def api(params):
    params = dict(params, format="json")
    req = urllib.request.Request(API + "?" + urllib.parse.urlencode(params), headers=UA)
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read().decode("utf-8"))


def search(query, limit=25):
    d = api({"action": "query", "generator": "search", "gsrsearch": query,
             "gsrlimit": limit, "gsrnamespace": 6, "prop": "imageinfo",
             "iiprop": "url|size|extmetadata|mime", "iiurlwidth": 1000})
    out = []
    for p in d.get("query", {}).get("pages", {}).values():
        ii = (p.get("imageinfo") or [{}])[0]
        if not ii.get("thumburl") or ii.get("mime") not in ("image/jpeg", "image/png", "image/webp"):
            continue
        t = p.get("title", "")
        low = t.lower()
        if any(b in low for b in BAD):
            continue
        if (ii.get("width") or 0) < 800:
            continue
        meta = ii.get("extmetadata", {})
        out.append({
            "title": t, "url": ii["thumburl"],
            "page": ii.get("descriptionurl", ""),
            "license": meta.get("LicenseShortName", {}).get("value", ""),
            "artist": meta.get("Artist", {}).get("value", ""),
            "w": ii.get("width"), "h": ii.get("height"),
        })
    return out


TASKS = {
    "fish-forel": ("smoked trout fillet", ["trout"]),
    "fish-gorbusha": ("pink salmon oncorhynchus", ["salmon", "gorbuscha"]),
    "fish-tunec": ("tuna fish market", ["tuna"]),
    "caviar-black-1": ("black caviar close up", ["caviar"]),
    "liver-treska": ("cod liver", ["liver", "cod"]),
}

picks = {}
for slot, (query, must) in TASKS.items():
    res = search(query)
    cands = [r for r in res if any(m in r["title"].lower() for m in must)][:3]
    picks[slot] = []
    for i, r in enumerate(cands):
        fname = f"{slot}__{i}.jpg"
        try:
            req = urllib.request.Request(r["url"], headers=UA)
            with urllib.request.urlopen(req, timeout=25) as rr:
                data = rr.read()
            open(os.path.join(CAND, fname), "wb").write(data)
            picks[slot].append(dict(r, cand=fname, bytes=len(data)))
            print(f"[CAND] {fname:28} {r['license']:14} {r['title'][:65]}")
        except Exception as e:
            print(f"[FAIL] {fname}: {e}")
    sys.stdout.flush()

json.dump(picks, open(os.path.join(CAND, "picks.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=2)
print("\nCandidates ready in tools/candidates")