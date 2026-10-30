import json, os, re, sys, urllib.parse, urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "img")
OUT = os.path.abspath(OUT)
os.makedirs(OUT, exist_ok=True)

UA = {"User-Agent": "IkraShopDownloader/1.1 (commercial site build; mail: support@shop.local)"}

ITEMS_TO_FETCH = [
    # id, local_name, queries (list of queries to try in order), must_words (lower)
    ("pick-kapusta", "pick-kapusta", ["Belarusian-Russian Sauerkraut", "Sauerkraut bowl", "Sauerkraut"], ["sauerkraut", "cabbage", "kapusta"]),
    ("pick-ogurcy", "pick-ogurcy", ["Polish style pickled cucumbers IMGP0413", "Pickled cucumbers", "Salzgurken"], ["cucumber", "gurken", "pickle", "огур"]),
    ("pick-morkov", "pick-morkov", ["Morkovcha", "Korean carrot", "Carrot salad"], ["carrot", "morkov", "salad", "морков"]),
    ("pick-baklazhan", "pick-baklazhan", ["Marinated eggplant", "Aubergine salad", "Pickled eggplant"], ["eggplant", "aubergine", "баклажан"]),
    ("pick-mushrooms-wood", "pick-mushrooms-wood", ["Auricularia auricula-judae salad", "Wood ear mushroom salad", "Mu-err Pilze"], ["auricularia", "wood ear", "mushroom", "гриб"]),
    ("pick-opyata", "pick-opyata", ["Pickled honey agaric", "Marinated Armillaria", "Pickled mushrooms"], ["armillaria", "mushroom", "fungi", "гриб", "marin"]),
    ("pick-sparja", "pick-sparja", ["Fuzhu salad", "Tofu skin salad", "Yuba salad"], ["fuzhu", "tofu", "yuba", "salad", "спарж"]),
    ("pick-pomidory", "pick-pomidory", ["Pickled tomatoes", "Marinated tomatoes", "Salztomaten"], ["tomato", "tomat", "помидор"]),
    
    ("meat-servelat", "meat-servelat", ["Cervelat sausage", "Zervelatwurst", "Smoked dry sausage"], ["cervelat", "sausage", "wurst", "сервелат", "колбас"]),
    ("meat-krakov", "meat-krakov", ["Kiełbasa krakowska", "Krakowska sausage", "Krakauer wurst"], ["krakow", "sausage", "kielbasa", "wurst"]),
    ("meat-grudinka", "meat-grudinka", ["Smoked bacon speck", "Pork belly smoked", "Smoked bacon slab"], ["bacon", "pork", "speck", "belly", "грудин"]),
    ("meat-karbonat", "meat-karbonat", ["Roast pork loin", "Kassler pork", "Smoked pork loin"], ["pork", "loin", "kassler", "meat", "карбонад"]),
    ("meat-vetchina", "meat-vetchina", ["Cooked ham deli", "Prosciutto cotto", "Schinken sliced"], ["ham", "schinken", "prosciutto", "ветчин"]),
    ("meat-tushenka", "meat-tushenka", ["Tushonka", "Canned pork stew", "Corned beef jar"], ["tushonka", "pork", "meat", "beef", "тушен"]),
    
    ("sm-kalmar-gk", "sm-kalmar-gk", ["Smoked squid rings", "Smoked calamari", "Dried smoked squid"], ["squid", "calamari", "calamar", "кальмар"]),
    ("sm-terpug-gk", "sm-terpug-gk", ["Smoked sea bass", "Smoked fish whole", "Gerridae fish smoked"], ["fish", "smoked", "рыба"]),
    ("sm-sudak-gk", "sm-sudak-gk", ["Sander lucioperca baked", "Pike perch dish", "Zander fillet"], ["zander", "sander", "perch", "судак", "fish"]),
    ("sm-leshch-gk", "sm-leshch-gk", ["Abramis brama smoked", "Smoked bream", "Smoked river fish"], ["bream", "abramis", "fish", "лещ"]),
    
    ("vyal-vobla", "vyal-vobla", ["Dried fish roach", "Dry roach fish", "Dried fish Caspian"], ["fish", "roach", "vobla", "dried", "вобла"]),
    ("vyal-kambala-ikra", "vyal-kambala-ikra", ["Dried flounder", "Dried flatfish", "Dried plaice"], ["flounder", "plaice", "flatfish", "камбала", "fish"]),
    ("vyal-kambala-ersh", "vyal-kambala-ersh", ["Dried dab fish", "Hippoglossoides platessoides", "Dry flounder"], ["dab", "flounder", "fish", "ёрш"]),
    ("vyal-sudak", "vyal-sudak", ["Dried pike perch", "Dry zander fish", "Stockfish zander"], ["zander", "sander", "perch", "fish", "судак"]),
    ("vyal-shchuka", "vyal-shchuka", ["Dried pike fish", "Dry esox lucius", "Dried northern pike"], ["pike", "esox", "fish", "щука"]),
    ("vyal-leshch", "vyal-leshch", ["Dried bream", "Dry abramis brama", "Dried river fish"], ["bream", "abramis", "fish", "лещ"]),
    ("vyal-chehon", "vyal-chehon", ["Pelecus cultratus", "Dried sabrefish", "Dry knife fish"], ["pelecus", "fish", "dried", "чехонь"]),
    ("vyal-koryushka", "vyal-koryushka", ["Dried smelt fish", "Osmerus eperlanus dried", "Japanese dried smelt"], ["smelt", "osmerus", "fish", "корюшка"]),
    
    ("ss-skumbriya-pp", "ss-skumbriya-pp", ["Marinated mackerel fillets", "Pickled mackerel slices", "Soused mackerel"], ["mackerel", "скумбрия", "fish"]),
    ("ss-bryushki-losos", "ss-bryushki-losos", ["Salmon belly sashimi", "Salmon belly fillet", "Sake harasu"], ["salmon", "belly", "harasu", "лосось", "семга"]),
    ("ss-seld-maslo", "ss-seld-maslo", ["Herring fillets in oil", "Matjes herring fillets", "Pickled herring dish"], ["herring", "matjes", "hareng", "сельдь"]),
    ("ss-seld-voronezh", "ss-seld-voronezh", ["Herring in mustard sauce", "Herring in sour cream sauce", "Pickled herring cream"], ["herring", "sauce", "сельдь"]),
    ("ss-pivnoy-nabor", "ss-pivnoy-nabor", ["Smoked salmon jerky", "Salmon snacks beer", "Salmon cubes appetizer"], ["salmon", "snack", "appetizer", "лосось"]),
    ("ss-salat-he", "ss-salat-he", ["Hoe salad Korean fish", "Raw fish spicy salad", "Hoe-deopbap"], ["fish", "salad", "korean", "hoe", "хе"]),
    ("sm-keta-balyk", "sm-keta-balyk", ["Chum salmon fillet", "Smoked keta salmon", "Keta salmon cut"], ["salmon", "chum", "keta", "кета", "лосось"]),
    ("chavycha-500", "chavycha-500", ["Chinook salmon caviar", "Wild red caviar jar", "Red caviar roe spoon"], ["caviar", "roe", "salmon", "икра"])
]

