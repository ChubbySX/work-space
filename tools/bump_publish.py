"""发布上线时调用：版本号 b+1, c清零, d还原，并同步更新 data.json / js/data.js

必须在 build.js 之后调用：
  build.js    → c+1, d+1  (构建版本号)
  bump_publish → b+1, c=0, d-1  (发布版本号，覆盖 c，还原 d)
  最终结果: b+1, c=0, d不变
"""
import json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
vf = os.path.join(ROOT, "content", "version.json")
df = os.path.join(ROOT, "data.json")
jf = os.path.join(ROOT, "js", "data.js")

# 1) 更新 version.json (b+1, c=0, d-1 还原)
data = json.load(open(vf, encoding="utf-8"))
ver = data.get("version", "1.0.0.0").split(".")
ver[1] = str(int(ver[1]) + 1)              # b += 1
ver[2] = "0"                               # c = 0
ver[3] = str(max(0, int(ver[3]) - 1))      # d -= 1 (还原 build.js 的 d+1)
new_ver = ".".join(ver)
data["version"] = new_ver
with open(vf, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write("\n")
print(f"  version.json -> {new_ver}")

# 2) 同步更新 data.json
if os.path.exists(df):
    d = json.load(open(df, encoding="utf-8"))
    d["version"] = new_ver
    with open(df, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
    print(f"  data.json    -> {new_ver}")

# 3) 同步更新 js/data.js (window.SITE_DATA = {...})
if os.path.exists(jf):
    txt = open(jf, encoding="utf-8").read()
    txt = re.sub(r'"version"\s*:\s*"[^"]*"', f'"version": "{new_ver}"', txt, count=1)
    with open(jf, "w", encoding="utf-8") as f:
        f.write(txt)
    print(f"  js/data.js   -> {new_ver}")

print(f"发布版本号已更新: {new_ver}")
