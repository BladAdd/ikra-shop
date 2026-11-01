import re, json, sys
A = "assets/img"
src = open('tools/build_catalog.py', encoding='utf-8').read()
entries = [(m.start(), m.group(1)) for m in re.finditer(r'item\("([a-z0-9-]+)"', src)]
lines = src.split('\n')
cur = {}
for i in range(1, len(lines)):
    m = re.search(r'item\("([a-z0-9-]+)"', lines[i - 1])
    if m and lines[i].strip().startswith('"'):
        cur[m.group(1)] = i
missing = json.load(open('tools/_need_photo.json', encoding='utf-8'))
n = 0
for ident, row in cur.items():
    want = "__NEED_PHOTO__.jpg" if ident in missing else ident + ".jpg"
    if lines[row].strip() != '"' + want + '",':
        lines[row] = '                 "' + want + '",'
        n += 1
open('tools/build_catalog.py', 'w', encoding='utf-8').write('\n'.join(lines))
print("slots changed:", n, "| placeholder:", len(missing))
