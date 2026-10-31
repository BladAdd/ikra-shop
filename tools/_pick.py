import importlib.util, json, os, sys
spec=importlib.util.spec_from_file_location("pt","tools/photo_tools.py"); pt=importlib.util.module_from_spec(spec); spec.loader.exec_module(pt)
A="assets/img"
def lic(img, ident):
    d=json.load(open(f"tools/candidates/photos/{img}/license.json",encoding="utf-8"))
    idx=int(sys.argv[3]) - 1 if False else None
def set_card(ident, ref):
    img, n = ref.rsplit("/",1)
    src=f"tools/candidates/photos/{img}/{int(n):02d}.jpg"
    pt.crop43(src).save(f"{A}/{ident}.jpg","JPEG",quality=88,optimize=True,progressive=True)
    d=json.load(open(f"tools/candidates/photos/{img}/license.json",encoding="utf-8"))
    el=dict(d[int(n)-1]); el["file"]=f"assets/img/{ident}.jpg"; el["source"]=el["title"]
    cred_path=f"tools/candidates/photos/{img}/{ident}.credit.json"
    json.dump([el], open(cred_path,"w",encoding="utf-8"), ensure_ascii=False, indent=1)
    print("card", ident, "<-", ref, "|", el["title"][:60], "|", el["license"])
picks = json.loads(open("tools/_picks.json",encoding="utf-8").read())
for ident, ref in picks.items():
    set_card(ident, ref)
