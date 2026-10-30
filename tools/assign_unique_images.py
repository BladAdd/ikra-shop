import json, os, urllib.request, re

UA = {"User-Agent": "IkraShopDownloader/1.2 (commercial site build; mail: support@shop.local)"}

def download_url(url, target_path):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=20) as r:
        content = r.read()
    with open(target_path, "wb") as f:
        f.write(content)
    return len(content)

# Specific curated Wikimedia URLs for perfect food photos
CURATED = {
    # Колбаса Краковская
    "meat-krakov": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/53/Kie%C5%82basa_krakowska_2.jpg/800px-Kie%C5%82basa_krakowska_2.jpg",
    # Грудинка свиная копченая
    "meat-grudinka": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/db/Speck_of_South_Tyrol.jpg/800px-Speck_of_South_Tyrol.jpg",
    # Помидоры квашеные "Столичные"
    "pick-pomidory": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0a/Pickled_Tomatoes.jpg/800px-Pickled_Tomatoes.jpg",
    # Корюшка вяленая РФ
    "vyal-koryushka": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5c/Fried_smelt_food_dinner_cooked.jpg/800px-Fried_smelt_food_dinner_cooked.jpg",
    # Судак вяленый
    "vyal-sudak": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/53/Zander_fillet.png/800px-Zander_fillet.png",
    # Пивной набор из лосося
    "ss-pivnoy-nabor": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4b/Smoked_salmon_appetizer.jpg/800px-Smoked_salmon_appetizer.jpg",
    # Камбала вяленая с икрой
    "vyal-kambala-ikra": "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ad/Scholle_Finkenwerder_Art.JPG/800px-Scholle_Finkenwerder_Art.JPG",
    # Вобла вяленая астраханская
    "vyal-vobla": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d7/Fish_drying_in_the_sun%2C_Lake_Tanganyika%2C_Zambia.jpg/800px-Fish_drying_in_the_sun%2C_Lake_Tanganyika%2C_Zambia.jpg",
    # Икра чавычи (крупная королевская красная икра)
    "chavycha-500": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/30/Red_caviar_on_a_spoon.jpg/800px-Red_caviar_on_a_spoon.jpg",
    # Скумбрия пряного посола
    "ss-skumbriya-pp": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/ca/Marinated_mackerel_fillet.jpg/800px-Marinated_mackerel_fillet.jpg",
    # Брюшки лосося с/с
    "ss-bryushki-losos": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/39/Salmon_sashimi_belly.jpg/800px-Salmon_sashimi_belly.jpg",
    # Капуста квашеная
    "pick-kapusta": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/50/Belarusian-Russian_Sauerkraut-1.jpg/800px-Belarusian-Russian_Sauerkraut-1.jpg",
    # Огурцы маринованные
    "pick-ogurcy": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/40/Polish_style_pickled_cucumbers_IMGP0413.jpg/800px-Polish_style_pickled_cucumbers_IMGP0413.jpg",
    # Морковь по-корейски
    "pick-morkov": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9f/Korean-style_carrot_3.jpg/800px-Korean-style_carrot_3.jpg",
    # Баклажаны по-корейски
    "pick-baklazhan": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/be/Marinated_eggplants_with_carrots%2C_bell_peppers_and_onions.jpg/800px-Marinated_eggplants_with_carrots%2C_bell_peppers_and_onions.jpg",
    # Древесные грибы по-корейски
    "pick-mushrooms-wood": "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/Black_fungus_salad_in_ceramic_dish.jpg/800px-Black_fungus_salad_in_ceramic_dish.jpg",
    # Опята по-корейски
    "pick-opyata": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Honey_mushrooms_cooked.jpg/800px-Honey_mushrooms_cooked.jpg",
    # Спаржа по-корейски (соевая спаржа Фучжу)
    "pick-sparja": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/87/Cold_tofu_skin_salad.jpg/800px-Cold_tofu_skin_salad.jpg",
    # Сервелат домашний
    "meat-servelat": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/23/Cervelat_Hr.JPG/800px-Cervelat_Hr.JPG",
    # Ветчина домашняя
    "meat-vetchina": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/40/HAM_russian.jpg/800px-HAM_russian.jpg",
    # Карбонад
    "meat-karbonat": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/07/Roast_pork_loin_%285647644620%29.jpg/800px-Roast_pork_loin_%285647644620%29.jpg",
    # Тушенка домашняя
    "meat-tushenka": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fa/Tushonka_beef.jpg/800px-Tushonka_beef.jpg",
    # Кальмар г/к
    "sm-kalmar-gk": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/41/Squid_rings_and_fish.JPG/800px-Squid_rings_and_fish.JPG",
    # Терпуг г/к
    "sm-terpug-gk": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/43/DSCF0297_A_street_vendor_grills_a_row_of_whole_fish.jpg/800px-DSCF0297_A_street_vendor_grills_a_row_of_whole_fish.jpg",
    # Судак г/к
    "sm-sudak-gk": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6f/Spargel_Zander_Kartoffeln.JPG/800px-Spargel_Zander_Kartoffeln.JPG",
    # Лещ г/к
    "sm-leshch-gk": "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a2/Sloked_fish_02.jpg/800px-Sloked_fish_02.jpg",
    # Щука вяленая
    "vyal-shchuka": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/93/Fish_on_a_Drying_Rack_%2893a07885-1dd8-b71c-07d0-1c09d57fb426%29.jpg/800px-Fish_on_a_Drying_Rack_%2893a07885-1dd8-b71c-07d0-1c09d57fb426%29.jpg",
    # Лещ вяленый
    "vyal-leshch": "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/Zambezi_Bream_air_dried.jpg/800px-Zambezi_Bream_air_dried.jpg",
    # Чехонь вяленая
    "vyal-chehon": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1d/Pelecus_cultratus_464985613.jpg/800px-Pelecus_cultratus_464985613.jpg",
    # Сельдь в масле
    "ss-seld-maslo": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/40/Matjes_herring_fillet_in_oil.jpg/800px-Matjes_herring_fillet_in_oil.jpg",
    # Сельдь по-воронежски в соусе
    "ss-seld-voronezh": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/97/Herring_fillets_on_toasted_homemade_bread%2C_with_pickled_onions.jpg/800px-Herring_fillets_on_toasted_homemade_bread%2C_with_pickled_onions.jpg",
    # Салат ХЕ из рыбы
    "ss-salat-he": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/23/Hoe-deopbap_in_Korea_36.jpg/800px-Hoe-deopbap_in_Korea_36.jpg",
    # Кета балык
    "sm-keta-balyk": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d4/Salmon%2C_chum_-_DPLA_-_1c0838664c79d66ddf5c30424bb9a9be.jpg/800px-Salmon%2C_chum_-_DPLA_-_1c0838664c79d66ddf5c30424bb9a9be.jpg",
    # Горбуша горячего копчения -> используем наше фото горбуши теша
    "sm-gorbusha-gk": "assets/img/gorbusha-tesha.png"
}

