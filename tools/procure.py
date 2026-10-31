# -*- coding: utf-8 -*-
"""Прочитанные страницы товаров brands (огутцовый солёный мир и т.п.):
копирует уже выбранный файл кандидатов в финальный кадр витрины 4:3."""
import os, json, sys
sys.path.insert(0, "tools")
from wm3 import to_card  # noqa