def search_commons(query, limit=10):
    params = {
        "action": "query", "generator": "search",
        "gsrsearch": query, "gsrlimit": limit, "gsrnamespace": 6,
        "prop": "imageinfo",
        "iiprop": "url|size|extmetadata|mime",
        "iiurlwidth": 900,
        "format": "json"
    }
    url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            d = json.loads(r.read().decode("utf-8"))
            pages = d.get("query", {}).get("pages", {})
            out = []
            for p in pages.values():
                ii = (p.get("imageinfo") or [{}])[0]
                if not ii.get("thumburl"): continue
                mime = ii.get("mime", "")
                if mime not in ("image/jpeg", "image/png", "image/webp"): continue
                meta = ii.get("extmetadata", {})
                lic = meta.get("LicenseShortName", {}).get("value", "CC")
                artist = re.sub(r"<[^>]+>", "", meta.get("Artist", {}).get("value", "") or "").strip()
                out.append({
                    "title": p.get("title"),
                    "url": ii["thumburl"],
                    "page": ii.get("descriptionurl", ""),
                    "license": lic,
                    "artist": artist[:100],
                    "w": ii.get("width", 0),
                    "h": ii.get("height", 0)
                })
            out.sort(key=lambda x: (0 if (x["w"] or 0) >= (x["h"] or 0) else 1, -(x["w"] or 0)))
            return out
    except Exception as e:
        print(f"Search error for {query}: {e}")
        return []

def download_file(url, target_path):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=20) as r:
        content = r.read()
    with open(target_path, "wb") as f:
        f.write(content)
    return len(content)

print(f"Starting to download {len(ITEMS_TO_FETCH)} unique product images...")

cred_path = os.path.join(OUT, "credits.json")
credits = []
if os.path.exists(cred_path):
    try:
        credits = json.load(open(cred_path, encoding="utf-8"))
    except:
        credits = []

saved_files = {}

for item_id, local_name, queries, must_words in ITEMS_TO_FETCH:
    dest_file = f"{local_name}.jpg"
    dest_path = os.path.join(OUT, dest_file)
    
    # Try each query
    best_match = None
    for q in queries:
        results = search_commons(q, limit=8)
        for r in results:
            t = (r["title"] or "").lower()
            if any(w.lower() in t for w in must_words) or len(queries) == 1:
                best_match = r
                break
        if best_match:
            break
            
    # If no match with must_words, take top valid result from first query
    if not best_match and queries:
        results = search_commons(queries[0], limit=5)
        if results:
            best_match = results[0]
            
    if best_match:
        try:
            sz = download_file(best_match["url"], dest_path)
            print(f"[OK] {dest_file:24} ({sz//1024} KB) <- {best_match['title'][:50]}")
            saved_files[item_id] = f"assets/img/{dest_file}"
            credits.append({
                "file": f"assets/img/{dest_file}",
                "source": best_match["title"],
                "page": best_match["page"],
                "license": best_match["license"],
                "artist": best_match["artist"]
            })
        except Exception as e:
            print(f"[FAIL DL] {local_name}: {e}")
    else:
        print(f"[NOT FOUND] {local_name}")

with open(cred_path, "w", encoding="utf-8") as f:
    json.dump(credits, f, ensure_ascii=False, indent=2)

with open("tools/fetched_mapping.json", "w", encoding="utf-8") as f:
    json.dump(saved_files, f, ensure_ascii=False, indent=2)

print(f"\nDone! Successfully fetched and mapped {len(saved_files)} unique images.")
