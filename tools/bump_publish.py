"""发布上线时调用：版本号 c+1, d归零"""
import json, os, sys

f = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "content", "version.json")
data = json.load(open(f, encoding="utf-8"))
ver = data.get("version", "1.0.0.0").split(".")
ver[2] = str(int(ver[2]) + 1)  # c += 1
ver[3] = "0"                   # d = 0
data["version"] = ".".join(ver)
json.dump(data, open(f, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print(f"版本号已更新: {data['version']}")