# Download any external URLs
os.makedirs("assets/img/catalog", exist_ok=True)
updated_mapping = {}

for item_id, source in CURATED.items():
    if source.startswith("assets/"):
        updated_mapping[item_id] = source
    else:
        target_file = f"assets/img/catalog/{item_id}.jpg"
        try:
            sz = download_url(source, target_file)
            print(f"Downloaded {item_id}: {sz} bytes")
            updated_mapping[item_id] = target_file
        except Exception as e:
            # Fallback to local image in assets/img/
            fallback = f"assets/img/{item_id}.jpg"
            if os.path.exists(fallback):
                updated_mapping[item_id] = fallback
                print(f"Fallback to existing {fallback} for {item_id}")
            else:
                print(f"Error downloading {item_id}: {e}")

# Apply to data/catalog.json
catalog_path = "data/catalog.json"
d = json.load(open(catalog_path, encoding="utf-8"))

for cat in d["catalog"]:
    for it in cat["items"]:
        if it["id"] in updated_mapping:
            it["img"] = updated_mapping[it["id"]]

# Also make sure камбала-ерш has a unique image
for cat in d["catalog"]:
    for it in cat["items"]:
        if it["id"] == "vyal-kambala-ersh":
            if os.path.exists("assets/img/vyal-kambala-ersh.jpg"):
                it["img"] = "assets/img/vyal-kambala-ersh.jpg"

with open(catalog_path, "w", encoding="utf-8") as f:
    json.dump(d, f, ensure_ascii=False, indent=2)

print("\nCatalog successfully updated with unique image mappings!")
