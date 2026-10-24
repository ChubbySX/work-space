# -*- coding: utf-8 -*-
import os, sys
from qcloud_cos import CosConfig, CosS3Client

secret_id = os.environ.get("COS_SECRET_ID")
secret_key = os.environ.get("COS_SECRET_KEY")
if not secret_id or not secret_key:
    print("ERROR: 缺少密钥环境变量"); sys.exit(1)

config = CosConfig(Region="ap-guangzhou", SecretId=secret_id, SecretKey=secret_key, Scheme="https")
client = CosS3Client(config)
resp = client.list_buckets()
buckets = resp.get("Buckets", {}).get("Bucket", [])
target = None
for b in buckets:
    if "chubby" in b["Name"].lower() or "website" in b["Name"].lower():
        target = (b["Name"], b.get("Location", ""))
if not target and buckets:
    target = (buckets[0]["Name"], buckets[0].get("Location", ""))
if not target:
    print("ERROR: 没有存储桶"); sys.exit(1)
bucket, region = target
config = CosConfig(Region=region, SecretId=secret_id, SecretKey=secret_key, Scheme="https")
client = CosS3Client(config)
print(f"=== 目标桶: {bucket}  区域: {region} ===")

CT = {'.html':'text/html; charset=utf-8','.htm':'text/html; charset=utf-8',
 '.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8',
 '.json':'application/json; charset=utf-8','.svg':'image/svg+xml',
 '.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.gif':'image/gif',
 '.webp':'image/webp','.ico':'image/x-icon','.mp4':'video/mp4','.webm':'video/webm',
 '.mov':'video/quicktime','.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg',
 '.txt':'text/plain; charset=utf-8','.md':'text/plain; charset=utf-8',
 '.pdf':'application/pdf',
 '.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
 '.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
 '.pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation'}
def ct_of(k):
    return CT.get(os.path.splitext(k)[1].lower(), 'application/octet-stream')

ROOT = "D:/DS harnessw/work station/personal-website"
SKIP_DIRS = {".git","tools","_原始素材备份","__pycache__","node_modules"}
SKIP_EXTS = {".py",".bat",".md"}
SKIP_FILES = {"vercel.json"}

up = 0; fail = 0
for dp, dns, fns in os.walk(ROOT):
    dns[:] = [d for d in dns if d not in SKIP_DIRS]
    for fn in fns:
        ext = os.path.splitext(fn)[1].lower()
        if ext in SKIP_EXTS or fn in SKIP_FILES: continue
        local = os.path.join(dp, fn)
        rel = os.path.relpath(local, ROOT).replace("\\","/")
        ct = ct_of(rel)
        try:
            with open(local,"rb") as f:
                client.put_object(Bucket=bucket, Key=rel, Body=f, ContentType=ct)
            up += 1
            print(f"  [OK] {rel}  ({ct})")
        except Exception as e:
            fail += 1
            print(f"  [FAIL] {rel}: {e}")
print(f"\n上传完成: 成功 {up} 个, 失败 {fail} 个")

try:
    client.put_bucket_website(Bucket=bucket, WebsiteConfiguration={
        "IndexDocument": {"Suffix": "index.html"},
        "ErrorDocument": {"Key": "index.html"}})
    print("静态网站托管已开启 (index.html)")
except Exception as e:
    print(f"开启静态网站托管失败: {e}")

print(f"\n=== 静态网站域名 ===")
print(f"https://{bucket}.cos-website.{region}.myqcloud.com/")