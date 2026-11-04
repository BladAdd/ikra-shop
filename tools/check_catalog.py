#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
Линтер каталога «Икра & Рыба».

Проверяет data/catalog.json:

  1. JSON валиден; есть shop и catalog (список); подсчёт категорий и товаров.
  2. Дубликаты id товаров (критично) и полные дубликаты name (предупреждение).
  3. Товары с price = null.
  4. Пустые / короткие (< 40 символов) описания desc; пустые tags.
  5. Ссылки img:
       - значение содержит "__NEED_PHOTO__"  -> "нет фото" (предупреждение);
       - иначе файл проверяется на существование (отсутствует -> предупреждение).
  6. Фасовки packs:
       - внутри товара все weight уникальны;
       - если total != null и unit == "кг" и piece != true ->
         total должен равняться price * вес(кг), допуск ±1;
       - если packs есть и weight задан, основная фасовка (weight == item.weight)
         должна присутствовать в packs.
  7. oldPrice: если задана и <= price -> предупреждение.
  8. id товара: только латиница/цифры/дефис, без пробелов (критично).
  9. Формат weight: ^[\d.,]+\s*(г|кг|шт)$ (несоответствие -> предупреждение).
 10. shop: обязательный ключ name; whatsapp опционален — если задан, то
     только цифры, 11-12 символов (критично).

Коды выхода: 0 - нет критических, 1 - есть критические.

