import json, os, re, sys, urllib.parse, urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "img")
OUT = os.path.abspath(OUT)
os.makedirs(OUT, exist_ok=True)

UA = {"User-Agent": "CaviarShopBuilder/1.0 (site build; contact: local)"}

# локальное имя -> (поисковый запрос, обязательные слова в названии файла)
WANTED = [
    ("caviar-red-1",   "red caviar salmon roe",        ["caviar", "ikra", "roe", "икра"]),
    ("caviar-red-2",   "red caviar",                    ["caviar", "roe", "икра"]),
    ("caviar-red-3",   "salmon caviar",                 ["caviar", "roe", "икра"]),
    ("caviar-black-1", "black caviar",                  ["caviar", "roe", "икра"]),
    ("caviar-black-2", "sturgeon caviar",               ["caviar", "roe", "икра", "sturgeon"]),
    ("fish-semga",     "smoked salmon",                  ["salmon", "smoked"]),
    ("fish-skumbriya", "smoked mackerel",                ["mackerel"]),
    ("fish-forel",     "smoked trout",                   ["trout"]),
    ("fish-gorbusha",  "pink salmon fish",               ["salmon", "pink", "gorbuscha"]),
    ("fish-moyva",     "capelin fish",                   ["capelin", "moyva", "mallotus"]),
    ("fish-kizhuch",   "coho salmon",                    ["coho", "salmon", "kisutch"]),
    ("fish-tunec",     "tuna fish",                      ["tuna", "thunnus"]),
    ("fish-maslyanaya","escolar fish",                   ["escolar", "butterfish", "oilfish", "ruvettus"]),
    ("liver-treska",   "cod liver",                      ["liver", "cod", "треск"]),
    ("hero-table",     "fish appetizer table",           ["fish", "salmon", "seafood", "appetizer"]),
    ("hero-caviar",    "caviar",                         ["caviar", "roe", "икра"]),
]


def relevant(title, must):
    t = (title or "").lower()
    return any(w.lower() in t for w in must)

API = "https://commons.wikimedia.org/w/api.php"


def api(params):
    params = dict(params, format="json")
    url = API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))


def search(query, limit=12):
    d = api({
        "action": "query", "generator": "search",
        "gsrsearch": query, "gsrlimit": limit, "gsrnamespace": 6,
        "prop": "imageinfo",
        "iiprop": "url|size|extmetadata|mime",
        "iiurlwidth": 1200,
    })
    pages = d.get("query", {}).get("pages", {})
    out = []
    for p in pages.values():
        ii = (p.get("imageinfo") or [{}])[0]
        if not ii.get("thumburl"):
            continue
        mime = ii.get("mime", "")
        if mime not in ("image/jpeg", "image/png", "image/webp"):
            continue
        meta = ii.get("extmetadata", {})
        lic = meta.get("LicenseShortName", {}).get("value", "")
        artist = re.sub(r"<[^>]+>", "", meta.get("Artist", {}).get("value", "") or "").strip()
        out.append({
            "title": p.get("title"),
            "url": ii["thumburl"],
            "page": ii.get("descriptionurl", ""),
            "license": lic,
            "artist": artist[:120],
            "w": ii.get("width"), "h": ii.get("height"),
        })
    # предпочитаем горизонтальные кадры приличного размера
    out.sort(key=lambda x: (0 if (x["w"] or 0) >= (x["h"] or 0) else 1, -(x["w"] or 0)))
    return out


def download(url, path):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=20) as r:
        data = r.read()
    with open(path, "wb") as f:
        f.write(data)
    return len(data)


credits = []
cred_path = os.path.join(OUT, "credits.json")
if os.path.exists(cred_path):
    try:
        credits = json.load(open(cred_path, encoding="utf-8"))
    except Exception:
        credits = []
done = {c["local"] for c in credits}
used = {c["source"] for c in credits}
for local, query, must in WANTED:
    if local in done:
        print(f"[SKIP] {local} already present")
        sys.stdout.flush()
        continue
    try:
        results = search(query, limit=20)
    except Exception as e:
        print(f"[SEARCH FAIL] {local}: {e}")
        sys.stdout.flush()
        continue
    picked = None
    for r in results:
        if r["title"] in used:
            continue
        if (r["w"] or 0) < 700:
            continue
        if not relevant(r["title"], must):
            continue
        picked = r
        break
    if not picked:
        print(f"[NONE] {local} <- '{query}'")
        continue
    used.add(picked["title"])
    ext = os.path.splitext(urllib.parse.urlparse(picked["url"]).path)[1].lower() or ".jpg"
    if ext not in (".jpg", ".jpeg", ".png", ".webp"):
        ext = ".jpg"
    fname = local + ext
    try:
        size = download(picked["url"], os.path.join(OUT, fname))
    except Exception as e:
        print(f"[DL FAIL] {local}: {e}")
        continue
    credits.append({
        "file": fname, "local": local,
        "source": picked["title"], "page": picked["page"],
        "license": picked["license"], "artist": picked["artist"],
        "bytes": size,
    })
    with open(cred_path, "w", encoding="utf-8") as f:
        json.dump(credits, f, ensure_ascii=False, indent=2)
    print(f"[OK] {fname:26} {size//1024:5} KB  {picked['license']:14} {picked['title'][:60]}")
    sys.stdout.flush()

with open(cred_path, "w", encoding="utf-8") as f:
    json.dump(credits, f, ensure_ascii=False, indent=2)
print(f"\nDownloaded {len(credits)}/{len(WANTED)}")