Запуск из корня проекта:  python tools/check_catalog.py
Только стандартная библиотека Python 3: json, sys, re, os, collections.
"""

import json
import sys
import re
import os
from collections import Counter

try:
    # Гарантируем вывод в UTF-8, чтобы эмодзи/кириллица корректно отображались
    # в консоли (особенно Windows).
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # pragma: no cover - на очень старых версиях Python
    pass

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATALOG_PATH = os.path.join(PROJECT_ROOT, "data", "catalog.json")

# Регулярки и константы.
# ВНИМАНИЕ: группа 1 — числовая часть, группа 2 — единица измерения.
WEIGHT_RE = re.compile(r"^([\d.,]+)\s*(г|кг|шт)$")
ID_RE = re.compile(r"^[A-Za-z0-9-]+$")
NEED_PHOTO = "__NEED_PHOTO__"
MIN_DESC_LEN = 40
TOTAL_TOLERANCE = 1.0  # допуск в рублях для проверки total = price * кг


class Linter:
    """Накопитель замечаний для отчёта."""

    def __init__(self):
        self.criticals = []  # критические ошибки (код выхода 1)
        self.warnings = []   # предупреждения
        self.weight_variants = set()  # все встреченные варианты weight

    def crit(self, msg):
        self.criticals.append(msg)

    def warn(self, msg):
        self.warnings.append(msg)

    # --- вспомогательные функции ---

    @staticmethod
    def parse_weight(value):
        """Разбирает строку веса '1 кг' / '2,5 кг' / '200 г' / '20 шт'.

        Возвращает (число, единица) или None, если формат не подходит.
        """
        if not isinstance(value, str):
            return None
        m = WEIGHT_RE.match(value)
        if not m:
            return None
        number = float(m.group(1).replace(",", "."))
        return number, m.group(2)

    @staticmethod
    def weight_to_kg(value):
        """Переводит строку веса в килограммы (для 'г' и 'кг'), 'шт' -> None."""
        parsed = Linter.parse_weight(value)
        if parsed is None:
            return None
        number, unit = parsed
        if unit == "г":
            return number / 1000.0
        if unit == "кг":
            return number
        return None  # 'шт' - в килограммы не переводится

    def walk_items(self, data):
        """Итератор по всем товарам каталога (catalog -> категория -> items)."""
        catalog = data.get("catalog")
        if not isinstance(catalog, list):
            return
        for cat in catalog:
            if not isinstance(cat, dict):
                continue
            for item in cat.get("items") or []:
                if isinstance(item, dict):
                    yield item

    # --- проверки ---

    def check_structure(self, data):
        """1. JSON валиден, есть shop и catalog — список; подсчёт товаров."""
        print("=== [1] Структура JSON и каталог ===")
        catalog = data.get("catalog")
        if not isinstance(catalog, list):
            self.crit("Поле catalog отсутствует или не является списком.")
            print("  ❌ catalog отсутствует или не является списком.")
            return 0
        if "shop" not in data:
            self.crit("Поле shop отсутствует в каталоге.")
            print("  ❌ Поле shop отсутствует в каталоге.")

        categories = 0
        items = 0
        for cat in catalog:
            if isinstance(cat, dict):
                categories += 1
                items += len(cat.get("items") or [])
        print(f"  ✅ JSON валиден, catalog — список из {categories} категорий, "
              f"{items} товаров.")
        return items

    def check_duplicates(self, data):
        """2. Дубликаты id (критично) и полные дубликаты name."""
        print("=== [2] Дубликаты id и name ===")
        items = list(self.walk_items(data))
        ids = [it.get("id") for it in items]
        dup_ids = [i for i, c in Counter(ids).items() if c > 1 and i is not None]
        if dup_ids:
            self.crit("Дубликаты id товаров: " + ", ".join(sorted(map(str, dup_ids))))
            print("  ❌ Дубликаты id товаров: " + ", ".join(sorted(map(str, dup_ids))))
        else:
            print("  ✅ Дубликатов id не найдено.")

        names = [it.get("name") for it in items]
        dup_names = [n for n, c in Counter(names).items() if c > 1 and n]
        if dup_names:
            self.warn("Полные дубликаты name: " + ", ".join(sorted(dup_names)))
            print("  ⚠ Полные дубликаты name: " + ", ".join(sorted(dup_names)))
        else:
            print("  ✅ Полных дубликатов name не найдено.")

    def check_price_null(self, data):
        """3. Товары с price = null."""
        print("=== [3] Товары с price = null ===")
        found = [f"{it.get('id')} «{it.get('name')}»"
                 for it in self.walk_items(data) if it.get("price") is None]
        if found:
            self.warn("Товары с price=null: " + "; ".join(found))
            print("  ⚠ Товары с price=null:")
            for f in found:
                print(f"      - {f}")
        else:
            print("  ✅ Товаров с price=null нет.")

    def check_desc_tags(self, data):
        """4. Пустые/короткие desc и пустые tags."""
        print("=== [4] Описания (desc) и теги (tags) ===")
        bad_desc = []
        bad_tags = []
        for it in self.walk_items(data):
            desc = it.get("desc")
            if not desc or len(desc) < MIN_DESC_LEN:
                bad_desc.append(f"{it.get('id')} ({len(desc) if desc else 0} симв.)")
            if not it.get("tags"):
                bad_tags.append(str(it.get("id")))
        if bad_desc:
            self.warn("Пустые/короткие desc (< %d симв.): %s" % (MIN_DESC_LEN, ", ".join(bad_desc)))
            print("  ⚠ Пустые/короткие desc (< %d симв.): %s" % (MIN_DESC_LEN, ", ".join(bad_desc)))
        else:
            print(f"  ✅ Все описания не короче {MIN_DESC_LEN} символов.")
        if bad_tags:
            self.warn("Пустые tags: " + ", ".join(bad_tags))
            print("  ⚠ Пустые tags: " + ", ".join(bad_tags))
        else:
            print("  ✅ Пустых tags нет.")

    def check_images(self, data):
        """5. Проверка ссылок img."""
        print("=== [5] Изображения (img) ===")
        no_photo = []
        missing = []
        for it in self.walk_items(data):
            img = it.get("img")
            if not img:
                self.warn(f"У товара {it.get('id')} нет поля img.")
                print(f"  ⚠ У товара {it.get('id')} нет поля img.")
                continue
            if NEED_PHOTO in img:
                no_photo.append(f"{it.get('id')} ({img})")
                continue
            full = img if os.path.isabs(img) else os.path.join(PROJECT_ROOT, img)
            if not os.path.exists(full):
                missing.append(f"{it.get('id')} ({img})")
        if no_photo:
            self.warn("Нет фото (__NEED_PHOTO__): " + str(len(no_photo)))
            print(f"  ⚠ Нет фото (__NEED_PHOTO__) — {len(no_photo)} товаров:")
            for n in no_photo:
                print(f"      - {n}")
        else:
            print("  ✅ У всех товаров есть фото.")
        if missing:
            self.warn("Файл изображения не найден: " + "; ".join(missing))
            print("  ⚠ Файл изображения не найден:")
            for m in missing:
                print(f"      - {m}")
        else:
            print("  ✅ Все файлы изображений на месте.")

    def check_packs(self, data):
        """6. Проверка фасовок packs."""
        print("=== [6] Фасовки (packs) ===")
        dup_weight = []
        total_bad = []
        main_missing = []
        for it in self.walk_items(data):
            packs = it.get("packs")
            if not isinstance(packs, list) or not packs:
                # packs отсутствуют/пусты — пропускаем проверки фасовок
                continue
            weights = [p.get("weight") for p in packs]
            dups = {w for w in weights if weights.count(w) > 1 and w is not None}
            for w in sorted(dups):
                dup_weight.append(f"{it.get('id')}: «{w}»")

            unit_ok = it.get("unit") == "кг" and not it.get("piece")
            for p in packs:
                total = p.get("total")
                price = p.get("price")
                if total is None or price is None:
                    continue
                kg = self.weight_to_kg(p.get("weight"))
                if kg is None or not unit_ok:
                    continue
                expected = kg * price
                if abs(expected - total) > TOTAL_TOLERANCE:
                    total_bad.append(
                        f"{it.get('id')}: pack «{p.get('weight')}» price={price} "
                        f"total={total} (ожидалось ≈ {round(expected, 2)})"
                    )

            w_item = it.get("weight")
            if w_item and w_item not in weights:
                main_missing.append(
                    f"{it.get('id')}: вес товара «{w_item}» отсутствует в packs "
                    f"[{', '.join(map(str, weights))}]"
                )

        if dup_weight:
            self.warn("Повторяющиеся weight внутри packs: " + "; ".join(dup_weight))
            print("  ⚠ Повторяющиеся weight внутри packs:")
            for d in dup_weight:
                print(f"      - {d}")
        else:
            print("  ✅ Внутри каждого товара все веса packs уникальны.")
        if total_bad:
            self.warn("total != price × кг (допуск ±1): " + "; ".join(total_bad))
            print("  ⚠ total != price × кг (допуск ±1):")
            for b in total_bad:
                print(f"      - {b}")
        else:
            print("  ✅ Все total согласованы с price × кг (для unit=кг, piece=false).")
        if main_missing:
            self.warn("Основная фасовка отсутствует в packs: " + "; ".join(main_missing))
            print("  ⚠ Основная фасовка отсутствует в packs:")
            for m in main_missing:
                print(f"      - {m}")
        else:
            print("  ✅ Основная фасовка присутствует в packs у всех товаров.")

    def check_old_price(self, data):
        """7. oldPrice <= price -> предупреждение."""
        print("=== [7] oldPrice ===")
        bad = []
        for it in self.walk_items(data):
            old = it.get("oldPrice")
            price = it.get("price")
            if old is not None and isinstance(old, (int, float)) and \
               isinstance(price, (int, float)) and old <= price:
                bad.append(f"{it.get('id')}: oldPrice={old} price={price}")
        if bad:
            self.warn("oldPrice задана и не выше price: " + "; ".join(bad))
            print("  ⚠ oldPrice задана и <= price:")
            for b in bad:
                print(f"      - {b}")
        else:
            print("  ✅ Все oldPrice выше price (или не заданы).")

    def check_item_ids(self, data):
        """8. id: латиница/цифры/дефис, без пробелов (критично)."""
        print("=== [8] Формат id товаров ===")
        bad = []
        for it in self.walk_items(data):
            iid = it.get("id")
            if not isinstance(iid, str) or not ID_RE.match(iid):
                bad.append(str(iid))
        if bad:
            self.crit("Некорректный id: " + ", ".join(bad))
            print("  ❌ Некорректный id (только латиница/цифры/дефис, без пробелов):")
            for b in bad:
                print(f"      - {b}")
        else:
            print("  ✅ Все id соответствуют формату [A-Za-z0-9-]+.")

    def check_weights(self, data):
        """9. Формат weight: ^[\\d.,]+\\s*(г|кг|шт)$; перечислить варианты."""
        print("=== [9] Формат weight ===")
        bad = []
        for it in self.walk_items(data):
            w = it.get("weight")
            if not isinstance(w, str) or not WEIGHT_RE.match(w):
                bad.append(f"{it.get('id')}: «{w}»")
            if isinstance(w, str):
                self.weight_variants.add(w)
            elif w is not None:
                # вес не строка и не None — тоже несоответствие
                self.weight_variants.add(str(w))
            # каждый pack тоже имеет weight — собираем варианты
            for p in it.get("packs") or []:
                pw = p.get("weight")
                if isinstance(pw, str):
                    self.weight_variants.add(pw)
                if not isinstance(pw, str) or not WEIGHT_RE.match(pw):
                    bad.append(f"{it.get('id')} pack: «{pw}»")
        print("  • Варианты weight, встреченные в каталоге:")
        for v in sorted(self.weight_variants, key=lambda s: (len(s), s)):
            print(f"      - «{v}»")
        if bad:
            self.warn("Некорректный формат weight: " + "; ".join(bad))
            print("  ⚠ Некорректный формат weight:")
            for b in bad:
                print(f"      - {b}")
        else:
            print("  ✅ Все weight соответствуют формату ^[\\d.,]+\\s*(г|кг|шт)$.")

    def check_shop(self, data):
        """10. shop: name, whatsapp; whatsapp — цифры, 11-12 символов."""
        print("=== [10] Параметры shop ===")
        shop = data.get("shop")
        if not isinstance(shop, dict):
            self.crit("shop не является объектом/отсутствует.")
            print("  ❌ shop не является объектом/отсутствует.")
            return
        if "name" not in shop or not shop.get("name"):
            self.crit("В shop отсутствует обязательный ключ name.")
            print("  ❌ В shop отсутствует обязательный ключ name.")
        else:
            print(f"  ✅ shop.name задан: «{shop['name']}»")
        wa = shop.get("whatsapp")
        # Номер опционален: пока владелец не вписал рабочий WhatsApp,
        # пустое значение допустимо (витрина скрывает WhatsApp-кнопки).
        if wa in (None, ""):
            print("  ✅ whatsapp не задан — WhatsApp-кнопки на витрине скрыты (ок до появления номера)")
        elif not (isinstance(wa, str) and wa.isdigit() and 11 <= len(wa) <= 12):
            self.crit(f"whatsapp должен быть из 11-12 цифр (получено: «{wa}»).")
            print(f"  ❌ whatsapp должен быть из 11-12 цифр (получено: «{wa}»).")
        else:
            print(f"  ✅ whatsapp корректен: «{wa}» ({len(wa)} цифр).")


def main():
    print("=" * 70)
    print(f"ЛИНТЕР КАТАЛОГА «Икра & Рыба»")
    print(f"Файл: {CATALOG_PATH}")
    print("=" * 70)

    lint = Linter()

    # Чтение JSON
    try:
        with open(CATALOG_PATH, encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        lint.crit(f"Файл не найден: {CATALOG_PATH}")
        print(f"  ❌ Файл не найден: {CATALOG_PATH}")
        finalize(lint)
        return 1
    except json.JSONDecodeError as exc:
        lint.crit(f"Ошибка разбора JSON: {exc}")
        print(f"  ❌ Ошибка разбора JSON: {exc}")
        finalize(lint)
        return 1

    print()
    lint.check_structure(data)
    print()
    lint.check_duplicates(data)
    print()
    lint.check_price_null(data)
    print()
    lint.check_desc_tags(data)
    print()
    lint.check_images(data)
    print()
    lint.check_packs(data)
    print()
    lint.check_old_price(data)
    print()
    lint.check_item_ids(data)
    print()
    lint.check_weights(data)
    print()
    lint.check_shop(data)

    return finalize(lint)


def finalize(lint):
    """Печать итоговой строки и возврат кода выхода."""
    print()
    print("=" * 70)
    print(f"ИТОГО: {len(lint.criticals)} критических, {len(lint.warnings)} предупреждений")
    print("=" * 70)
    return 0 if not lint.criticals else 1


if __name__ == "__main__":
    sys.exit(main())
